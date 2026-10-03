import type { PlanReview, PlanSection } from '../types'

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const STEP = /^\s*(?:\d+[.)]|[-*+]\s+\[[ xX]\])\s+/
const FILE = /`([^`\s]+\.[A-Za-z0-9]{1,8}(?::\d+)?)`|`([^`\s]*\/[^`\s]+)`/g

function countSteps(body: string): number {
  return body.split('\n').filter(line => STEP.test(line)).length
}

export function parsePlan(text: string, path: string | null): PlanReview {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let title = ''
  let inFence = false
  const marks: { at: number; level: number; heading: string }[] = []

  lines.forEach((line, at) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) return
    const match = HEADING.exec(line)
    if (match?.[1] && match[2]) marks.push({ at, level: match[1].length, heading: match[2] })
  })

  const first = marks[0]
  if (first?.level === 1) {
    title = first.heading
  }
  const levels = marks.filter(mark => !(mark === first && mark.level === 1)).map(mark => mark.level)
  const split = levels.length > 0 ? Math.min(...levels) : 7
  const cuts = marks.filter(mark => mark.level === split)

  const sections: PlanSection[] = []
  const firstCut = cuts[0]?.at ?? lines.length
  const preamble = lines
    .slice(0, firstCut)
    .filter((_, at) => !(first?.level === 1 && at === first.at))
    .join('\n')
    .trim()
  if (preamble) {
    sections.push({ heading: 'Overview', level: split, body: preamble, steps: countSteps(preamble) })
  }
  cuts.forEach((cut, n) => {
    const end = cuts[n + 1]?.at ?? lines.length
    const body = lines.slice(cut.at + 1, end).join('\n').trim()
    sections.push({ heading: cut.heading, level: cut.level, body, steps: countSteps(body) })
  })

  const files = new Set<string>()
  for (const match of text.matchAll(FILE)) {
    const file = match[1] ?? match[2]
    if (file && !file.startsWith('http')) files.add(file)
  }

  const words = text.split(/\s+/).filter(Boolean).length

  return {
    title: title || sections[0]?.heading || 'Plan',
    path,
    text,
    sections,
    files: [...files],
    steps: sections.reduce((sum, section) => sum + section.steps, 0),
    minutes: Math.max(1, Math.round(words / 220)),
    view: 'section',
    index: 0,
    visited: [0],
    notes: {},
    general: '',
  }
}

export function noteCount(review: PlanReview): number {
  return Object.values(review.notes).filter(note => note.trim()).length + (review.general.trim() ? 1 : 0)
}

export function feedbackFor(review: PlanReview): string {
  const parts: string[] = []
  review.sections.forEach((section, n) => {
    const note = review.notes[String(n)]?.trim()
    if (note) parts.push(`## ${section.heading}\n${note}`)
  })
  const general = review.general.trim()
  if (general) parts.push(`## General\n${general}`)

  if (parts.length === 0) {
    return 'The user reviewed the plan and does not approve it yet, but left no notes. Ask the user what to change before you revise the plan.'
  }
  return [
    'The user reviewed the plan and requested changes. Revise the plan to address each note, then present it again.',
    '',
    ...parts,
  ].join('\n\n')
}

export type Block =
  | { kind: 'markdown'; text: string }
  | { kind: 'item'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }

const FENCE = /^\s*(```|~~~)/
const ITEM = /^(?:\d+[.)]|[-*+])\s+/
const TABLE_ROW = /^\s*\|/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function cells(line: string): string[] {
  const out: string[] = []
  let cell = ''
  let inCode = false
  for (const ch of line.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (ch === '`') inCode = !inCode
    if (ch === '|' && !inCode) {
      out.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  out.push(cell.trim())
  return out
}

export function plainCell(cell: string): string {
  return cell.replace(/\*\*|__|`/g, '')
}

export function splitBlocks(body: string): Block[] {
  const lines = body.split('\n')
  const blocks: Block[] = []
  let buffer: string[] = []
  const flush = () => {
    const text = buffer.join('\n').trim()
    if (text) blocks.push({ kind: 'markdown', text })
    buffer = []
  }

  let at = 0
  let inFence = false
  while (at < lines.length) {
    const line = lines[at] ?? ''
    if (FENCE.test(line)) inFence = !inFence
    if (inFence || FENCE.test(line)) {
      buffer.push(line)
      at++
      continue
    }

    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[at + 1] ?? '')) {
      flush()
      const header = cells(line)
      const rows: string[][] = []
      at += 2
      while (at < lines.length && TABLE_ROW.test(lines[at] ?? '')) {
        rows.push(cells(lines[at] ?? ''))
        at++
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    if (ITEM.test(line)) {
      flush()
      const item = [line]
      at++
      let itemFence = false
      while (at < lines.length) {
        const more = lines[at] ?? ''
        const nextLine = lines[at + 1] ?? ''
        const continues = itemFence || /^\s+\S/.test(more) || (more.trim() === '' && /^\s+\S/.test(nextLine))
        if (!continues) break
        if (FENCE.test(more)) itemFence = !itemFence
        item.push(more)
        at++
      }
      blocks.push({ kind: 'item', text: item.join('\n').trimEnd() })
      continue
    }

    buffer.push(line)
    at++
  }
  flush()
  return blocks
}
