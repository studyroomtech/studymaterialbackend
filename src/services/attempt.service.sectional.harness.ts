// In-memory test harness for the attempt lifecycle service.
//
// Builds `createAttemptService` over hand-rolled repositories backed by plain
// objects plus a manually advanced clock, so the Sequential Sectional Timing
// transitions can be driven deterministically without Prisma or a database.
// Consumed by `attempt.service.sectional.test.ts`.
//
// Two fixtures are available: `test-1` is a free Sectional Timing Test with
// three Sections (60s / 120s / 180s limits, one Question each), and
// `test-overall` is a free Overall Timing Test with a single 300s clock, used to
// prove the Sequential changes leave Overall Timing alone.
//
// `findAttemptState` deliberately returns Section Attempts in reverse order, so
// any logic that depends on Admin-defined Section order has to sort for itself
// rather than relying on the repository's `orderBy`.

import { createAttemptService } from './attempt.service';
import type { AttemptService } from './attempt.service.types';
import type {
  AttemptReviewRecord,
  AttemptStateRecord,
  CreateAttemptInput,
  CreateSectionAttemptInput,
  UpdateAttemptTimingInput,
  UpdateSectionAttemptInput,
  UpsertResponseInput,
} from '../repositories/attempt.repository.types';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');
const USER_ID = 'user-1';

// --- Fixture graph --------------------------------------------------------

function makeOption(id: string, isCorrect: boolean, orderIndex: number) {
  return { id, text: `Option ${id}`, isCorrect, orderIndex };
}

function makeQuestion(id: string, sectionId: string) {
  return {
    id,
    sectionId,
    text: `Question ${id}`,
    orderIndex: 0,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    options: [
      makeOption(`${id.replace('question-', 'option-')}-correct`, true, 0),
      makeOption(`${id.replace('question-', 'option-')}-wrong`, false, 1),
    ],
  };
}

function makeSection(
  id: string,
  testId: string,
  title: string,
  orderIndex: number,
  timeLimitSeconds: number,
  questionId: string,
) {
  return {
    id,
    testId,
    title,
    orderIndex,
    timeLimitSeconds,
    correctMarkCenti: 100,
    negativeMarkCenti: 25,
    priceAmount: null,
    currency: 'INR',
    createdAt: EPOCH,
    updatedAt: EPOCH,
    questions: [makeQuestion(questionId, id)],
  };
}

function makeFixtureTests() {
  return [
    {
      id: 'test-1',
      title: 'Sequential Sectional Test',
      timingMode: 'sectional' as const,
      timeLimitSeconds: 600,
      priceAmount: null,
      currency: 'INR',
      createdAt: EPOCH,
      updatedAt: EPOCH,
      sections: [
        makeSection('section-a', 'test-1', 'Section A', 0, 60, 'question-a1'),
        makeSection('section-b', 'test-1', 'Section B', 1, 120, 'question-b1'),
        makeSection('section-c', 'test-1', 'Section C', 2, 180, 'question-c1'),
      ],
    },
    {
      id: 'test-overall',
      title: 'Overall Timing Test',
      timingMode: 'overall' as const,
      timeLimitSeconds: 300,
      priceAmount: null,
      currency: 'INR',
      createdAt: EPOCH,
      updatedAt: EPOCH,
      sections: [
        makeSection(
          'section-ob',
          'test-overall',
          'Only Section',
          0,
          100,
          'question-ob1',
        ),
      ],
    },
  ];
}

// --- Mutable store --------------------------------------------------------

// Not exported directly: the accessors below expose exactly what the assertions
// need, keeping the shape of the store an implementation detail.
const state = {
  clock: new Date(EPOCH),
  tests: makeFixtureTests(),
  attempts: [] as ReturnType<typeof makeAttemptRow>[],
  sectionAttempts: [] as ReturnType<typeof makeSectionAttemptRow>[],
  responses: [] as { testAttemptId: string; questionId: string; selectedOptionIds: string[] }[],
  nextAttemptNumber: 1,
  nextSectionAttemptNumber: 1,
};

function makeAttemptRow(input: CreateAttemptInput, id: string) {
  return {
    id,
    userId: input.userId,
    testId: input.testId,
    scopedSectionId: input.scopedSectionId,
    status: input.status ?? ('in_progress' as const),
    startedAt: input.startedAt,
    accumulatedActiveSeconds: input.accumulatedActiveSeconds ?? 0,
    lastResumedAt: input.lastResumedAt,
    scoreCentimarks: null as number | null,
    completedAt: null as Date | null,
    createdAt: input.startedAt,
    updatedAt: input.startedAt,
  };
}

function makeSectionAttemptRow(input: CreateSectionAttemptInput, id: string) {
  return {
    id,
    testAttemptId: input.testAttemptId,
    sectionId: input.sectionId,
    status: input.status ?? ('in_progress' as const),
    startedAt: input.startedAt,
    accumulatedActiveSeconds: input.accumulatedActiveSeconds ?? 0,
    lastResumedAt: input.lastResumedAt,
    completedAt: null as Date | null,
  };
}

function findTestById(testId: string) {
  const test = state.tests.find((t) => t.id === testId);
  if (test === undefined) {
    throw new Error(`Fixture Test "${testId}" does not exist.`);
  }
  return test;
}

function findSectionById(sectionId: string) {
  for (const test of state.tests) {
    const section = test.sections.find((s) => s.id === sectionId);
    if (section !== undefined) {
      return { test, section };
    }
  }
  throw new Error(`Fixture Section "${sectionId}" does not exist.`);
}

// --- Public harness API ---------------------------------------------------

/**
 * Reset every fixture and build a fresh service. Call from `beforeEach` so no
 * attempt, Response, or clock movement leaks between tests.
 */
export function buildService(): AttemptService {
  state.clock = new Date(EPOCH);
  state.attempts = [];
  state.sectionAttempts = [];
  state.responses = [];
  state.nextAttemptNumber = 1;
  state.nextSectionAttemptNumber = 1;

  return createAttemptService({
    tests: {
      async findTestGraphById(id) {
        const test = state.tests.find((t) => t.id === id);
        return (test ?? null) as never;
      },
      async findSectionGraphById(id) {
        for (const test of state.tests) {
          const section = test.sections.find((s) => s.id === id);
          if (section !== undefined) {
            return { ...section, test } as never;
          }
        }
        return null as never;
      },
    },
    attempts: {
      async findActiveAttempt(input) {
        const row = state.attempts.find(
          (a) =>
            a.userId === input.userId &&
            a.testId === input.testId &&
            a.scopedSectionId === input.scopedSectionId &&
            (a.status === 'in_progress' || a.status === 'paused'),
        );
        return (row ?? null) as never;
      },
      async createAttempt(input) {
        const row = makeAttemptRow(input, `attempt-${state.nextAttemptNumber}`);
        state.nextAttemptNumber += 1;
        state.attempts.push(row);
        return row as never;
      },
      async findAttemptState(userId, attemptId) {
        return buildAttemptStateRecord(userId, attemptId);
      },
      async findSectionAttempt(testAttemptId, sectionId) {
        const row = state.sectionAttempts.find(
          (sa) =>
            sa.testAttemptId === testAttemptId && sa.sectionId === sectionId,
        );
        return (row ?? null) as never;
      },
      async createSectionAttempt(input) {
        const row = makeSectionAttemptRow(
          input,
          `section-attempt-${state.nextSectionAttemptNumber}`,
        );
        state.nextSectionAttemptNumber += 1;
        state.sectionAttempts.push(row);
        return row as never;
      },
      async updateSectionAttempt(id, input) {
        const row = state.sectionAttempts.find((sa) => sa.id === id);
        if (row === undefined) {
          throw new Error(`Unknown Section Attempt "${id}".`);
        }
        applySectionAttemptUpdate(row, input);
        return row as never;
      },
      async updateAttemptTiming(id, input) {
        const row = state.attempts.find((a) => a.id === id);
        if (row === undefined) {
          throw new Error(`Unknown Test Attempt "${id}".`);
        }
        applyAttemptTimingUpdate(row, input);
        return row as never;
      },
      async upsertResponse(input: UpsertResponseInput) {
        const existing = state.responses.find(
          (r) =>
            r.testAttemptId === input.testAttemptId &&
            r.questionId === input.questionId,
        );
        if (existing !== undefined) {
          existing.selectedOptionIds = input.selectedOptionIds;
          return existing as never;
        }
        const row = { ...input };
        state.responses.push(row);
        return row as never;
      },
      async completeAttempt(input) {
        for (const completion of input.sectionCompletions ?? []) {
          const row = state.sectionAttempts.find(
            (sa) => sa.id === completion.id,
          );
          if (row === undefined) {
            continue;
          }
          row.status = 'completed';
          row.accumulatedActiveSeconds = completion.accumulatedActiveSeconds;
          row.lastResumedAt = null;
          row.completedAt = completion.completedAt;
        }
        const attempt = state.attempts.find((a) => a.id === input.attemptId);
        if (attempt === undefined) {
          throw new Error(`Unknown Test Attempt "${input.attemptId}".`);
        }
        attempt.status = 'completed';
        attempt.scoreCentimarks = input.scoreCentimarks;
        attempt.completedAt = input.completedAt;
        attempt.accumulatedActiveSeconds = input.accumulatedActiveSeconds;
        attempt.lastResumedAt = null;
        return attempt as never;
      },
      async listCompletedAttempts(userId) {
        return state.attempts
          .filter((a) => a.userId === userId && a.status === 'completed')
          .map((a) => buildAttemptReviewRecord(userId, a.id)) as never;
      },
      async findAttemptForReview(userId, attemptId) {
        return buildAttemptReviewRecord(userId, attemptId);
      },
    },
    entitlements: {
      async listEntitledTestIds() {
        return [];
      },
      async listEntitledSectionIds() {
        return [];
      },
    },
    users: {
      async findUserById(id) {
        return id === USER_ID ? { id } : null;
      },
    },
    verifyToken(token) {
      if (token !== 'learner-token') {
        return null;
      }
      return {
        role: 'role_common',
        sub: USER_ID,
        email: 'learner@example.com',
        roles: [],
      };
    },
    now: () => new Date(state.clock),
  });
}

/** Move the injected clock to `seconds` past the fixture epoch. */
export function advanceTo(seconds: number): void {
  state.clock = new Date(EPOCH.getTime() + seconds * 1000);
}

/**
 * Reconfigure the Sectional fixture. `reverseSectionStorageOrder` hands the
 * Sections back in descending `orderIndex`, proving activation follows the
 * Admin-defined order rather than whatever order storage returns.
 */
export function setSectionalTest(options: {
  reverseSectionStorageOrder?: boolean;
}): void {
  state.tests = makeFixtureTests();
  if (options.reverseSectionStorageOrder === true) {
    const test = findTestById('test-1');
    test.sections = [...test.sections].reverse();
  }
}

/** Every Section Attempt's status, keyed by Section id. */
export function sectionStatuses(): Record<string, string> {
  const statuses: Record<string, string> = {};
  for (const sa of state.sectionAttempts) {
    statuses[sa.sectionId] = sa.status;
  }
  return statuses;
}

/** The persisted Section Attempt rows, in creation order. */
export function sectionAttemptRows(): ReturnType<typeof makeSectionAttemptRow>[] {
  return state.sectionAttempts;
}

/** The persisted Test Attempt rows, in creation order. */
export function attemptRows(): ReturnType<typeof makeAttemptRow>[] {
  return state.attempts;
}

// --- Record builders ------------------------------------------------------

function applySectionAttemptUpdate(
  row: ReturnType<typeof makeSectionAttemptRow>,
  input: UpdateSectionAttemptInput,
): void {
  if (input.status !== undefined) {
    row.status = input.status;
  }
  if (input.startedAt !== undefined) {
    row.startedAt = input.startedAt;
  }
  if (input.accumulatedActiveSeconds !== undefined) {
    row.accumulatedActiveSeconds = input.accumulatedActiveSeconds;
  }
  if (input.lastResumedAt !== undefined) {
    row.lastResumedAt = input.lastResumedAt;
  }
  if (input.completedAt !== undefined) {
    row.completedAt = input.completedAt;
  }
}

function applyAttemptTimingUpdate(
  row: ReturnType<typeof makeAttemptRow>,
  input: UpdateAttemptTimingInput,
): void {
  if (input.status !== undefined) {
    row.status = input.status;
  }
  if (input.accumulatedActiveSeconds !== undefined) {
    row.accumulatedActiveSeconds = input.accumulatedActiveSeconds;
  }
  if (input.lastResumedAt !== undefined) {
    row.lastResumedAt = input.lastResumedAt;
  }
}

function buildAttemptStateRecord(
  userId: string,
  attemptId: string,
): AttemptStateRecord | null {
  const attempt = state.attempts.find(
    (a) => a.id === attemptId && a.userId === userId,
  );
  if (attempt === undefined) {
    return null;
  }
  const test = findTestById(attempt.testId);
  const sectionAttempts = state.sectionAttempts
    .filter((sa) => sa.testAttemptId === attempt.id)
    .map((sa) => ({
      ...sa,
      section: findSectionById(sa.sectionId).section,
    }))
    // Reversed on purpose: consumers must not depend on repository ordering.
    .reverse();

  return {
    ...attempt,
    test: {
      id: test.id,
      title: test.title,
      timingMode: test.timingMode,
      timeLimitSeconds: test.timeLimitSeconds,
      sections: [...test.sections].sort((a, b) => a.orderIndex - b.orderIndex),
    },
    sectionAttempts,
    responses: state.responses.filter((r) => r.testAttemptId === attempt.id),
  } as unknown as AttemptStateRecord;
}

function buildAttemptReviewRecord(
  userId: string,
  attemptId: string,
): AttemptReviewRecord | null {
  const attempt = state.attempts.find(
    (a) => a.id === attemptId && a.userId === userId,
  );
  if (attempt === undefined) {
    return null;
  }
  const test = findTestById(attempt.testId);

  return {
    ...attempt,
    test: {
      ...test,
      sections: [...test.sections].sort((a, b) => a.orderIndex - b.orderIndex),
    },
    sectionAttempts: state.sectionAttempts.filter(
      (sa) => sa.testAttemptId === attempt.id,
    ),
    responses: state.responses.filter((r) => r.testAttemptId === attempt.id),
  } as unknown as AttemptReviewRecord;
}
