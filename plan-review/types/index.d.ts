export type PlanSection = { heading: string; level: number; body: string; steps: number }

export type PlanView = 'outline' | 'section' | 'full' | 'feedback' | 'confirm'

export type PlanReview = {
  title: string
  path: string | null
  text: string
  sections: PlanSection[]
  files: string[]
  steps: number
  minutes: number
  view: PlanView
  index: number
  visited: number[]
  notes: Record<string, string>
  general: string
}

export type Verdict =
  | { kind: 'approve' }
  | { kind: 'changes'; message: string }
  | { kind: 'classic' }

declare module 'claude-code' {
  interface PluginState {
    'plan-review': { review: PlanReview | null }
  }
}
