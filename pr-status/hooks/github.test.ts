import { expect, test } from 'claude-code/testing'

import type { Pr } from '../types'
import { buildQuery, groupPrs, nextStep, parentBranches, parsePrs } from './github'

type Node = Record<string, unknown>

function core(number: number, head: string, base: string, extra: Node = {}): Node {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    headRefName: head,
    baseRefName: base,
    headRepository: { nameWithOwner: 'o/r' },
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    additions: 10,
    deletions: 2,
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    reviewThreads: { nodes: [] },
    ...extra,
  }
}

const STACK_ENTRIES = [
  { position: 1, pullRequest: core(101, 'feat-1', 'main', { state: 'MERGED' }) },
  { position: 2, pullRequest: core(102, 'feat-2', 'feat-1') },
  { position: 3, pullRequest: core(103, 'feat-3', 'feat-2') },
]

const STACK = { number: 4, size: 3, baseRefName: 'main', entries: { nodes: STACK_ENTRIES } }

const RESPONSE = {
  data: {
    repository: {
      b0: {
        nodes: [
          core(102, 'feat-2', 'feat-1', {
            stack: STACK,
            stackEntry: { position: 2 },
            commits: {
              nodes: [
                {
                  commit: {
                    statusCheckRollup: {
                      contexts: {
                        nodes: [
                          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
                          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
                          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
                          { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null },
                          { __typename: 'StatusContext', state: 'SUCCESS' },
                          { __typename: 'StatusContext', state: 'PENDING' },
                          { __typename: 'StatusContext', state: 'ERROR' },
                        ],
                      },
                    },
                  },
                },
              ],
            },
            reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
          }),
          core(900, 'feat-2', 'main', { headRepository: { nameWithOwner: 'someone/r' } }),
        ],
      },
    },
  },
}

const pr = (number: number, head: string, base: string, over: Partial<Pr> = {}): Pr => ({
  repo: 'o/r',
  number,
  title: `PR ${number}`,
  url: '',
  state: 'OPEN',
  isDraft: false,
  head,
  base,
  headRepo: 'o/r',
  review: 'APPROVED',
  mergeable: 'MERGEABLE',
  mergeState: 'CLEAN',
  additions: 1,
  deletions: 1,
  checks: { pass: 3, fail: 0, pending: 0 },
  unresolved: 0,
  stack: null,
  ...over,
})

test('buildQuery passes branch names as variables and drops stack fields on request', async () => {
  const withStack = buildQuery(['feat-a', 'fe"at-b'], true)
  expect(withStack).toContain('$b0: String!')
  expect(withStack).toContain('b1: pullRequests(headRefName: $b1')
  expect(withStack).toContain('stackEntry')
  expect(withStack.includes('fe"at-b')).toBe(false)
  expect(buildQuery(['feat-a'], false).includes('stack')).toBe(false)
})

test('parsePrs reads a native stack, drops fork PRs and counts checks', async () => {
  const prs = parsePrs(RESPONSE, 'o/r', ['o/r'])
  expect(prs.map(one => one.number).sort()).toEqual([101, 102, 103])
  const mid = prs.find(one => one.number === 102)
  expect(mid?.checks).toEqual({ pass: 3, fail: 2, pending: 2 })
  expect(mid?.unresolved).toBe(1)
  expect(mid?.stack).toEqual({ number: 4, size: 3, base: 'main', position: 2 })
  expect(prs.find(one => one.number === 103)?.stack?.position).toBe(3)
})

test('parsePrs prefers the open PR when a branch has several', async () => {
  const json = {
    data: {
      repository: {
        b0: { nodes: [core(50, 'feat-a', 'main', { state: 'CLOSED' }), core(60, 'feat-a', 'main')] },
      },
    },
  }
  expect(parsePrs(json, 'o/r', ['o/r']).map(one => one.number)).toEqual([60])
})

test('groupPrs orders a native stack top first', async () => {
  const groups = groupPrs(parsePrs(RESPONSE, 'o/r', ['o/r']))
  expect(groups.length).toBe(1)
  expect(groups[0]?.stack).toBe(4)
  expect(groups[0]?.base).toBe('main')
  expect(groups[0]?.size).toBe(3)
  expect(groups[0]?.prs.map(one => one.number)).toEqual([103, 102, 101])
})

test('groupPrs links PRs by base and head when there is no native stack', async () => {
  const groups = groupPrs([pr(7, 'top', 'bottom'), pr(5, 'bottom', 'main'), pr(9, 'alone', 'main')])
  expect(groups.map(group => group.prs.map(one => one.number))).toEqual([[9], [7, 5]])
  expect(groups[1]?.base).toBe('main')
  expect(groups[1]?.stack).toBe(null)
})

test('nextStep follows the precedence', async () => {
  const groups = groupPrs(parsePrs(RESPONSE, 'o/r', ['o/r']))
  const group = groups[0]!
  const [top, mid, bottom] = group.prs
  expect(nextStep(bottom!, group).label).toBe('merged')
  expect(nextStep(mid!, group).label).toBe('checks failing')
  expect(nextStep(top!, group)).toEqual({ label: 'blocked by #102', tone: 'warn' })

  const lone = (over: Partial<Pr>) => {
    const one = pr(1, 'a', 'main', over)
    return nextStep(one, { key: 'k', repo: 'o/r', stack: null, base: 'main', size: 1, prs: [one] }).label
  }
  expect(lone({})).toBe('ready to merge')
  expect(lone({ isDraft: true })).toBe('draft')
  expect(lone({ state: 'CLOSED' })).toBe('closed')
  expect(lone({ mergeable: 'CONFLICTING' })).toBe('conflicts')
  expect(lone({ mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' })).toBe('ready to merge')
  expect(lone({ review: 'CHANGES_REQUESTED' })).toBe('changes requested')
  expect(lone({ checks: { pass: 1, fail: 0, pending: 2 } })).toBe('checks pending')
  expect(lone({ review: 'REVIEW_REQUIRED' })).toBe('review needed')
  expect(lone({ mergeState: 'BEHIND' })).toBe('behind base')
})

test('parentBranches asks for bases that are not fetched and not the default', async () => {
  const prs = [pr(7, 'top', 'mid'), pr(5, 'mid', 'low'), pr(9, 'x', 'main')]
  expect(parentBranches(prs, 'main')).toEqual(['low'])
})
