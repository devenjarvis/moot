export const ACTIVE_MS = 60_000
export const IDLE_MS = 180_000
export const LOW_BUDGET = 500

export type RateLimit = { remaining: number; resetAt: string }

export type DelayInput = { isDismissed: boolean; hasOpen: boolean; quiet: number; rate: RateLimit | null; now: number }

export function nextDelay({ isDismissed, hasOpen, quiet, rate, now }: DelayInput): number | null {
  if (isDismissed) return null
  if (rate && rate.remaining < LOW_BUDGET) return Math.max(IDLE_MS, Date.parse(rate.resetAt) - now)
  if (!hasOpen) return IDLE_MS
  return Math.min(ACTIVE_MS * 2 ** quiet, IDLE_MS)
}

export const lowerRate = (a: RateLimit | null, b: RateLimit | null) => (!a || (b && b.remaining < a.remaining) ? b : a)
