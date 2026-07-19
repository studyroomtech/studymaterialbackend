// Pure, server-authoritative timing core for Test/Section Attempts (R1, R2).
//
// This module contains only pure, side-effect-free functions. It holds no
// clock of its own — the current instant `now` is always passed in — and it
// touches no Prisma or other I/O, so the timing rules can be reasoned about and
// tested in isolation from the HTTP/persistence layers.
//
// The model tracks, per timed scope (a Test Attempt under Overall Timing or a
// Section Attempt under Sectional Timing), two server-recorded fields:
//   - `accumulatedActiveSeconds`: active time banked from prior `in_progress`
//     intervals.
//   - `lastResumedAt`: the instant the current `in_progress` interval began, or
//     `null` when paused/completed.
// Accumulated Active Time is derived on every request from these plus `now` and
// is never taken from the client (Req 9.2). Because paused intervals are never
// banked, pausing cannot consume remaining time (Req 10.2).

import type { TimedScopeState } from './timing.service.types';

/**
 * Whole seconds elapsed between `from` and `now`, clamped at 0.
 *
 * Sub-second remainders are floored so active time advances only in whole
 * seconds (Req 9.2), and a `now` earlier than `from` (e.g. clock skew) yields 0
 * rather than a negative interval.
 */
function elapsedWholeSeconds(from: Date, now: Date): number {
  const millis = now.getTime() - from.getTime();
  if (!Number.isFinite(millis) || millis <= 0) {
    return 0;
  }
  return Math.floor(millis / 1000);
}

/**
 * Derive Accumulated Active Time (whole seconds) for a scope at instant `now`.
 *
 * When the scope is `in_progress` with a `lastResumedAt`, it is the banked
 * seconds plus the whole seconds elapsed in the current interval; when it is
 * `paused` or `completed` (or has no open interval), it is exactly the banked
 * seconds (Req 9.2, 10.2).
 */
export function accumulatedActiveSeconds(
  scope: TimedScopeState,
  now: Date,
): number {
  if (scope.status === 'in_progress' && scope.lastResumedAt !== null) {
    return scope.accumulatedActiveSeconds + elapsedWholeSeconds(scope.lastResumedAt, now);
  }
  return scope.accumulatedActiveSeconds;
}

/**
 * Remaining time for a scope: `max(0, timeLimit - AccumulatedActiveTime)`
 * (Req 9.3, 12.1). Never negative, so a scope past its limit reports 0.
 */
export function remainingSeconds(
  scope: TimedScopeState,
  timeLimitSeconds: number,
  now: Date,
): number {
  const remaining = timeLimitSeconds - accumulatedActiveSeconds(scope, now);
  return remaining > 0 ? remaining : 0;
}

/**
 * Whether the scope's derived Accumulated Active Time has reached (or passed)
 * its Time Limit (Req 11.2, 12.3). Used to lazily transition a scope to
 * `completed` on the next learner interaction (R2).
 */
export function isExpired(
  scope: TimedScopeState,
  timeLimitSeconds: number,
  now: Date,
): boolean {
  return accumulatedActiveSeconds(scope, now) >= timeLimitSeconds;
}

/**
 * Pure transition — pause: bank the current interval into
 * `accumulatedActiveSeconds`, clear `lastResumedAt`, and mark the scope
 * `paused` (Req 10.1). The banked total is the derived Accumulated Active Time
 * at `now`, so no paused time is ever counted (Req 10.2).
 */
export function pause(scope: TimedScopeState, now: Date): TimedScopeState {
  return {
    status: 'paused',
    accumulatedActiveSeconds: accumulatedActiveSeconds(scope, now),
    lastResumedAt: null,
  };
}

/**
 * Pure transition — resume: begin a new active interval by setting
 * `lastResumedAt = now` and marking the scope `in_progress`, holding the
 * previously banked Accumulated Active Time constant (Req 10.3).
 */
export function resume(scope: TimedScopeState, now: Date): TimedScopeState {
  return {
    status: 'in_progress',
    accumulatedActiveSeconds: scope.accumulatedActiveSeconds,
    lastResumedAt: now,
  };
}

/**
 * Pure transition — complete: bank the final Accumulated Active Time, clear
 * `lastResumedAt`, and mark the scope `completed` (Req 11.2, 12.3). Completion
 * is terminal, so the banked total is frozen for scoring and review.
 */
export function complete(scope: TimedScopeState, now: Date): TimedScopeState {
  return {
    status: 'completed',
    accumulatedActiveSeconds: accumulatedActiveSeconds(scope, now),
    lastResumedAt: null,
  };
}
