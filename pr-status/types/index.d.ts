export type Checks = { pass: number; fail: number; pending: number }

export type PrState = 'OPEN' | 'MERGED' | 'CLOSED'

export type Review = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null

export type StackEntry = { number: number; size: number; base: string; position: number }

export type Pr = {
  repo: string
  number: number
  title: string
  url: string
  state: PrState
  isDraft: boolean
  head: string
  base: string
  headRepo: string | null
  review: Review
  mergeable: string
  mergeState: string
  additions: number
  deletions: number
  checks: Checks
  unresolved: number
  stack: StackEntry | null
}

export type PrGroup = {
  key: string
  repo: string
  stack: number | null
  base: string
  size: number
  prs: Pr[]
}

export type Tone = 'good' | 'bad' | 'warn' | 'muted' | 'merged'

export type NextStep = { label: string; tone: Tone; isInherited?: true }

export type TrackedBranch = { root: string; branch: string }

export type Snapshot = {
  groups: PrGroup[]
  error: string | null
  fetchedAt: number
  repos: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    'pr-status': {
      branches: TrackedBranch[]
      current: TrackedBranch | null
      snapshot: Snapshot | null
      seen: string[]
      dismissed: boolean
    }
  }
}
