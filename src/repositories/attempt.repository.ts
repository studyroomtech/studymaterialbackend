// Test Attempt repository (Req 9, 10, 11, 12, 14, 15).
//
// Wraps Prisma access to the `TestAttempt`, `SectionAttempt`, and `Response`
// tables, backing the learner attempt lifecycle. Timing is server-authoritative
// and stored as `accumulatedActiveSeconds` + `lastResumedAt` per timed scope
// (R1); the Score is an integer sum of centi-marks written on completion (R3,
// Req 13.5). Finalizing an attempt (mark completed, record Score/`completedAt`,
// close still-open Section Attempts) runs inside a single Prisma transaction so
// a failure persists no partial state (all-or-nothing, Req 16.4). Timestamps are
// managed by the schema and serialized ISO 8601 by the service layer (Req 16.3).

import type {
  Response,
  SectionAttempt,
  TestAttempt,
} from '@prisma/client';

import { getPrismaClient } from './prismaClient';
import type {
  AttemptReviewRecord,
  AttemptStateRecord,
  CompleteAttemptInput,
  CompletedAttemptRecord,
  CreateAttemptInput,
  CreateSectionAttemptInput,
  FindActiveAttemptInput,
  UpdateAttemptTimingInput,
  UpdateSectionAttemptInput,
  UpsertResponseInput,
} from './attempt.repository.types';

/** Attempt Statuses that denote an in-flight (resumable) attempt (Req 9.5, 15.4). */
const IN_FLIGHT_STATUSES = ['in_progress', 'paused'] as const;

/**
 * Find the in_progress/paused Test Attempt for `(userId, testId, scope)`, or
 * `null` when none exists (Req 9.5, 15.4). `scopedSectionId` is matched exactly
 * (`null` for a whole-Test attempt), so a Section-scoped attempt never masks a
 * whole-Test attempt and vice versa. Relies on the `@@index([userId, testId])`.
 */
export function findActiveAttempt(
  input: FindActiveAttemptInput,
): Promise<TestAttempt | null> {
  return getPrismaClient().testAttempt.findFirst({
    where: {
      userId: input.userId,
      testId: input.testId,
      scopedSectionId: input.scopedSectionId,
      status: { in: [...IN_FLIGHT_STATUSES] },
    },
  });
}

/**
 * Create a new Test Attempt (Req 9.1, 8.1, 8.2). A whole-Test attempt passes
 * `scopedSectionId: null`; a Section-scoped attempt passes the covered Section
 * id. `status` and `accumulatedActiveSeconds` fall back to the schema defaults
 * (`in_progress` / `0`) when omitted.
 */
export function createAttempt(
  input: CreateAttemptInput,
): Promise<TestAttempt> {
  return getPrismaClient().testAttempt.create({
    data: {
      userId: input.userId,
      testId: input.testId,
      scopedSectionId: input.scopedSectionId,
      startedAt: input.startedAt,
      lastResumedAt: input.lastResumedAt,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.accumulatedActiveSeconds !== undefined
        ? { accumulatedActiveSeconds: input.accumulatedActiveSeconds }
        : {}),
    },
  });
}

/**
 * Load an owner-scoped Test Attempt with the working state a lifecycle action
 * needs — the Test's timing mode and overall Time Limit, each Section Attempt
 * with its Section's per-Section Time Limit and order, and the recorded
 * Responses — or `null` when the attempt does not exist or is not owned by the
 * caller (so ownership failures surface uniformly as NOT_FOUND, Req 8.6).
 */
export function findAttemptState(
  userId: string,
  attemptId: string,
): Promise<AttemptStateRecord | null> {
  return getPrismaClient().testAttempt.findFirst({
    where: { id: attemptId, userId },
    include: {
      test: {
        select: {
          id: true,
          title: true,
          timingMode: true,
          timeLimitSeconds: true,
        },
      },
      sectionAttempts: {
        include: {
          section: {
            select: { id: true, orderIndex: true, timeLimitSeconds: true },
          },
        },
        orderBy: { section: { orderIndex: 'asc' } },
      },
      responses: true,
    },
  });
}

/**
 * Find the Section Attempt for `(testAttemptId, sectionId)`, or `null` when it
 * has not been started yet (Req 12.2). Uses the `@@unique([testAttemptId,
 * sectionId])` compound key.
 */
export function findSectionAttempt(
  testAttemptId: string,
  sectionId: string,
): Promise<SectionAttempt | null> {
  return getPrismaClient().sectionAttempt.findUnique({
    where: { testAttemptId_sectionId: { testAttemptId, sectionId } },
  });
}

/**
 * Create a Section Attempt for its Test Attempt (Req 12.2). `status` and
 * `accumulatedActiveSeconds` fall back to the schema defaults when omitted.
 */
export function createSectionAttempt(
  input: CreateSectionAttemptInput,
): Promise<SectionAttempt> {
  return getPrismaClient().sectionAttempt.create({
    data: {
      testAttemptId: input.testAttemptId,
      sectionId: input.sectionId,
      startedAt: input.startedAt,
      lastResumedAt: input.lastResumedAt,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.accumulatedActiveSeconds !== undefined
        ? { accumulatedActiveSeconds: input.accumulatedActiveSeconds }
        : {}),
    },
  });
}

/**
 * Update a Section Attempt's timing/lifecycle fields (Req 10, 12). Only the
 * supplied fields are written; an omitted field is untouched, and an explicit
 * `null` clears the column (e.g. `lastResumedAt = null` on pause/complete).
 */
export function updateSectionAttempt(
  id: string,
  input: UpdateSectionAttemptInput,
): Promise<SectionAttempt> {
  return getPrismaClient().sectionAttempt.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      ...(input.accumulatedActiveSeconds !== undefined
        ? { accumulatedActiveSeconds: input.accumulatedActiveSeconds }
        : {}),
      ...(input.lastResumedAt !== undefined
        ? { lastResumedAt: input.lastResumedAt }
        : {}),
      ...(input.completedAt !== undefined
        ? { completedAt: input.completedAt }
        : {}),
    },
  });
}

/**
 * Persist a Test Attempt's timing/lifecycle fields for pause, resume, and the
 * derived auto-close transition (Req 10.1, 10.3, 11.2). Completion (Score +
 * `completedAt` + closing Sections) is handled by `completeAttempt` so it can
 * run transactionally. Only supplied fields are written; `null` clears a column.
 */
export function updateAttemptTiming(
  id: string,
  input: UpdateAttemptTimingInput,
): Promise<TestAttempt> {
  return getPrismaClient().testAttempt.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.accumulatedActiveSeconds !== undefined
        ? { accumulatedActiveSeconds: input.accumulatedActiveSeconds }
        : {}),
      ...(input.lastResumedAt !== undefined
        ? { lastResumedAt: input.lastResumedAt }
        : {}),
    },
  });
}

/**
 * Upsert the Learner's Response for a Question (Req 9.4). Keyed by the
 * `@@unique([testAttemptId, questionId])` compound, so re-answering a Question
 * overwrites the recorded selection instead of creating a second Response.
 */
export function upsertResponse(input: UpsertResponseInput): Promise<Response> {
  return getPrismaClient().response.upsert({
    where: {
      testAttemptId_questionId: {
        testAttemptId: input.testAttemptId,
        questionId: input.questionId,
      },
    },
    update: { selectedOptionIds: input.selectedOptionIds },
    create: {
      testAttemptId: input.testAttemptId,
      questionId: input.questionId,
      selectedOptionIds: input.selectedOptionIds,
    },
  });
}

/**
 * Finalize an attempt inside a single transaction (Req 11.4, 12.7, 13.5,
 * 16.4): close any still-open Section Attempts, then mark the Test Attempt
 * `completed` with its computed Score (centi-marks), `completedAt`, final banked
 * active time, and cleared `lastResumedAt`. Because all writes share one
 * transaction, a failure leaves the attempt and its Sections unchanged — no
 * partial completion is persisted. Returns the updated Test Attempt.
 */
export function completeAttempt(
  input: CompleteAttemptInput,
): Promise<TestAttempt> {
  return getPrismaClient().$transaction(async (tx) => {
    for (const section of input.sectionCompletions ?? []) {
      await tx.sectionAttempt.update({
        where: { id: section.id },
        data: {
          status: 'completed',
          accumulatedActiveSeconds: section.accumulatedActiveSeconds,
          lastResumedAt: null,
          completedAt: section.completedAt,
        },
      });
    }
    return tx.testAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: 'completed',
        scoreCentimarks: input.scoreCentimarks,
        completedAt: input.completedAt,
        accumulatedActiveSeconds: input.accumulatedActiveSeconds,
        lastResumedAt: null,
      },
    });
  });
}

/**
 * List the Learner's completed attempts for the history view, most recently
 * completed first (Req 14.1). Each row carries its parent Test's id and title;
 * the Score (`scoreCentimarks`) and `completedAt` live on the attempt itself.
 * Relies on the `@@index([userId, status])`.
 */
export function listCompletedAttempts(
  userId: string,
): Promise<CompletedAttemptRecord[]> {
  return getPrismaClient().testAttempt.findMany({
    where: { userId, status: 'completed' },
    include: { test: { select: { id: true, title: true } } },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
  });
}

/**
 * Load one owner-scoped attempt with the full review graph (Req 14.2, 14.4):
 * the Test title and its ordered Sections → Questions → Options (each Option
 * carrying `isCorrect`, so the Correct Option Set is derivable), the Learner's
 * recorded Responses, and the Section Attempts. Returns `null` when the attempt
 * does not exist or is not owned by the caller, so both surface uniformly as
 * NOT_FOUND (Req 14.4). This graph also carries the correct sets used to compute
 * the Score on submit.
 */
export function findAttemptForReview(
  userId: string,
  attemptId: string,
): Promise<AttemptReviewRecord | null> {
  return getPrismaClient().testAttempt.findFirst({
    where: { id: attemptId, userId },
    include: {
      test: {
        include: {
          sections: {
            orderBy: { orderIndex: 'asc' },
            include: {
              questions: {
                orderBy: { orderIndex: 'asc' },
                include: { options: { orderBy: { orderIndex: 'asc' } } },
              },
            },
          },
        },
      },
      sectionAttempts: true,
      responses: true,
    },
  });
}
