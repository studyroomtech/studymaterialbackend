// Types for the Test Attempt repository (Req 1.15: type declarations live only
// in `*.types.ts`).
//
// The Attempt repository backs the learner attempt lifecycle (Req 9, 10, 11,
// 12, 14, 15): starting/resuming an attempt, recording per-Question Responses,
// persisting server-authoritative timing fields, finalizing an attempt with its
// Score inside a single transaction (all-or-nothing, Req 16.4), and loading
// completed attempts for the history list and the review view. Timing is stored
// as `accumulatedActiveSeconds` + `lastResumedAt` per timed scope (R1); marks as
// integer centi-marks (R3).

import type {
  Prisma,
  Response,
  SectionAttempt,
  TestAttempt,
} from '@prisma/client';

import type { AttemptStatus } from '../types/domain.types';

/**
 * Criteria for locating an in-flight (in_progress or paused) Test Attempt for a
 * given Learner and Test (Req 9.5, 15.4). `scopedSectionId` distinguishes a
 * whole-Test attempt (`null`) from a Section-scoped attempt (the covered
 * Section id), so start/retake return the correct existing attempt rather than
 * creating a duplicate.
 */
export interface FindActiveAttemptInput {
  userId: string;
  testId: string;
  scopedSectionId: string | null;
}

/**
 * Fields persisted when a new Test Attempt is created (Req 9.1, 8.1, 8.2). A
 * whole-Test attempt leaves `scopedSectionId` null; a Section-scoped attempt
 * (bought via a Section Entitlement) sets it to the single covered Section.
 * `startedAt` is the Start Timestamp; `lastResumedAt` opens the first
 * in_progress interval. `status`/`accumulatedActiveSeconds` fall back to the
 * schema defaults (`in_progress` / `0`) when omitted.
 */
export interface CreateAttemptInput {
  userId: string;
  testId: string;
  scopedSectionId: string | null;
  startedAt: Date;
  lastResumedAt: Date | null;
  status?: AttemptStatus;
  accumulatedActiveSeconds?: number;
}

/**
 * Fields persisted when a Section Attempt is created (Req 12.2). `startedAt` is
 * recorded on the first in_progress transition; `lastResumedAt` opens the
 * current interval. Omitted `status`/`accumulatedActiveSeconds` use the schema
 * defaults.
 */
export interface CreateSectionAttemptInput {
  testAttemptId: string;
  sectionId: string;
  startedAt: Date | null;
  lastResumedAt: Date | null;
  status?: AttemptStatus;
  accumulatedActiveSeconds?: number;
}

/**
 * Mutable Section Attempt timing/lifecycle fields (Req 10, 12). Every field is
 * optional: an omitted field is left untouched, while an explicit `null` clears
 * the column (e.g. `lastResumedAt = null` when pausing/completing).
 */
export interface UpdateSectionAttemptInput {
  status?: AttemptStatus;
  startedAt?: Date | null;
  accumulatedActiveSeconds?: number;
  lastResumedAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * Mutable Test Attempt timing/lifecycle fields for pause/resume and the derived
 * auto-close transition (Req 10.1, 10.3, 11.2). Completion (status + Score +
 * completedAt) is handled separately by `completeAttempt` so it can run inside a
 * transaction. An omitted field is left untouched; an explicit `null` clears it.
 */
export interface UpdateAttemptTimingInput {
  status?: AttemptStatus;
  accumulatedActiveSeconds?: number;
  lastResumedAt?: Date | null;
}

/**
 * The Learner's selected Option set for one Question in an attempt (Req 9.4).
 * Keyed by `@@unique([testAttemptId, questionId])`, so re-answering a Question
 * upserts the same row rather than creating a duplicate Response.
 */
export interface UpsertResponseInput {
  testAttemptId: string;
  questionId: string;
  selectedOptionIds: string[];
}

/**
 * A Section Attempt to close as part of finalizing a Test Attempt: its banked
 * active time and completion instant (Req 12.3, 12.7).
 */
export interface CompleteSectionAttemptInput {
  id: string;
  accumulatedActiveSeconds: number;
  completedAt: Date;
}

/**
 * The final state written when an attempt is finalized (Req 11.4, 12.7, 13.5).
 * The Test Attempt is marked `completed` with its computed Score (centi-marks)
 * and `completedAt`, its final banked active time recorded and `lastResumedAt`
 * cleared, and any still-open Section Attempts closed — all in one transaction
 * so no partial state persists on failure (Req 16.4).
 */
export interface CompleteAttemptInput {
  attemptId: string;
  scoreCentimarks: number;
  completedAt: Date;
  accumulatedActiveSeconds: number;
  sectionCompletions?: CompleteSectionAttemptInput[];
}

/**
 * A Test Attempt loaded with the working state needed to evaluate and report
 * timing on a lifecycle action (start/pause/resume/respond): the parent Test's
 * timing mode and overall Time Limit, each Section Attempt with its Section's
 * per-Section Time Limit and order, and the recorded Responses.
 */
export type AttemptStateRecord = Prisma.TestAttemptGetPayload<{
  include: {
    test: {
      select: {
        id: true;
        title: true;
        timingMode: true;
        timeLimitSeconds: true;
      };
    };
    sectionAttempts: {
      include: {
        section: {
          select: { id: true; orderIndex: true; timeLimitSeconds: true };
        };
      };
    };
    responses: true;
  };
}>;

/**
 * A completed Test Attempt summarized for the history list (Req 14.1): the
 * attempt with its parent Test's id and title (Score/`completedAt` live on the
 * attempt itself).
 */
export type CompletedAttemptRecord = Prisma.TestAttemptGetPayload<{
  include: { test: { select: { id: true; title: true } } };
}>;

/**
 * A single completed Test Attempt loaded with the full graph the review view
 * needs (Req 14.2): the Test title and its ordered Sections → Questions →
 * Options (each Option carrying `isCorrect`, so the Correct Option Set is
 * derivable), plus the Learner's recorded Responses and the Section Attempts.
 * This same graph carries the correct sets used to compute the Score on submit.
 */
export type AttemptReviewRecord = Prisma.TestAttemptGetPayload<{
  include: {
    test: {
      include: {
        sections: {
          include: {
            questions: {
              include: { options: true };
            };
          };
        };
      };
    };
    sectionAttempts: true;
    responses: true;
  };
}>;

/**
 * The Test Attempt repository contract (Req 9–15). All persistence for the
 * attempt lifecycle is reached through this interface so the attempt service
 * stays a pure composition of the timing/scoring/access cores over injected I/O.
 */
export interface AttemptRepository {
  /** Find the in_progress/paused attempt for `(userId, testId, scope)`, or null (Req 9.5, 15.4). */
  findActiveAttempt(input: FindActiveAttemptInput): Promise<TestAttempt | null>;
  /** Create a whole-Test or Section-scoped Test Attempt (Req 9.1, 8.1, 8.2). */
  createAttempt(input: CreateAttemptInput): Promise<TestAttempt>;
  /** Load an owner-scoped attempt with the working state for a lifecycle action, or null. */
  findAttemptState(
    userId: string,
    attemptId: string,
  ): Promise<AttemptStateRecord | null>;
  /** Find the Section Attempt for `(testAttemptId, sectionId)`, or null (Req 12.2). */
  findSectionAttempt(
    testAttemptId: string,
    sectionId: string,
  ): Promise<SectionAttempt | null>;
  /** Create a Section Attempt (Req 12.2). */
  createSectionAttempt(
    input: CreateSectionAttemptInput,
  ): Promise<SectionAttempt>;
  /** Update a Section Attempt's timing/lifecycle fields (Req 10, 12). */
  updateSectionAttempt(
    id: string,
    input: UpdateSectionAttemptInput,
  ): Promise<SectionAttempt>;
  /** Persist a Test Attempt's timing/lifecycle fields for pause/resume/derived close (Req 10, 11.2). */
  updateAttemptTiming(
    id: string,
    input: UpdateAttemptTimingInput,
  ): Promise<TestAttempt>;
  /** Upsert the Learner's Response for a Question, keyed by the compound unique (Req 9.4). */
  upsertResponse(input: UpsertResponseInput): Promise<Response>;
  /** Finalize an attempt (status + Score + completedAt + open Sections) in one transaction (Req 11.4, 12.7, 16.4). */
  completeAttempt(input: CompleteAttemptInput): Promise<TestAttempt>;
  /** List the Learner's completed attempts, most recently completed first (Req 14.1). */
  listCompletedAttempts(userId: string): Promise<CompletedAttemptRecord[]>;
  /** Load one owner-scoped completed attempt with its full review graph, or null (Req 14.2, 14.4). */
  findAttemptForReview(
    userId: string,
    attemptId: string,
  ): Promise<AttemptReviewRecord | null>;
}
