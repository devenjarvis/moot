export const ACTIVE_MS = 60_000
export const IDLE_MS = 180_000
export const LOW_BUDGET = 500

export type RateLimit = { remaining: number; resetAt: string }

export type DelayInput = { isDismissed: boolean; hasOpen: boolean; quiet: number; rate: RateLimit | null; now: number }

export function nextDelay({ isDismissed, hasOpen, quiet, rate, now }: DelayInput): number | null {
  if (isDismissed) return null
  if (rate && rate.remaining < LOW_BUDGET) {
    const wait = Date.parse(rate.resetAt) - now
    return Number.isFinite(wait) ? Math.max(IDLE_MS, wait) : IDLE_MS
  }
  if (!hasOpen) return IDLE_MS
  return Math.min(ACTIVE_MS * 2 ** quiet, IDLE_MS)
}

export function lowerRate(a: RateLimit | null, b: RateLimit | null): RateLimit | null {
  return !a || (b && b.remaining < a.remaining) ? b : a
}
