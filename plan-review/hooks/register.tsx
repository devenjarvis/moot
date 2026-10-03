import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PlanView, Verdict } from '../types'
import { feedbackFor, noteCount, parsePlan, plainCell, splitBlocks } from './plan'
import type { Block } from './plan'

const PANE = 'plan-review'
const review = atom({ plugin: 'plan-review', key: 'review' } as const, null)

const ACCENT = '#a78bfa'
const GOOD = '#4ade80'
const NOTE = '#fbbf24'
const MUTED = '#94a3b8'
const MARKDOWN_LIMIT = 9_800

type Loaded = { text: string; path: string | null }

async function newestPlan($: EngineInterface): Promise<string | null> {
  const home = await $.env.get('HOME')
  if (!home) return null
  const dir = `${home}/.claude/plans`
  try {
    const entries = await $.fs.list(dir)
    const newest = entries
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    return newest ? `${dir}/${newest.name}` : null
  } catch {
    return null
  }
}

let settle: ((verdict: Verdict) => void) | null = null
let approved = false

function decide(verdict: Verdict) {
  const done = settle
  settle = null
  done?.(verdict)
}

function go($: EngineInterface, view: PlanView, index?: number) {
  return update($, review, current => {
    if (!current) return current
    const next = Math.max(0, Math.min(current.sections.length - 1, index ?? current.index))
    const visited = (view === 'section' || view === 'full') && !current.visited.includes(next) ? [...current.visited, next] : current.visited
    return { ...current, view, index: next, visited }
  })
}

function clip(text: string): string {
  return text.length > MARKDOWN_LIMIT ? `${text.slice(0, MARKDOWN_LIMIT)}\n\n_… cut here; see the plan file for the rest._` : text
}

async function approve($: EngineInterface) {
  const current = await read($, review)
  if (current && noteCount(current) > 0 && current.view !== 'confirm') return go($, 'confirm')
  decide({ kind: 'approve' })
}

async function requestChanges($: EngineInterface, canAsk: boolean) {
  const current = await read($, review)
  if (current && canAsk && noteCount(current) === 0) return go($, 'feedback')
  decide({ kind: 'changes', message: current ? feedbackFor(current) : 'The user requested changes to the plan.' })
}

async function sendFeedback($: EngineInterface, value: string) {
  if (!value.trim()) return
  await saveGeneral($, value)
  await requestChanges($, false)
}

function saveGeneral($: EngineInterface, value: string) {
  return update($, review, current => (current ? { ...current, general: value } : current))
}

function saveNote($: EngineInterface, value: string) {
  return update($, review, current =>
    current ? { ...current, notes: { ...current.notes, [String(current.index)]: value } } : current,
  )
}

export const register: Register = on => {
  let planPath: string | null = null

  on('prompt.attachment', ($, e, next) => {
    if (e.type === 'plan_mode' || e.type === 'plan_mode_reentry') {
      planPath = e.detail?.planFilePath ?? planPath
    }
    return next(e)
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const input = e as { plan?: unknown; planFilePath?: unknown }
    const givenPath = typeof input.planFilePath === 'string' ? input.planFilePath : null
    let loaded: Loaded | null = null

    if (typeof input.plan === 'string' && input.plan.trim()) {
      loaded = { text: input.plan, path: givenPath ?? planPath }
    } else {
      const path = givenPath ?? planPath ?? (await newestPlan($))
      if (path) {
        try {
          loaded = { text: await $.fs.read(path), path }
        } catch {
          loaded = null
        }
      }
    }
    if (!loaded || !loaded.text.trim()) return next(e)

    await update($, review, () => parsePlan(loaded.text, loaded.path))
    decide({ kind: 'classic' })

    const opened = await $.ui.open({
      id: PANE,
      title: 'Plan review',
      focus: true,
      closeOnEscape: true,
      holdToasts: true,
      rows: 40,
      columns: 110,
    })
    if (!opened.isPlaced) return next(e)

    const pending = new Promise<Verdict>(resolve => {
      settle = resolve
    })
    let verdict: Verdict | undefined
    // The budget clock stops only while a $ call is in flight, so a sleep keeps one running while the user reads.
    while (!verdict && !next.signal.aborted) {
      const tick = $.process.run(['sleep', '1'], { timeoutMs: 5000 }).then(
        () => undefined,
        () => undefined,
      )
      verdict = await Promise.race([pending, tick])
    }
    if (!verdict) {
      settle = null
      try {
        await $.ui.close({ id: PANE })
      } catch {}
      return next(e)
    }
    try {
      await $.ui.close({ id: PANE })
    } catch {}

    if (verdict.kind === 'changes') {
      $.ui.toast('Changes sent back to Claude')
      return { deny: verdict.message }
    }
    if (verdict.kind !== 'approve') return next(e)

    $.ui.toast('Plan approved')
    approved = true
    try {
      return await next(e)
    } finally {
      approved = false
    }
  })

  on('tool.check', { tool: 'ExitPlanMode' }, ($, e, next) => (approved ? { decision: 'allow' } : next(e)))

  on('ui.close', { id: PANE }, ($, e, next) => {
    if (e.origin.kind !== 'plugin') decide({ kind: 'classic' })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = ui
    const Input = 'Input' in ui ? ui.Input : null
    const plan = await read($, review)

    if (!plan) {
      return <Text dimColor>No plan is waiting for review.</Text>
    }

    const width = Math.max(40, e.props.bodyColumns)
    const total = plan.sections.length
    const done = plan.visited.length
    const notes = noteCount(plan)
    const barWidth = Math.max(10, Math.min(30, width - 50))
    const filled = total === 0 ? barWidth : Math.round((done / total) * barWidth)
    const section = plan.sections[plan.index]
    const sectionNote = plan.notes[String(plan.index)] ?? ''

    const header = (
      <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
        <Box justifyContent="space-between">
          <Text color={ACCENT} bold>
            ◆ PLAN REVIEW
          </Text>
          <Text color={MUTED}>{plan.path ? plan.path.split('/').slice(-1)[0] : ''}</Text>
        </Box>
        <Text bold wrap="truncate-end">
          {plan.title}
        </Text>
        <Text color={MUTED}>
          {total} sections · {plan.steps} steps · {plan.files.length} files · ~{plan.minutes} min read
        </Text>
        <Box>
          <Text color={GOOD}>{'━'.repeat(filled)}</Text>
          <Text dimColor>{'─'.repeat(barWidth - filled)}</Text>
          <Text color={MUTED}>
            {' '}
            {done}/{total} read
          </Text>
          {notes > 0 && <Text color={NOTE}> ✎ {notes} {notes === 1 ? 'note' : 'notes'}</Text>}
        </Box>
      </Box>
    )

    const tabs = (
      <Box gap={1} marginTop={1}>
        <Button key="tab-outline" label="Outline" hotkey="o" variant={plan.view === 'outline' ? 'primary' : 'secondary'} onPress={() => go($, 'outline')} />
        <Button key="tab-section" label="Sections" hotkey="s" variant={plan.view === 'section' ? 'primary' : 'secondary'} onPress={() => go($, 'section')} />
        <Button key="tab-full" label="Full plan" hotkey="f" variant={plan.view === 'full' ? 'primary' : 'secondary'} onPress={() => go($, 'full')} />
      </Box>
    )

    const table = (id: string, block: Extract<Block, { kind: 'table' }>) => {
      const columns = Math.max(block.header.length, ...block.rows.map(row => row.length))
      const natural = Array.from({ length: columns }, (_, c) =>
        Math.max(...[block.header, ...block.rows].map(row => plainCell(row[c] ?? '').length), 1),
      )
      const room = Math.max(20, width - 2 * columns)
      const widths = natural.map((w, c) => (c === columns - 1 ? w : Math.min(w, Math.floor(room * 0.4))))
      const used = widths.slice(0, -1).reduce((sum, w) => sum + w, 0)
      widths[columns - 1] = Math.max(10, Math.min(natural[columns - 1] ?? 10, room - used))
      const row = (rowKey: string, row: string[], isHeader: boolean) => (
        <Box key={rowKey} gap={2}>
          {widths.map((w, c) => (
            <Box key={`${rowKey}-${c}`} width={w} flexShrink={0}>
              <Text bold={isHeader} color={isHeader ? ACCENT : undefined} wrap="wrap">
                {plainCell(row[c] ?? '')}
              </Text>
            </Box>
          ))}
        </Box>
      )
      return (
        <Box key={id} flexDirection="column">
          {row(`${id}-head`, block.header, true)}
          <Text color={MUTED} dimColor>
            {'─'.repeat(Math.min(width, widths.reduce((sum, w) => sum + w, 0) + 2 * (columns - 1)))}
          </Text>
          {block.rows.map((cells, r) => row(`${id}-row-${r}`, cells, false))}
        </Box>
      )
    }

    const blocks = (id: string, text: string) => {
      const parts = splitBlocks(text)
      if (parts.length === 0) return <Text dimColor>This section is empty.</Text>
      return (
        <Box flexDirection="column" gap={1}>
          {parts.map((part, b) =>
            part.kind === 'table' ? table(`${id}-table-${b}`, part) : <Markdown key={`${id}-md-${b}`} text={clip(part.text)} />,
          )}
        </Box>
      )
    }

    let body
    if (plan.view === 'outline') {
      body = (
        <Box flexDirection="column" marginTop={1}>
          {plan.sections.map((one, n) => {
            const isRead = plan.visited.includes(n)
            const hasNote = Boolean(plan.notes[String(n)]?.trim())
            const mark = hasNote ? '✎' : isRead ? '✓' : '○'
            const steps = one.steps > 0 ? `  · ${one.steps} ${one.steps === 1 ? 'step' : 'steps'}` : ''
            return (
              <Box key={`row-${n}`}>
                <Text color={hasNote ? NOTE : isRead ? GOOD : MUTED}>{mark} </Text>
                <Button
                  key={`open-${n}`}
                  plain
                  label={`${String(n + 1).padStart(2)}  ${one.heading}`}
                  autoFocus={n === 0 ? true : undefined}
                  onPress={() => go($, 'section', n)}
                />
                <Text color={MUTED}>{steps}</Text>
              </Box>
            )
          })}
          {plan.files.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color={ACCENT} bold>
                Files touched
              </Text>
              <Text color={MUTED} wrap="wrap">
                {plan.files.slice(0, 24).join('  ·  ')}
                {plan.files.length > 24 ? `  · +${plan.files.length - 24} more` : ''}
              </Text>
            </Box>
          )}
          {Input && (<Box marginTop={1}>
            <Input
              key="general"
              label="Overall note"
              placeholder="Feedback on the plan as a whole"
              value={plan.general}
              onInput={(value: string) => saveGeneral($, value)}
              onSubmit={(value: string) => saveGeneral($, value)}
            />
          </Box>)}
        </Box>
      )
    } else if (plan.view === 'section' && section) {
      body = (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={2} alignItems="center">
            <Button key="prev" label="← Prev" onPress={() => go($, 'section', plan.index - 1)} />
            <Button key="next" label="Next →" variant="primary" onPress={() => go($, 'section', plan.index + 1)} />
            <Text color={MUTED} dimColor>
              {plan.index + 1} / {total}
              {section.steps > 0 ? ` · ${section.steps} ${section.steps === 1 ? 'step' : 'steps'}` : ''}
            </Text>
          </Box>
          <Markdown key={`heading-${plan.index}`} text={`## ${section.heading}`} />
          {blocks(`section-${plan.index}`, section.body)}
          {Input && (
            <Box marginTop={1}>
              <Input
                key={`note-${plan.index}`}
                label="✎ Note"
                placeholder="What should change in this section?"
                value={sectionNote}
                onInput={(value: string) => saveNote($, value)}
                onSubmit={(value: string) => saveNote($, value)}
              />
            </Box>
          )}
        </Box>
      )
    } else if (plan.view === 'confirm') {
      return (
        <Box flexDirection="column" width={width}>
          {header}
          <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={NOTE} paddingX={1}>
            <Text color={NOTE} bold>
              You have {notes} {notes === 1 ? 'note' : 'notes'}.
            </Text>
            <Text>Approving sends nothing to Claude, and your notes are lost.</Text>
            <Box gap={1} marginTop={1} flexWrap="wrap">
              <Button key="confirm-send" label="✎ Send notes instead" variant="primary" autoFocus onPress={() => requestChanges($, false)} />
              <Button key="confirm-approve" label="✓ Approve anyway" onPress={() => approve($)} />
              <Button key="confirm-back" label="← Back" onPress={() => go($, 'outline')} />
            </Box>
          </Box>
        </Box>
      )
    } else if (plan.view === 'feedback' && Input) {
      return (
        <Box flexDirection="column" width={width}>
          {header}
          <Box flexDirection="column" marginTop={1}>
            <Text color={NOTE} bold>
              What should change?
            </Text>
            <Input
              key="feedback"
              label="✎"
              placeholder="Your feedback for Claude"
              submitLabel="send"
              autoFocus
              onSubmit={(value: string) => sendFeedback($, value)}
            />
            <Box marginTop={1}>
              <Button key="feedback-back" label="← Back" onPress={() => go($, 'outline')} />
            </Box>
          </Box>
        </Box>
      )
    } else {
      body = (
        <Box flexDirection="column" marginTop={1} gap={1}>
          {plan.sections.map((one, n) => {
            const note = plan.notes[String(n)]?.trim()
            return (
              <Box key={`full-${n}`} flexDirection="column">
                <Markdown key={`full-heading-${n}`} text={`## ${one.heading}`} />
                {blocks(`full-${n}`, one.body)}
                {note && <Text color={NOTE}>✎ {note}</Text>}
              </Box>
            )
          })}
        </Box>
      )
    }

    const decisions = (
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={MUTED} paddingX={1}>
        <Text color={MUTED}>Decision</Text>
        <Box gap={1} flexWrap="wrap">
          <Button key="approve" label="✓ Approve" hotkey="1" variant="primary" onPress={() => approve($)} />
          <Button
            key="changes"
            label={notes > 0 ? `✎ Request changes (${notes})` : '✎ Request changes'}
            hotkey="2"
            onPress={() => requestChanges($, Boolean(Input))}
          />
          <Button key="classic" label="Classic dialog" hotkey="3" dimColor onPress={() => decide({ kind: 'classic' })} />
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" width={width}>
        {header}
        {tabs}
        {body}
        {decisions}
      </Box>
    )
  })
}
