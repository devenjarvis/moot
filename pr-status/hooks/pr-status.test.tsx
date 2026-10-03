import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE_PROPS = {
  title: 'Pull requests',
  isFocused: false,
  bodyColumns: 90,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

type Node = Record<string, unknown>

function node(number: number, head: string, base: string, extra: Node = {}): Node {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    headRefName: head,
    baseRefName: base,
    headRepository: { nameWithOwner: 'o/r' },
    reviewDecision: 'APPROVED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    additions: 10,
    deletions: 2,
    commits: { nodes: [] },
    reviewThreads: { nodes: [] },
    ...extra,
  }
}

const STACK = {
  number: 4,
  size: 3,
  baseRefName: 'main',
  entries: {
    nodes: [
      { position: 1, pullRequest: node(101, 'feat-1', 'main') },
      { position: 2, pullRequest: node(102, 'feat-2', 'feat-1') },
      { position: 3, pullRequest: node(103, 'feat-3', 'feat-2') },
    ],
  },
}

const reply = (nodes: Node[]) => JSON.stringify({ data: { repository: { b0: { nodes } } } })

type World = {
  root: string
  branch: string
  graphql: { exitCode: number; stdout: string; stderr?: string }
  then?: World['graphql']
  calls: string[][]
  opens: string[]
  panes: string[]
}

function setup($: Engine, on: On, graphql: World['graphql'] = { exitCode: 0, stdout: reply([]) }) {
  const world: World = { root: '/repo', branch: 'feat-a', graphql, calls: [], opens: [], panes: [] }
  const clock = mock.clock(on)
  const out = (stdout: string, exitCode = 0, stderr = '') => ({
    value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    world.calls.push(argv)
    const line = argv.join(' ')
    if (line.startsWith('git rev-parse')) return out(`${world.root}\n${world.branch}\n`)
    if (line.startsWith('git symbolic-ref')) return out('origin/main\n')
    if (line.startsWith('git remote get-url')) return out('git@github.com:o/r.git\n')
    if (line.startsWith('gh repo view')) return out('{"nameWithOwner":"o/r","defaultBranchRef":{"name":"main"}}')
    if (line.startsWith('gh api graphql')) {
      const answer = world.graphql
      if (world.then) [world.graphql, world.then] = [world.then, undefined]
      return out(answer.stdout, answer.exitCode, answer.stderr ?? '')
    }
    return out('')
  })
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.start', e => ({ cwd: '/repo' }))
  on('command.register', () => ({ value: { command: 'prs' } }))
  on('ui.open', ($, e) => {
    world.opens.push(e.id)
    if (!world.panes.includes(e.id)) world.panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    world.panes = world.panes.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: world.panes.map(id => ({ id, title: 'Pull requests', isFocused: false })) as never }))
  on('tool.call', () => ({ result: {} as never }))
  return { world, clock }
}

async function start($: Engine, clock: ReturnType<typeof mock.clock>) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
}

const graphqlCalls = (world: World) => world.calls.filter(argv => argv[0] === 'gh' && argv[1] === 'api')

test('tracks the session branches, skipping the default branch and detached HEAD', async ($, on) => {
  const { world, clock } = setup($, on)
  await start($, clock)
  world.branch = 'feat-b'
  await $.tool.call({ tool: 'Bash', command: 'git checkout -b feat-b' } as never)
  world.branch = 'main'
  await $.tool.call({ tool: 'Bash', command: 'git checkout main' } as never)
  world.branch = 'HEAD'
  await $.tool.call({ tool: 'Bash', command: 'git checkout abc123' } as never)
  await clock.advance(180_000)
  const last = graphqlCalls(world).at(-1)!
  expect(last.filter(arg => /^b\d+=/.test(arg))).toEqual(['b0=feat-a', 'b1=feat-b'])
})

test('no pane opens while no tracked branch has an open PR', async ($, on) => {
  const { world, clock } = setup($, on)
  await start($, clock)
  expect(graphqlCalls(world).length).toBe(1)
  await clock.advance(180_000)
  expect(graphqlCalls(world).length).toBe(2)
  expect(world.opens).toEqual([])
})

test('a gh failure opens nothing', async ($, on) => {
  const { world, clock } = setup($, on, { exitCode: 1, stdout: '', stderr: 'gh: not logged in' })
  await start($, clock)
  expect(graphqlCalls(world).length).toBe(1)
  expect(world.opens).toEqual([])
})

test('the first open PR opens the pane once and not again while it is up', async ($, on) => {
  const { world, clock } = setup($, on)
  await start($, clock)
  world.graphql = { exitCode: 0, stdout: reply([node(7, 'feat-a', 'main')]) }
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' } as never)
  await clock.advance(5_000)
  expect(world.opens).toEqual(['pr-status'])
  await clock.advance(60_000)
  expect(graphqlCalls(world).length).toBe(3)
  expect(world.opens).toEqual(['pr-status'])
})

test('a schema without stacks is retried without the stack fields', async ($, on) => {
  const { world, clock } = setup($, on, {
    exitCode: 1,
    stdout: '',
    stderr: "GraphQL: Field 'stack' doesn't exist on type 'PullRequest'",
  })
  world.then = { exitCode: 0, stdout: reply([node(7, 'feat-a', 'main')]) }
  await start($, clock)
  const queries = graphqlCalls(world).map(argv => argv.join(' '))
  expect(queries.length).toBe(2)
  expect(queries[1]!.includes('stackEntry')).toBe(false)
  expect(world.opens).toEqual(['pr-status'])
})

test('/prs answers in text when there is no PR', async ($, on) => {
  const { world, clock } = setup($, on)
  await start($, clock)
  const answer = await $.command.run({ command: 'prs', args: '' } as never)
  expect((answer as { text?: string }).text).toBe("No open PRs for this session's branches.")
  expect(world.opens).toEqual([])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws a native stack top first on ${surface}`, async ($, on) => {
    const { world, clock } = setup($, on)
    world.branch = 'feat-2'
    world.graphql = { exitCode: 0, stdout: reply([node(102, 'feat-2', 'feat-1', { stack: STACK, stackEntry: { position: 2 } })]) }
    await start($, clock)
    expect(world.opens).toEqual(['pr-status'])

    const ui = await $.ui.mount({ plugin: 'pr-status', surface, component: 'Pane', requestId: 'pr-status', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /Stack #4 · 3 PRs → main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'ready · with #101' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /HEAD/ })).toBeDefined()
    const rows = ['open-103', 'open-102', 'open-101']
    for (const key of rows) expect(await ui.find({ key })).toBeDefined()

    const before = graphqlCalls(world).length
    await ui.press({ key: 'refresh' })
    expect(graphqlCalls(world).length).toBe(before + 1)

    await ui.press({ key: 'open-102' })
    expect(world.calls.some(argv => argv.join(' ') === 'gh pr view 102 --web -R o/r')).toBe(true)
    await ui.unmount()
  })
}

const replyTwo = (first: Node[], second: Node[]) =>
  JSON.stringify({ data: { repository: { b0: { nodes: first }, b1: { nodes: second } } } })

test('polls every 3 min with no PR and every 60 s once one is open', async ($, on) => {
  const { world, clock } = setup($, on)
  await start($, clock)
  await clock.advance(60_000)
  expect(graphqlCalls(world).length).toBe(1)
  world.graphql = { exitCode: 0, stdout: reply([node(7, 'feat-a', 'main')]) }
  await clock.advance(120_000)
  expect(graphqlCalls(world).length).toBe(2)
  await clock.advance(60_000)
  expect(graphqlCalls(world).length).toBe(3)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`fetches an open parent PR and draws an inferred stack on ${surface}`, async ($, on) => {
    const { world, clock } = setup($, on, { exitCode: 0, stdout: reply([node(8, 'feat-a', 'feat-base')]) })
    world.then = { exitCode: 0, stdout: reply([node(5, 'feat-base', 'main')]) }
    await start($, clock)
    const queries = graphqlCalls(world)
    expect(queries.length).toBe(2)
    expect(queries[1]!.includes('b0=feat-base')).toBe(true)

    const ui = await $.ui.mount({ plugin: 'pr-status', surface, component: 'Pane', requestId: 'pr-status', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: 'Stack · 2 PRs → main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'blocked by #5' })).toBeDefined()
    await ui.unmount()
  })

  test(`a gh failure with the pane open keeps the last data and shows the error on ${surface}`, async ($, on) => {
    const { world, clock } = setup($, on, { exitCode: 0, stdout: reply([node(7, 'feat-a', 'main')]) })
    await start($, clock)
    world.graphql = { exitCode: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' }
    await clock.advance(60_000)

    const ui = await $.ui.mount({ plugin: 'pr-status', surface, component: 'Pane', requestId: 'pr-status', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: '⚠ HTTP 502: Bad Gateway' })).toBeDefined()
    expect(await ui.find({ key: 'open-7' })).toBeDefined()
    await ui.unmount()

    world.graphql = { exitCode: 0, stdout: reply([node(7, 'feat-a', 'main')]) }
    await clock.advance(180_000)
    expect(graphqlCalls(world).length).toBeGreaterThan(2)
  })

  test(`HEAD follows a checkout without waiting for a refresh on ${surface}`, async ($, on) => {
    const { world, clock } = setup($, on)
    world.branch = 'feat-b'
    await start($, clock)
    world.branch = 'feat-a'
    world.graphql = { exitCode: 0, stdout: replyTwo([node(8, 'feat-b', 'main')], [node(7, 'feat-a', 'main')]) }
    await $.tool.call({ tool: 'Bash', command: 'git checkout -b feat-a' } as never)
    await clock.advance(5_000)

    const ui = await $.ui.mount({ plugin: 'pr-status', surface, component: 'Pane', requestId: 'pr-status', props: PANE_PROPS })
    expect((await ui.findAll({ type: 'Text', text: 'HEAD' })).length).toBe(1)
    expect(await ui.find({ key: 'head-7' })).toBeDefined()
    world.branch = 'feat-b'
    const calls = graphqlCalls(world).length
    await $.tool.call({ tool: 'Bash', command: 'git checkout feat-b' } as never)
    expect(graphqlCalls(world).length).toBe(calls)
    await ui.redraw()
    expect((await ui.findAll({ type: 'Text', text: 'HEAD' })).length).toBe(1)
    expect(await ui.find({ key: 'head-8' })).toBeDefined()
    await ui.unmount()
  })
}

test('two worktrees of one repo draw a shared PR once', async ($, on) => {
  const { world, clock } = setup($, on, { exitCode: 0, stdout: reply([node(7, 'feat-a', 'main')]) })
  await start($, clock)
  world.root = '/worktree'
  world.branch = 'feat-b'
  await $.tool.call({ tool: 'EnterWorktree', name: 'b' } as never)
  await clock.advance(5_000)
  const ui = await $.ui.mount({ plugin: 'pr-status', surface: 'terminal', component: 'Pane', requestId: 'pr-status', props: PANE_PROPS })
  expect((await ui.findAll({ key: 'open-7' })).length).toBe(1)
  await ui.unmount()
})

test('a merged PR keeps the pane up and shows its final state', async ($, on) => {
  const { world, clock } = setup($, on, { exitCode: 0, stdout: reply([node(7, 'feat-a', 'main')]) })
  await start($, clock)
  world.graphql = { exitCode: 0, stdout: reply([node(7, 'feat-a', 'main', { state: 'MERGED' })]) }
  await clock.advance(60_000)
  expect(world.panes).toEqual(['pr-status'])
  const ui = await $.ui.mount({ plugin: 'pr-status', surface: 'terminal', component: 'Pane', requestId: 'pr-status', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: 'merged' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 merged/ })).toBeDefined()
  await ui.unmount()
})

test('a problem below is drawn as inherited, apart from the PR own state', async ($, on) => {
  const failing = { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'StatusContext', state: 'FAILURE' }] } } } }] }
  const stack = {
    ...STACK,
    size: 2,
    entries: {
      nodes: [
        { position: 1, pullRequest: node(101, 'feat-1', 'main', { commits: failing }) },
        { position: 2, pullRequest: node(102, 'feat-2', 'feat-1') },
      ],
    },
  }
  const { world, clock } = setup($, on)
  world.branch = 'feat-2'
  world.graphql = { exitCode: 0, stdout: reply([node(102, 'feat-2', 'feat-1', { stack, stackEntry: { position: 2 } })]) }
  await start($, clock)
  const ui = await $.ui.mount({ plugin: 'pr-status', surface: 'terminal', component: 'Pane', requestId: 'pr-status', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: '↓ #101 checks failing' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'checks failing' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✗ 1' })).toBeDefined()
  await ui.unmount()
})
