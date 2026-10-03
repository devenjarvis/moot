import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Pr, PrGroup, Snapshot, Tone, TrackedBranch } from '../types'
import { buildQuery, groupPrs, nextStep, parentBranches, parsePrs } from './github'

const PANE = 'pr-status'
const TITLE = 'Pull requests'
const branches = atom({ plugin: 'pr-status', key: 'branches' } as const, [])
const current = atom({ plugin: 'pr-status', key: 'current' } as const, null)
const snapshot = atom({ plugin: 'pr-status', key: 'snapshot' } as const, null)
const seen = atom({ plugin: 'pr-status', key: 'seen' } as const, [])
const dismissed = atom({ plugin: 'pr-status', key: 'dismissed' } as const, false)

const ACTIVE_MS = 60_000
const IDLE_MS = 180_000
const AFTER_COMMAND_MS = 5_000
const PARENT_ROUNDS = 5
const TRIGGER = /\bgh\s+(pr|stack)\b|\bgit\s+push\b/

const ACCENT = '#a78bfa'
const MUTED = '#94a3b8'
const TONES: Record<Tone, string> = {
  good: '#4ade80',
  bad: '#f87171',
  warn: '#fbbf24',
  muted: MUTED,
  merged: '#c084fc',
}

type RepoInfo = { repo: string; defaultBranch: string; allowed: string[] }

const repoInfos = new Map<string, RepoInfo>()
const localDefaults = new Map<string, string | null>()
const stackFields = new Map<string, boolean>()
let cadence: Timer | null = null
let soon: Timer | null = null
let inFlight: Promise<void> | null = null

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''
const keyOf = (pr: Pr) => `${pr.repo}#${pr.number}`

function parseRemote(url: string): string | null {
  const match = url.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/)
  return match?.[1] ?? null
}

async function run($: EngineInterface, argv: string[], cwd: string, timeoutMs: number) {
  try {
    return await $.process.run(argv, { cwd, timeoutMs })
  } catch {
    return null
  }
}

async function localDefault($: EngineInterface, root: string): Promise<string | null> {
  if (localDefaults.has(root)) return localDefaults.get(root) ?? null
  const res = await run($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root, 3_000)
  const name = res?.exitCode === 0 ? res.stdout.trim().replace(/^origin\//, '') : null
  localDefaults.set(root, name || null)
  return name || null
}

async function trackCwd($: EngineInterface, cwd?: string): Promise<boolean> {
  const dir = cwd ?? (await $.session.cwd())
  const res = await run($, ['git', 'rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'], dir, 3_000)
  if (!res || res.exitCode !== 0) return false
  const [root, branch] = res.stdout.trim().split('\n')
  if (!root || !branch) return false

  const here = await read($, current)
  if (here?.root !== root || here.branch !== branch) await update($, current, () => ({ root, branch }))
  if (branch === 'HEAD') return false
  const fallback = await localDefault($, root)
  if (fallback ? branch === fallback : branch === 'main' || branch === 'master') return false

  let added = false
  await update($, branches, list => {
    if (list.some(one => one.root === root && one.branch === branch)) return list
    added = true
    return [...list, { root, branch }]
  })
  return added
}

async function repoInfo($: EngineInterface, root: string): Promise<RepoInfo> {
  const cached = repoInfos.get(root)
  if (cached) return cached
  const view = await run($, ['gh', 'repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], root, 15_000)
  if (!view) throw new Error('gh is not installed')
  if (view.exitCode !== 0) throw new Error(firstLine(view.stderr) || 'gh repo view failed')
  const parsed = JSON.parse(view.stdout) as { nameWithOwner: string; defaultBranchRef?: { name?: string } }
  const origin = await run($, ['git', 'remote', 'get-url', 'origin'], root, 3_000)
  const originRepo = origin?.exitCode === 0 ? parseRemote(origin.stdout) : null
  const info = {
    repo: parsed.nameWithOwner,
    defaultBranch: parsed.defaultBranchRef?.name ?? 'main',
    allowed: [...new Set([parsed.nameWithOwner, ...(originRepo ? [originRepo] : [])])],
  }
  repoInfos.set(root, info)
  return info
}

async function query($: EngineInterface, root: string, info: RepoInfo, wanted: string[]): Promise<Pr[]> {
  const withStack = stackFields.get(root) ?? true
  const [owner = '', name = ''] = info.repo.split('/')
  const argv = [
    'gh',
    'api',
    'graphql',
    '-f',
    `query=${buildQuery(wanted, withStack)}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    ...wanted.flatMap((branch, i) => ['-f', `b${i}=${branch}`]),
  ]
  const res = await run($, argv, root, 20_000)
  if (!res) throw new Error('gh is not installed')
  if (res.exitCode !== 0) {
    const message = `${res.stderr}\n${res.stdout}`
    if (withStack && /Field '(?:stack|stackEntry)'/.test(message)) {
      stackFields.set(root, false)
      return query($, root, info, wanted)
    }
    throw new Error(firstLine(res.stderr) || firstLine(res.stdout) || 'gh api graphql failed')
  }
  return parsePrs(JSON.parse(res.stdout), info.repo, info.allowed)
}

async function fetchRoot($: EngineInterface, root: string, names: string[]) {
  const info = await repoInfo($, root)
  const asked = new Set<string>()
  const prs: Pr[] = []
  let wanted = names.filter(name => name !== info.defaultBranch)
  for (let round = 0; round <= PARENT_ROUNDS && wanted.length > 0; round++) {
    wanted.forEach(name => asked.add(name))
    for (const pr of await query($, root, info, wanted)) {
      const isParent = round > 0
      if ((!isParent || pr.state === 'OPEN') && !prs.some(one => one.number === pr.number)) prs.push(pr)
    }
    wanted = parentBranches(prs, info.defaultBranch).filter(name => !asked.has(name))
  }
  return { repo: info.repo, prs }
}

function schedule($: EngineInterface, ms: number) {
  cadence?.cancel()
  cadence = $.clock.after(ms, () => void refresh($))
}

function refreshSoon($: EngineInterface) {
  soon?.cancel()
  soon = $.clock.after(AFTER_COMMAND_MS, () => void refresh($))
}

function refresh($: EngineInterface): Promise<void> {
  inFlight ??= refreshNow($)
    .catch(() => undefined)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

async function refreshNow($: EngineInterface) {
  schedule($, IDLE_MS)
  const tracked = await read($, branches)
  if (tracked.length === 0) return
  const roots = new Map<string, string[]>()
  for (const one of tracked) roots.set(one.root, [...(roots.get(one.root) ?? []), one.branch])

  const previous = await read($, snapshot)
  const prs = new Map<string, Pr>()
  const kept: Pr[] = []
  const repos: Record<string, string> = { ...previous?.repos }
  let error: string | null = null
  let fetched = 0
  for (const [root, names] of roots) {
    try {
      const found = await fetchRoot($, root, names)
      for (const pr of found.prs) prs.set(keyOf(pr), pr)
      repos[root] = found.repo
      fetched++
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      const failedRepo = repoInfos.get(root)?.repo ?? repos[root]
      kept.push(...(previous?.groups.flatMap(group => group.prs).filter(pr => pr.repo === failedRepo) ?? []))
    }
  }
  for (const pr of kept) if (!prs.has(keyOf(pr))) prs.set(keyOf(pr), pr)

  const next: Snapshot = {
    groups: groupPrs([...prs.values()]),
    error,
    fetchedAt: fetched > 0 ? await $.clock.now() : (previous?.fetchedAt ?? 0),
    repos,
  }
  await update($, snapshot, () => next)

  const all = next.groups.flatMap(group => group.prs)
  const open = all.filter(pr => pr.state === 'OPEN')
  const known = await read($, seen)
  const fresh = open.filter(pr => !known.includes(keyOf(pr)))
  await update($, seen, list => [...new Set([...list, ...all.map(keyOf)])])

  if (open.length > 0) {
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
    const wasDismissed = await read($, dismissed)
    if (!isUp && (!wasDismissed || fresh.length > 0)) {
      await update($, dismissed, () => false)
      await $.ui.open({ id: PANE, title: TITLE, columns: 72 })
    }
  }
  schedule($, open.length > 0 ? ACTIVE_MS : IDLE_MS)
}

async function openInBrowser($: EngineInterface, pr: Pr) {
  const res = await run($, ['gh', 'pr', 'view', String(pr.number), '--web', '-R', pr.repo], await $.session.cwd(), 10_000)
  if (!res || res.exitCode !== 0) $.ui.toast(`Could not open #${pr.number}: ${pr.url}`)
}

function clockTime(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

function clip(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`
}

function checksText(pr: Pr): string {
  const { pass, fail, pending } = pr.checks
  if (pass + fail + pending === 0) return 'no checks'
  return `✓${pass} ✗${fail} ◷${pending}`
}

const REVIEW_TEXT: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes requested',
  REVIEW_REQUIRED: 'review required',
}

function stateText(pr: Pr): string {
  if (pr.state === 'OPEN') return pr.isDraft ? 'draft' : 'open'
  return pr.state.toLowerCase()
}

function glyph(pr: Pr): string {
  if (pr.state === 'MERGED') return '◆'
  if (pr.state === 'CLOSED') return '✕'
  return pr.isDraft ? '◌' : '●'
}

function groupTitle(group: PrGroup): string {
  const count = `${group.size} ${group.size === 1 ? 'PR' : 'PRs'}`
  return group.stack !== null ? `Stack #${group.stack} · ${count} → ${group.base}` : `Stack · ${count} → ${group.base}`
}

async function afterTool($: EngineInterface, command: string) {
  const added = await trackCwd($)
  if (added || TRIGGER.test(command)) refreshSoon($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: "Show the GitHub PRs of this session's branches" })
    await trackCwd($)
    schedule($, 1)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    await afterTool($, String((e as { command?: unknown }).command ?? ''))
    return result
  })

  on('tool.call', { tool: 'EnterWorktree' }, async ($, e, next) => {
    const result = await next(e)
    await afterTool($, '')
    return result
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    if (await trackCwd($, e.new_cwd)) refreshSoon($)
    return result
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, dismissed, () => true)
    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    let snap = await read($, snapshot)
    if (!snap?.groups.length) {
      await refresh($)
      snap = await read($, snapshot)
    }
    if (!snap?.groups.length) return { text: "No open PRs for this session's branches." }
    await update($, dismissed, () => false)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: 'Opened the pull request pane.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const here = await read($, current)
    const width = Math.max(40, e.props.bodyColumns)

    if (!snap || snap.groups.length === 0) {
      return <Text dimColor>{snap?.error ? `⚠ ${snap.error}` : 'No pull requests yet.'}</Text>
    }

    const all = snap.groups.flatMap(group => group.prs)
    const counts = (['OPEN', 'MERGED', 'CLOSED'] as const)
      .map(state => [state, all.filter(pr => pr.state === state).length] as const)
      .filter(([, n]) => n > 0)
      .map(([state, n]) => `${n} ${state.toLowerCase()}`)
      .join(' · ')
    const isMultiRepo = new Set(snap.groups.map(group => group.repo)).size > 1
    const openKey = (pr: Pr) => (isMultiRepo ? `open-${pr.repo}-${pr.number}` : `open-${pr.number}`)

    const header = (
      <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
        <Box justifyContent="space-between">
          <Text color={ACCENT} bold>
            ◆ PULL REQUESTS
          </Text>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refresh($)} />
        </Box>
        <Text color={MUTED}>{`${counts} · updated ${clockTime(snap.fetchedAt)}`}</Text>
        {snap.error && (
          <Text color={TONES.bad} wrap="truncate-end">
            {`⚠ ${snap.error}`}
          </Text>
        )}
      </Box>
    )

    const row = (pr: Pr, group: PrGroup, isStack: boolean) => {
      const step = nextStep(pr, group)
      const isHead = here !== null && snap.repos[here.root] === pr.repo && here.branch === pr.head
      const room = width - step.label.length - (isHead ? 10 : 5)
      const details = [
        stateText(pr),
        checksText(pr),
        pr.review ? REVIEW_TEXT[pr.review] : '',
        pr.unresolved > 0 ? `${pr.unresolved} unresolved` : '',
        `+${pr.additions} −${pr.deletions}`,
        isStack ? '' : `→ ${pr.base}`,
        isMultiRepo ? pr.repo : '',
      ]
        .filter(Boolean)
        .join(' · ')
      return (
        <Box key={`row-${keyOf(pr)}`} flexDirection="column">
          <Box justifyContent="space-between">
            <Box>
              <Text color={TONES[step.tone]}>{`${isStack ? '│' : ' '}${glyph(pr)} `}</Text>
              <Button
                key={openKey(pr)}
                plain
                label={clip(`#${pr.number} ${pr.title}`, room)}
                onPress={() => openInBrowser($, pr)}
              />
            </Box>
            <Box gap={1}>
              {isHead && (
                <Box key={openKey(pr).replace(/^open-/, 'head-')}>
                  <Text color={ACCENT} bold>
                    HEAD
                  </Text>
                </Box>
              )}
              <Text color={TONES[step.tone]} bold>
                {step.label}
              </Text>
            </Box>
          </Box>
          <Text color={MUTED} wrap="truncate-end">{`${isStack ? '│' : ' '}  ${details}`}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        {header}
        {snap.groups.map(group => {
          const isStack = group.stack !== null || group.prs.length > 1
          return (
            <Box key={group.key} flexDirection="column" marginTop={1}>
              {isStack && (
                <Text color={ACCENT} bold>
                  {groupTitle(group)}
                </Text>
              )}
              {group.prs.map(pr => row(pr, group, isStack))}
              {isStack && <Text color={MUTED}>{`└ ${group.base}`}</Text>}
            </Box>
          )
        })}
      </Box>
    )
  })
}
