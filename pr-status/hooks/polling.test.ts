import { expect, test } from 'claude-code/testing'

import { nextDelay } from './polling'

const base = { isDismissed: false, hasOpen: true, quiet: 0, rate: null, now: 0 }

test('nextDelay stops timed polling while the pane is dismissed', async () => {
  expect(nextDelay({ ...base, isDismissed: true })).toBe(null)
  expect(nextDelay({ ...base, isDismissed: true, hasOpen: false })).toBe(null)
  expect(nextDelay({ ...base, isDismissed: true, rate: { remaining: 10, resetAt: '1970-01-01T01:00:00Z' } })).toBe(null)
})

test('nextDelay doubles from 60 s to at most 180 s while a PR is open', async () => {
  expect([0, 1, 2, 3, 9].map(quiet => nextDelay({ ...base, quiet }))).toEqual([60_000, 120_000, 180_000, 180_000, 180_000])
  expect(nextDelay({ ...base, hasOpen: false })).toBe(180_000)
})

test('nextDelay waits for the reset when the budget is low', async () => {
  const resetAt = '1970-01-01T00:30:00Z'
  expect(nextDelay({ ...base, rate: { remaining: 499, resetAt } })).toBe(1_800_000)
  expect(nextDelay({ ...base, rate: { remaining: 499, resetAt }, now: 1_700_000 })).toBe(180_000)
  expect(nextDelay({ ...base, rate: { remaining: 500, resetAt } })).toBe(60_000)
  expect(nextDelay({ ...base, hasOpen: false, rate: { remaining: 0, resetAt } })).toBe(1_800_000)
})
