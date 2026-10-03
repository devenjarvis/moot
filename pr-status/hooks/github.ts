import type { Checks, NextStep, Pr, PrGroup, PrState, Review, StackEntry } from '../types'

const CORE = `fragment Core on PullRequest {
  number title url state isDraft headRefName baseRefName
  headRepository { nameWithOwner }
  reviewDecision mergeable mergeStateStatus additions deletions
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { status conclusion }
    ... on StatusContext { state }
  } } } } } }
  reviewThreads(first: 100) { nodes { isResolved } }
}`

const TOP_WITH_STACK = `fragment Top on PullRequest {
  ...Core
  stack { number size baseRefName entries(first: 25) { nodes { position pullRequest { ...Core } } } }
  stackEntry { position }
}`

const TOP_PLAIN = `fragment Top on PullRequest { ...Core }`

export function buildQuery(branches: string[], withStack: boolean): string {
  const vars = branches.map((_, i) => `$b${i}: String!`).join(', ')
  const fields = branches
    .map(
      (_, i) =>
        `    b${i}: pullRequests(headRefName: $b${i}, first: 5, states: [OPEN, MERGED, CLOSED], orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...Top } }`,
    )
    .join('\n')
  return `query($owner: String!, $name: String!, ${vars}) {
  repository(owner: $owner, name: $name) {
${fields}
  }
}
${withStack ? TOP_WITH_STACK : TOP_PLAIN}
${CORE}`
}

type Raw = Record<string, any>

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

function countChecks(node: Raw): Checks {
  const checks = { pass: 0, fail: 0, pending: 0 }
  const contexts: Raw[] = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  for (const one of contexts) {
    if (one.__typename === 'CheckRun') {
      if (one.status !== 'COMPLETED') checks.pending++
      else if (PASSING.has(one.conclusion)) checks.pass++
      else checks.fail++
    } else if (one.__typename === 'StatusContext') {
      if (one.state === 'SUCCESS') checks.pass++
      else if (one.state === 'PENDING' || one.state === 'EXPECTED') checks.pending++
      else checks.fail++
    }
  }
  return checks
}

function toPr(node: Raw, repo: string, stack: StackEntry | null): Pr {
  return {
    repo,
    number: node.number,
    title: node.title ?? '',
    url: node.url ?? '',
    state: node.state as PrState,
    isDraft: Boolean(node.isDraft),
    head: node.headRefName,
    base: node.baseRefName,
    headRepo: node.headRepository?.nameWithOwner ?? null,
    review: (node.reviewDecision ?? null) as Review,
    mergeable: node.mergeable ?? 'UNKNOWN',
    mergeState: node.mergeStateStatus ?? 'UNKNOWN',
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    checks: countChecks(node),
    unresolved: (node.reviewThreads?.nodes ?? []).filter((thread: Raw) => !thread.isResolved).length,
    stack,
  }
}

const STATE_RANK: Record<PrState, number> = { OPEN: 0, MERGED: 1, CLOSED: 2 }

export function parsePrs(json: unknown, repo: string, allowedHeadRepos: string[]): Pr[] {
  const repository: Raw = (json as Raw)?.data?.repository ?? {}
  const byNumber = new Map<number, Pr>()
  const allowed = (node: Raw) => allowedHeadRepos.includes(node.headRepository?.nameWithOwner)

  for (const connection of Object.values(repository) as Raw[]) {
    const nodes: Raw[] = (connection?.nodes ?? []).filter(allowed)
    const chosen = [...nodes].sort((a, b) => STATE_RANK[a.state as PrState] - STATE_RANK[b.state as PrState])[0]
    if (!chosen) continue
    const stack = chosen.stack as Raw | null | undefined
    if (!stack) {
      byNumber.set(chosen.number, toPr(chosen, repo, null))
      continue
    }
    for (const entry of stack.entries?.nodes ?? []) {
      if (!entry?.pullRequest) continue
      const info = { number: stack.number, size: stack.size, base: stack.baseRefName, position: entry.position }
      byNumber.set(entry.pullRequest.number, toPr(entry.pullRequest, repo, info))
    }
    const position = chosen.stackEntry?.position ?? byNumber.get(chosen.number)?.stack?.position ?? 0
    byNumber.set(chosen.number, toPr(chosen, repo, { number: stack.number, size: stack.size, base: stack.baseRefName, position }))
  }
  return [...byNumber.values()]
}

function depthOf(pr: Pr, members: Pr[]): number {
  let depth = 0
  let base = pr.base
  const visited = new Set<string>([pr.head])
  for (;;) {
    const parent = members.find(one => one.head === base)
    if (!parent || visited.has(parent.head)) return depth
    visited.add(parent.head)
    depth++
    base = parent.base
  }
}

export function groupPrs(prs: Pr[]): PrGroup[] {
  const groups: PrGroup[] = []
  const native = new Map<string, Pr[]>()
  const rest: Pr[] = []
  for (const pr of prs) {
    if (pr.stack) {
      const key = `${pr.repo}#stack-${pr.stack.number}`
      native.set(key, [...(native.get(key) ?? []), pr])
    } else {
      rest.push(pr)
    }
  }
  for (const [key, members] of native) {
    const first = members[0]!
    groups.push({
      key,
      repo: first.repo,
      stack: first.stack!.number,
      base: first.stack!.base,
      size: first.stack!.size,
      prs: [...members].sort((a, b) => b.stack!.position - a.stack!.position),
    })
  }

  const parent = new Map<Pr, Pr>()
  for (const pr of rest) {
    const above = rest.find(one => one !== pr && one.repo === pr.repo && one.head === pr.base)
    if (above) parent.set(pr, above)
  }
  const rootOf = (pr: Pr) => {
    const visited = new Set<Pr>()
    let node = pr
    while (parent.has(node) && !visited.has(node)) {
      visited.add(node)
      node = parent.get(node)!
    }
    return node
  }
  const components = new Map<Pr, Pr[]>()
  for (const pr of rest) {
    const root = rootOf(pr)
    components.set(root, [...(components.get(root) ?? []), pr])
  }
  for (const [root, members] of components) {
    groups.push({
      key: `${root.repo}:${root.head}`,
      repo: root.repo,
      stack: null,
      base: root.base,
      size: members.length,
      prs: [...members].sort((a, b) => depthOf(b, members) - depthOf(a, members) || b.number - a.number),
    })
  }

  const hasOpen = (group: PrGroup) => group.prs.some(pr => pr.state === 'OPEN')
  const newest = (group: PrGroup) => Math.max(...group.prs.map(pr => pr.number))
  return groups.sort((a, b) => Number(hasOpen(b)) - Number(hasOpen(a)) || newest(b) - newest(a))
}

function below(pr: Pr, group: PrGroup): Pr[] {
  if (pr.stack) {
    return group.prs.filter(one => one.stack && one.stack.position < pr.stack!.position).sort((a, b) => b.stack!.position - a.stack!.position)
  }
  const chain: Pr[] = []
  let base = pr.base
  for (;;) {
    const next = group.prs.find(one => one.head === base && !chain.includes(one) && one !== pr)
    if (!next) return chain
    chain.push(next)
    base = next.base
  }
}

function blockingStep(pr: Pr): NextStep | null {
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') return { label: 'conflicts', tone: 'bad' }
  if (pr.checks.fail > 0) return { label: 'checks failing', tone: 'bad' }
  if (pr.review === 'CHANGES_REQUESTED') return { label: 'changes requested', tone: 'bad' }
  return null
}

function waitingStep(pr: Pr): NextStep | null {
  if (pr.checks.pending > 0) return { label: 'checks pending', tone: 'warn' }
  if (pr.review === 'REVIEW_REQUIRED') return { label: 'review needed', tone: 'warn' }
  if (pr.mergeState === 'BEHIND') return { label: 'behind base', tone: 'warn' }
  return null
}

export function nextStep(pr: Pr, group: PrGroup): NextStep {
  if (pr.state === 'MERGED') return { label: 'merged', tone: 'merged' }
  if (pr.state === 'CLOSED') return { label: 'closed', tone: 'muted' }
  if (pr.isDraft) return { label: 'draft', tone: 'muted' }
  const lower = below(pr, group).filter(one => one.state === 'OPEN')

  if (!pr.stack) {
    if (lower[0]) return { label: `blocked by #${lower[0].number}`, tone: 'warn' }
    return blockingStep(pr) ?? waitingStep(pr) ?? { label: 'ready to merge', tone: 'good' }
  }

  // Merging a PR in a native stack merges every open PR below it, so their problems are this PR's too.
  const own = blockingStep(pr)
  if (own) return own
  for (const one of [...lower].reverse()) {
    if (one.isDraft) return { label: `#${one.number}: draft`, tone: 'warn' }
    const step = blockingStep(one) ?? waitingStep(one)
    if (step) return { label: `#${one.number}: ${step.label}`, tone: step.tone }
  }
  const waiting = waitingStep(pr)
  if (waiting) return waiting
  const bottom = lower.at(-1)
  if (!bottom) return { label: 'ready to merge', tone: 'good' }
  const label = lower.length === 1 ? `ready · with #${bottom.number}` : `ready · merges #${bottom.number}–#${pr.number}`
  return { label, tone: 'good' }
}

export function parentBranches(prs: Pr[], defaultBranch: string): string[] {
  const heads = new Set(prs.map(pr => pr.head))
  const wanted = prs
    .filter(pr => !pr.stack && pr.base !== defaultBranch && !heads.has(pr.base))
    .map(pr => pr.base)
  return [...new Set(wanted)]
}
