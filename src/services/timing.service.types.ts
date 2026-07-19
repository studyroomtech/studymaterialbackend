// Types for the pure server-authoritative timing service (Req 1.15: all
// type/interface declarations live only in `*.types.ts`).
//
// These describe the minimal timed-scope state consumed by the pure functions
// in `timing.service.ts`, which derive Accumulated Active Time and remaining
// time and perform the pause/resume/complete transitions for a timed scope — a
// Test Attempt under Overall Timing or a Section Attempt under Sectional Timing
// (R1, R2; Req 9.2, 10.1–10.3, 11.2, 12.1, 12.3).

import type { AttemptStatus } from '../types/domain.types';

/**
 * A minimal timed scope: the lifecycle status, the active time banked from
 * prior `in_progress` intervals, and the instant the current `in_progress`
 * interval began.
 *
 * - `status`: the scope's Attempt Status (`in_progress`, `paused`, or
 *   `completed`).
 * - `accumulatedActiveSeconds`: whole seconds of active time banked from
 *   completed `in_progress` intervals (never counting paused time — R1).
 * - `lastResumedAt`: the instant the current `in_progress` interval began, or
 *   `null` when the scope is `paused` or `completed`.
 */
export interface TimedScopeState {
  status: AttemptStatus;
  accumulatedActiveSeconds: number;
  lastResumedAt: Date | null;
}
