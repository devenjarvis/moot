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
  | { kind: 'list'; text: string }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }

export type Align = 'left' | 'center' | 'right' | null

const FENCE = /^\s*(```|~~~)/
const ITEM = /^(?:\d+[.)]|[-*+])\s+/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const BLOCK_START = /^\s{0,3}(?:#{1,6}\s|>|\||```|~~~)/
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=\s|$)/

function isItem(line: string): boolean {
  return ITEM.test(line) && !RULE.test(line)
}

function hasPipe(line: string): boolean {
  return /(?:^|[^\\])\|/.test(line)
}

function cells(line: string): string[] {
  const out: string[] = []
  let cell = ''
  let inCode = false
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '\\' && inner[i + 1] === '|') {
      cell += '|'
      i++
      continue
    }
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

function aligns(rule: string): Align[] {
  return cells(rule).map(cell => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null
  })
}

export type Span = { text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; href?: string }
type Style = Omit<Span, 'text'>

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>]/
const LINK = /^\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/
const AUTOLINK = /^<((?:https?|file):\/\/[^>\s]+)>/
const BARE_URL = /^https?:\/\/[^\s<]*[^\s<.,:;"')\]*_~]/
const EMPHASIS: [string, keyof Style][] = [
  ['**', 'bold'],
  ['__', 'bold'],
  ['~~', 'strike'],
  ['*', 'italic'],
  ['_', 'italic'],
]

function closing(text: string, from: number, mark: string): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') {
      j++
      continue
    }
    if (text[j] === '`') {
      const end = text.indexOf('`', j + 1)
      if (end > j) j = end
      continue
    }
    if (mark.length === 1 && text.startsWith(mark + mark, j)) {
      j++
      continue
    }
    if (!text.startsWith(mark, j) || /\s/.test(text[j - 1] ?? ' ')) continue
    if (mark === '_' || mark === '__') {
      if (/\w/.test(text[j + mark.length] ?? '')) continue
    }
    return j
  }
  return -1
}

/** Splits one line of inline markdown into styled runs: emphasis, code, strikethrough and links. */
export function inlineSpans(text: string, style: Style = {}): Span[] {
  const out: Span[] = []
  let plain = ''
  const flush = () => {
    if (plain) out.push({ ...style, text: plain })
    plain = ''
  }
  let i = 0
  scan: while (i < text.length) {
    const ch = text[i] ?? ''
    const rest = text.slice(i)
    if (ch === '\\' && ESCAPABLE.test(text[i + 1] ?? '')) {
      plain += text[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const run = /^`+/.exec(rest)?.[0] ?? '`'
      const end = text.indexOf(run, i + run.length)
      if (end > i) {
        flush()
        const code = text.slice(i + run.length, end)
        out.push({ ...style, code: true, text: /^ .* $/.test(code) ? code.slice(1, -1) : code })
        i = end + run.length
        continue
      }
      plain += run
      i += run.length
      continue
    }
    const link = ch === '[' ? LINK.exec(rest) : ch === '<' ? AUTOLINK.exec(rest) : null
    if (link) {
      flush()
      const href = ch === '[' ? (link[2] ?? '') : (link[1] ?? '')
      const label = ch === '[' ? (link[1] ?? '') : href
      out.push(...(label ? inlineSpans(label, { ...style, href }) : [{ ...style, href, text: href }]))
      i += link[0].length
      continue
    }
    if (ch === 'h' && !style.href && !/\w/.test(text[i - 1] ?? '')) {
      const url = BARE_URL.exec(rest)?.[0]
      if (url) {
        flush()
        out.push({ ...style, href: url, text: url })
        i += url.length
        continue
      }
    }
    for (const [mark, key] of EMPHASIS) {
      if (!text.startsWith(mark, i) || style[key]) continue
      const after = text[i + mark.length] ?? ''
      if (!after || /\s/.test(after)) continue
      if (mark[0] === '_' && /\w/.test(text[i - 1] ?? '')) continue
      const end = closing(text, i + mark.length, mark)
      if (end < 0) continue
      flush()
      out.push(...inlineSpans(text.slice(i + mark.length, end), { ...style, [key]: true }))
      i = end + mark.length
      continue scan
    }
    plain += ch
    i++
  }
  flush()
  return out
}

/** The text a reader sees once inline markdown is drawn: markers and link targets gone. */
export function plainText(text: string): string {
  return inlineSpans(text)
    .map(span => span.text)
    .join('')
}

/** Draws task-list boxes as glyphs, so `- [ ]` reads as a checkbox on every surface. */
export function taskBoxes(text: string): string {
  let inFence = false
  return text
    .split('\n')
    .map(line => {
      if (FENCE.test(line)) inFence = !inFence
      if (inFence) return line
      return line.replace(TASK, (_, lead: string, mark: string) => `${lead}${mark === ' ' ? '☐' : '☑'}`)
    })
    .join('\n')
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

    const rule = lines[at + 1] ?? ''
    if (hasPipe(line) && TABLE_RULE.test(rule) && (/^\s*\|/.test(line) || rule.includes('|'))) {
      flush()
      const header = cells(line)
      const align = aligns(rule)
      const rows: string[][] = []
      at += 2
      while (at < lines.length && (lines[at] ?? '').trim() && hasPipe(lines[at] ?? '')) {
        rows.push(cells(lines[at] ?? ''))
        at++
      }
      blocks.push({ kind: 'table', header, align, rows })
      continue
    }

    if (isItem(line)) {
      flush()
      // One run of items; short one-line items stay together as a tight list, richer ones are spaced apart.
      const items: string[] = []
      let rich = false
      while (at < lines.length && isItem(lines[at] ?? '')) {
        const item = [lines[at] ?? '']
        at++
        let itemFence = false
        while (at < lines.length) {
          const more = lines[at] ?? ''
          const nextLine = lines[at + 1] ?? ''
          const prev = item[item.length - 1] ?? ''
          const lazy = more.trim() !== '' && prev.trim() !== '' && !isItem(more) && !BLOCK_START.test(more) && !RULE.test(more)
          const continues = itemFence || /^\s+\S/.test(more) || lazy || (more.trim() === '' && /^\s+\S/.test(nextLine))
          if (!continues) break
          if (FENCE.test(more)) itemFence = !itemFence
          item.push(more)
          at++
        }
        if (item.length > 1) rich = true
        items.push(item.join('\n').trimEnd())
        if (isItem(lines[at] ?? '')) continue
        let gap = at
        while (gap < lines.length && !(lines[gap] ?? '').trim()) gap++
        if (gap === at || !isItem(lines[gap] ?? '')) break
        rich = true
        at = gap
      }
      if (rich) {
        for (const text of items) blocks.push({ kind: 'item', text: taskBoxes(text) })
      } else {
        blocks.push({ kind: 'list', text: taskBoxes(items.join('\n')) })
      }
      continue
    }

    buffer.push(line)
    at++
  }
  flush()
  return blocks
}
