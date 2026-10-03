import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { feedbackFor, parsePlan, splitBlocks } from './plan'

const PLAN = `# Add dark mode

Users want a dark theme.

## Context
The app has one theme in \`src/theme.ts\`.

## Steps
1. Add tokens to \`src/theme.ts\`
2. Read the OS setting in \`src/app/root.tsx\`
3. Add a toggle

## Verification
- [ ] Run \`npm test\`
`

const PANE_PROPS = {
  title: 'Plan review',
  isFocused: true,
  bodyColumns: 100,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

test('parsePlan splits sections, counts steps and files', async () => {
  const plan = parsePlan(PLAN, '/p/plan.md')
  expect(plan.title).toBe('Add dark mode')
  expect(plan.sections.map(section => section.heading)).toEqual(['Overview', 'Context', 'Steps', 'Verification'])
  expect(plan.steps).toBe(4)
  expect(plan.files).toEqual(['src/theme.ts', 'src/app/root.tsx'])
})

test('feedbackFor lists notes by section', async () => {
  const plan = { ...parsePlan(PLAN, null), notes: { '2': 'Persist the choice' }, general: 'Keep it small' }
  const text = feedbackFor(plan)
  expect(text).toContain('## Steps\nPersist the choice')
  expect(text).toContain('## General\nKeep it small')
})

const SLEPT = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

const TABLE_PLAN = `# Keys

## Keys
| Key | Action |
|---|---|
| \`j\` | Next section |
| \`k\` | Previous section |

## Steps
1. Add keys
   - with a nested note
2. Test them
`

test('splitBlocks finds tables, list items and text', async () => {
  const blocks = splitBlocks('Intro line\n\n| A | B |\n|---|---|\n| 1 | `x|y` |\n\n1. One\n   - nested\n2. Two\n\nOutro')
  expect(blocks.map(block => block.kind)).toEqual(['markdown', 'table', 'item', 'item', 'markdown'])
  expect(blocks[1]).toEqual({ kind: 'table', header: ['A', 'B'], rows: [['1', '`x|y`']] })
  expect(blocks[2]).toEqual({ kind: 'item', text: '1. One\n   - nested' })
})

test('splitBlocks leaves fenced code whole', async () => {
  const blocks = splitBlocks('```\n1. not a list\n| a | b |\n|---|---|\n```')
  expect(blocks).toEqual([{ kind: 'markdown', text: '```\n1. not a list\n| a | b |\n|---|---|\n```' }])
})

async function openReview($: Engine, on: On, plan = PLAN) {
  const engine: { check?: unknown; permission?: unknown; ran: boolean; sleeps: Array<() => void> } = { ran: false, sleeps: [] }
  let opened = () => {}
  const isOpen = new Promise<void>(resolve => {
    opened = resolve
  })
  on('ui.open', () => {
    opened()
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('process.run', () => new Promise(resolve => engine.sleeps.push(() => resolve({ value: SLEPT }))))
  on('classic.PermissionRequest', () => ({}))
  on('tool.call', async () => {
    engine.ran = true
    engine.check = await $.tool.check({ tool: 'ExitPlanMode', input: {} })
    engine.permission = await $.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: {} })
    return { result: {} as never }
  })
  const answer = $.tool.call({ tool: 'ExitPlanMode', plan } as never)
  await isOpen
  return { answer, engine }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`approve skips the permission dialog on ${surface}`, async ($, on) => {
    const { answer, engine } = await openReview($, on)
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /4 sections · 4 steps · 2 files/ })).toBeDefined()
    await ui.press({ key: 'approve' })
    await answer
    expect(engine.ran).toBe(true)
    expect(engine.check).toEqual({ decision: 'allow' })
    expect(engine.permission).toEqual({})
    expect(await $.tool.check({ tool: 'ExitPlanMode', input: {} })).toEqual({ decision: 'allow' })
    await ui.unmount()
  })

  test(`notes go back as a deny on ${surface}`, async ($, on) => {
    const { answer, engine } = await openReview($, on)
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    await ui.press({ key: 'tab-outline' })
    await ui.press({ key: 'open-2' })
    expect(await ui.find({ type: 'Text', text: /3 \/ 4/ })).toBeDefined()
    await ui.input({ key: 'note-2', text: 'Persist the choice' })
    await ui.press({ key: 'changes' })
    const result = await answer
    expect(engine.ran).toBe(false)
    expect(result.deny ?? result.text ?? '').toContain('## Steps\nPersist the choice')
    await ui.unmount()
  })

  test(`a note typed without Enter still goes back on ${surface}`, async ($, on) => {
    const { answer } = await openReview($, on)
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    await ui.press({ key: 'tab-outline' })
    await ui.press({ key: 'open-2' })
    await ui.input({ key: 'note-2', text: 'Persist the choice', kind: 'change' })
    await ui.press({ key: 'changes' })
    const result = await answer
    expect(result.deny ?? result.text ?? '').toContain('## Steps\nPersist the choice')
    await ui.unmount()
  })

  test(`request changes with no notes asks for feedback on ${surface}`, async ($, on) => {
    const { answer, engine } = await openReview($, on)
    let settled = false
    void answer.then(() => (settled = true))
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    await ui.press({ key: 'changes' })
    expect(await ui.find({ type: 'Text', text: /What should change\?/ })).toBeDefined()
    expect(settled).toBe(false)
    await ui.input({ key: 'feedback', text: '   ' })
    expect(settled).toBe(false)
    await ui.input({ key: 'feedback', text: 'Keep it smaller' })
    const result = await answer
    expect(engine.ran).toBe(false)
    expect(result.deny ?? result.text ?? '').toContain('## General\nKeep it smaller')
    await ui.unmount()
  })

  test(`the pane opens on the first section on ${surface}`, async ($, on) => {
    await openReview($, on)
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /1 \/ 4/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/4 read/ })).toBeDefined()
    await ui.unmount()
  })

  test(`prev and next move between sections on ${surface}`, async ($, on) => {
    await openReview($, on)
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    await ui.press({ key: 'tab-outline' })
    await ui.press({ key: 'open-0' })
    await ui.press({ key: 'next' })
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /3 \/ 4/ })).toBeDefined()
    await ui.press({ key: 'prev' })
    expect(await ui.find({ type: 'Text', text: /2 \/ 4/ })).toBeDefined()
    await ui.unmount()
  })

  test(`tables draw as columns on ${surface}`, async ($, on) => {
    await openReview($, on, TABLE_PLAN)
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    await ui.press({ key: 'tab-outline' })
    await ui.press({ key: 'open-0' })
    expect(await ui.find({ type: 'Text', text: 'Action' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Next section' })).toBeDefined()
    await ui.unmount()
  })

  test(`approve with notes asks first on ${surface}`, async ($, on) => {
    const { answer, engine } = await openReview($, on)
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    await ui.press({ key: 'tab-outline' })
    await ui.press({ key: 'open-2' })
    await ui.input({ key: 'note-2', text: 'Persist the choice', kind: 'change' })
    await ui.press({ key: 'approve' })
    expect(await ui.find({ type: 'Text', text: /You have 1 note/ })).toBeDefined()
    expect(engine.ran).toBe(false)
    await ui.press({ key: 'confirm-send' })
    const result = await answer
    expect(engine.ran).toBe(false)
    expect(result.deny ?? result.text ?? '').toContain('## Steps\nPersist the choice')
    await ui.unmount()
  })

  test(`approve anyway still approves on ${surface}`, async ($, on) => {
    const { answer, engine } = await openReview($, on)
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    await ui.press({ key: 'tab-outline' })
    await ui.press({ key: 'open-2' })
    await ui.input({ key: 'note-2', text: 'Persist the choice', kind: 'change' })
    await ui.press({ key: 'approve' })
    await ui.press({ key: 'confirm-approve' })
    await answer
    expect(engine.check).toEqual({ decision: 'allow' })
    await ui.unmount()
  })

  test(`classic dialog passes the call on untouched on ${surface}`, async ($, on) => {
    const { answer, engine } = await openReview($, on)
    const ui = await $.ui.mount({ plugin: 'plan-review', surface, component: 'Pane', requestId: 'plan-review', props: PANE_PROPS })
    await ui.press({ key: 'classic' })
    await answer
    expect(engine.ran).toBe(true)
    expect(engine.check).toEqual({ decision: 'allow' })
    expect(engine.permission).toEqual({})
    await ui.unmount()
  })
}
