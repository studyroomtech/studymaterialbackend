// Tests for the pure attempt analytics core (Req 14.1, 14.2).
//
// The core is pure, so every case here is a plain literal in / plain object out
// — no repositories, no clock, no database. The fixtures deliberately give the
// two Sections different marking schemes (Req 3.1), since a per-Section
// breakdown that merely divides the total would pass a same-marks fixture.
//
// **Validates: Requirements 3.1, 13.1, 13.2, 13.3, 13.4, 13.5, 14.1, 14.2**

import { describe, expect, it } from 'vitest';

import { analyzeAttempt, buildPerformance } from './performance.service';
import type {
  PerformanceAttemptInput,
  PerformanceSectionInput,
} from './performance.service.types';

// --- Fixtures -------------------------------------------------------------

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

/**
 * A Section of `questionCount` two-Option Questions where the first Option is
 * always the single correct one, so a Response of `['<questionId>-a']` is
 * Correct and `['<questionId>-b']` is Incorrect.
 */
function makeSection(
  id: string,
  overrides: Partial<PerformanceSectionInput> & { questionCount: number },
): PerformanceSectionInput {
  const questions = Array.from({ length: overrides.questionCount }, (_, i) => ({
    id: `${id}-q${i + 1}`,
    options: [
      { id: `${id}-q${i + 1}-a`, isCorrect: true },
      { id: `${id}-q${i + 1}-b`, isCorrect: false },
    ],
  }));
  return {
    id,
    title: overrides.title ?? `Section ${id}`,
    orderIndex: overrides.orderIndex ?? 0,
    timeLimitSeconds: overrides.timeLimitSeconds ?? 600,
    correctMarkCenti: overrides.correctMarkCenti ?? 100,
    negativeMarkCenti: overrides.negativeMarkCenti ?? 0,
    questions,
  };
}

/** The correct Option id for a Question, per `makeSection`'s convention. */
function correct(questionId: string): string[] {
  return [`${questionId}-a`];
}

/** An incorrect (but recorded) Option id for a Question. */
function wrong(questionId: string): string[] {
  return [`${questionId}-b`];
}

function makeAttempt(
  overrides: Partial<PerformanceAttemptInput> & {
    id: string;
    sections: PerformanceSectionInput[];
  },
): PerformanceAttemptInput {
  return {
    id: overrides.id,
    scopedSectionId: overrides.scopedSectionId ?? null,
    accumulatedActiveSeconds: overrides.accumulatedActiveSeconds ?? 0,
    scoreCentimarks: overrides.scoreCentimarks ?? null,
    completedAt: overrides.completedAt ?? EPOCH,
    createdAt: overrides.createdAt ?? EPOCH,
    test: {
      id: overrides.test?.id ?? 'test-1',
      title: overrides.test?.title ?? 'Mock Test',
      sections: overrides.sections,
    },
    sectionAttempts: overrides.sectionAttempts ?? [],
    responses: overrides.responses ?? [],
  };
}

// --- analyzeAttempt -------------------------------------------------------

describe('analyzeAttempt — Question classification', () => {
  const section = makeSection('sec-a', { questionCount: 3 });

  it('classifies an exactly-correct selection as Correct (Req 13.1)', () => {
    const { summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [section],
        responses: [
          { questionId: 'sec-a-q1', selectedOptionIds: correct('sec-a-q1') },
        ],
      }),
    );

    expect(summary.correctCount).toBe(1);
    expect(summary.incorrectCount).toBe(0);
    expect(summary.unansweredCount).toBe(2);
  });

  it('classifies a Question with no recorded Response as Unanswered (Req 13.4)', () => {
    const { summary } = analyzeAttempt(
      makeAttempt({ id: 'attempt-1', sections: [section] }),
    );

    expect(summary.unansweredCount).toBe(3);
    expect(summary.correctCount).toBe(0);
    expect(summary.incorrectCount).toBe(0);
  });

  it('classifies a recorded but empty selection as Incorrect, matching what scoring charges (Req 13.3)', () => {
    // `scoreQuestion` only treats an ABSENT Response as unanswered; a recorded
    // empty set is answered-and-wrong and is charged the Negative Mark. The
    // counts must agree with the Score or the two would contradict each other.
    const { summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [makeSection('sec-a', { questionCount: 1, negativeMarkCenti: 50 })],
        responses: [{ questionId: 'sec-a-q1', selectedOptionIds: [] }],
      }),
    );

    expect(summary.incorrectCount).toBe(1);
    expect(summary.unansweredCount).toBe(0);
  });

  it('keeps the three counts a partition of the in-scope Questions', () => {
    const { summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [section],
        responses: [
          { questionId: 'sec-a-q1', selectedOptionIds: correct('sec-a-q1') },
          { questionId: 'sec-a-q2', selectedOptionIds: wrong('sec-a-q2') },
        ],
      }),
    );

    expect(summary.totalQuestions).toBe(3);
    expect(
      summary.correctCount + summary.incorrectCount + summary.unansweredCount,
    ).toBe(summary.totalQuestions);
  });
});

describe('analyzeAttempt — marks, percentage, and accuracy', () => {
  it('scores each Section under its OWN marking scheme (Req 3.1)', () => {
    // Section A: 2 marks correct / 0.5 penalty. Section B: 1 mark / 0.25.
    const sectionA = makeSection('sec-a', {
      questionCount: 2,
      orderIndex: 0,
      correctMarkCenti: 200,
      negativeMarkCenti: 50,
    });
    const sectionB = makeSection('sec-b', {
      questionCount: 2,
      orderIndex: 1,
      correctMarkCenti: 100,
      negativeMarkCenti: 25,
    });

    const { sections, summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [sectionA, sectionB],
        responses: [
          { questionId: 'sec-a-q1', selectedOptionIds: correct('sec-a-q1') },
          { questionId: 'sec-a-q2', selectedOptionIds: wrong('sec-a-q2') },
          { questionId: 'sec-b-q1', selectedOptionIds: correct('sec-b-q1') },
          { questionId: 'sec-b-q2', selectedOptionIds: wrong('sec-b-q2') },
        ],
      }),
    );

    // A: +2 - 0.5 = 1.5 out of 4. B: +1 - 0.25 = 0.75 out of 2.
    expect(sections[0]).toMatchObject({
      sectionId: 'sec-a',
      scoreMarks: 1.5,
      maxMarks: 4,
      accuracy: 50,
    });
    expect(sections[1]).toMatchObject({
      sectionId: 'sec-b',
      scoreMarks: 0.75,
      maxMarks: 2,
      accuracy: 50,
    });
    expect(summary.scoreMarks).toBe(2.25);
    expect(summary.maxMarks).toBe(6);
    expect(summary.percentage).toBe(37.5);
  });

  it('measures accuracy over answered Questions only, excluding skips', () => {
    const { summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [makeSection('sec-a', { questionCount: 10 })],
        responses: [
          { questionId: 'sec-a-q1', selectedOptionIds: correct('sec-a-q1') },
          { questionId: 'sec-a-q2', selectedOptionIds: correct('sec-a-q2') },
          { questionId: 'sec-a-q3', selectedOptionIds: wrong('sec-a-q3') },
        ],
      }),
    );

    // 2 of 3 answered, not 2 of 10.
    expect(summary.accuracy).toBeCloseTo(66.7, 5);
  });

  it('reports null accuracy when nothing was answered', () => {
    const { summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [makeSection('sec-a', { questionCount: 4 })],
      }),
    );

    expect(summary.accuracy).toBeNull();
  });

  it('reports a negative percentage when negative marking drives the Score below zero (Req 13.3)', () => {
    const { summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [
          makeSection('sec-a', { questionCount: 2, negativeMarkCenti: 100 }),
        ],
        responses: [
          { questionId: 'sec-a-q1', selectedOptionIds: wrong('sec-a-q1') },
          { questionId: 'sec-a-q2', selectedOptionIds: wrong('sec-a-q2') },
        ],
      }),
    );

    expect(summary.scoreMarks).toBe(-2);
    expect(summary.percentage).toBe(-100);
  });

  it('reports 0% rather than NaN for a Section with no obtainable marks', () => {
    const { summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [makeSection('sec-a', { questionCount: 0 })],
      }),
    );

    expect(summary.percentage).toBe(0);
    expect(summary.maxMarks).toBe(0);
  });

  it('prefers the persisted Score as the authoritative total (Req 13.5)', () => {
    const { summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [makeSection('sec-a', { questionCount: 2 })],
        scoreCentimarks: 100,
        responses: [
          { questionId: 'sec-a-q1', selectedOptionIds: correct('sec-a-q1') },
        ],
      }),
    );

    expect(summary.scoreMarks).toBe(1);
  });
});

describe('analyzeAttempt — scope and time', () => {
  const sectionA = makeSection('sec-a', { questionCount: 2, orderIndex: 0 });
  const sectionB = makeSection('sec-b', { questionCount: 2, orderIndex: 1 });

  it('counts only the covered Section for a Section-scoped attempt (Req 8.2)', () => {
    const { sections, summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [sectionA, sectionB],
        scopedSectionId: 'sec-b',
        responses: [
          // Belongs to the Section the attempt does not cover: must not count.
          { questionId: 'sec-a-q1', selectedOptionIds: correct('sec-a-q1') },
          { questionId: 'sec-b-q1', selectedOptionIds: correct('sec-b-q1') },
        ],
      }),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].sectionId).toBe('sec-b');
    expect(summary.totalQuestions).toBe(2);
    expect(summary.correctCount).toBe(1);
  });

  it('orders Sections by the Admin-defined orderIndex regardless of input order (Req 2.6)', () => {
    const { sections } = analyzeAttempt(
      makeAttempt({ id: 'attempt-1', sections: [sectionB, sectionA] }),
    );

    expect(sections.map((s) => s.sectionId)).toEqual(['sec-a', 'sec-b']);
  });

  it('sums the Section clocks for a Sectional attempt (Req 12.1)', () => {
    const { sections, summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [sectionA, sectionB],
        accumulatedActiveSeconds: 0,
        sectionAttempts: [
          { sectionId: 'sec-a', accumulatedActiveSeconds: 120 },
          { sectionId: 'sec-b', accumulatedActiveSeconds: 45 },
        ],
      }),
    );

    expect(summary.timeSpentSeconds).toBe(165);
    expect(sections[0].timeSpentSeconds).toBe(120);
    expect(sections[1].timeSpentSeconds).toBe(45);
  });

  it('falls back to the Test Attempt clock under Overall Timing, leaving per-Section time null', () => {
    // An Overall Timing whole-Test attempt creates no Section Attempts: the
    // Test Attempt itself is the single timed scope, so no per-Section time
    // exists to report.
    const { sections, summary } = analyzeAttempt(
      makeAttempt({
        id: 'attempt-1',
        sections: [sectionA, sectionB],
        accumulatedActiveSeconds: 300,
        sectionAttempts: [],
      }),
    );

    expect(summary.timeSpentSeconds).toBe(300);
    expect(sections[0].timeSpentSeconds).toBeNull();
    expect(sections[1].timeSpentSeconds).toBeNull();
  });
});

// --- buildPerformance -----------------------------------------------------

describe('buildPerformance', () => {
  const section = makeSection('sec-a', { questionCount: 2 });

  function attemptAt(
    id: string,
    completedAt: string,
    selections: string[][],
  ): PerformanceAttemptInput {
    return makeAttempt({
      id,
      sections: [section],
      completedAt: new Date(completedAt),
      accumulatedActiveSeconds: 60,
      responses: selections.map((selectedOptionIds, i) => ({
        questionId: `sec-a-q${i + 1}`,
        selectedOptionIds,
      })),
    });
  }

  it('returns a zeroed report for a Learner with no completed attempts', () => {
    const performance = buildPerformance([]);

    expect(performance.totalAttempts).toBe(0);
    expect(performance.testsCompleted).toBe(0);
    expect(performance.averagePercentage).toBe(0);
    expect(performance.bestPercentage).toBeNull();
    expect(performance.overallAccuracy).toBeNull();
    expect(performance.tests).toEqual([]);
    expect(performance.sections).toEqual([]);
  });

  it('groups retakes of one Test into a single trend, oldest attempt first (Req 15)', () => {
    // Fed newest-first, the order the history query returns.
    const performance = buildPerformance([
      attemptAt('attempt-2', '2026-01-02T00:00:00.000Z', [
        correct('sec-a-q1'),
        correct('sec-a-q2'),
      ]),
      attemptAt('attempt-1', '2026-01-01T00:00:00.000Z', [
        correct('sec-a-q1'),
        wrong('sec-a-q2'),
      ]),
    ]);

    expect(performance.totalAttempts).toBe(2);
    expect(performance.testsCompleted).toBe(1);

    const [test] = performance.tests;
    expect(test.attemptCount).toBe(2);
    expect(test.attempts.map((a) => a.attemptId)).toEqual([
      'attempt-1',
      'attempt-2',
    ]);
    expect(test.latestPercentage).toBe(100);
    expect(test.bestPercentage).toBe(100);
  });

  it('takes the best percentage from the peak attempt, not the latest one', () => {
    const performance = buildPerformance([
      attemptAt('attempt-2', '2026-01-02T00:00:00.000Z', [
        wrong('sec-a-q1'),
        wrong('sec-a-q2'),
      ]),
      attemptAt('attempt-1', '2026-01-01T00:00:00.000Z', [
        correct('sec-a-q1'),
        correct('sec-a-q2'),
      ]),
    ]);

    const [test] = performance.tests;
    expect(test.bestPercentage).toBe(100);
    expect(test.latestPercentage).toBe(0);
  });

  it('orders Tests by most recently completed', () => {
    const older = makeAttempt({
      id: 'attempt-1',
      sections: [section],
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      test: { id: 'test-1', title: 'Older Test', sections: [section] },
    });
    const newer = makeAttempt({
      id: 'attempt-2',
      sections: [makeSection('sec-b', { questionCount: 1 })],
      completedAt: new Date('2026-02-01T00:00:00.000Z'),
      test: { id: 'test-2', title: 'Newer Test', sections: [] },
    });

    const performance = buildPerformance([older, newer]);

    expect(performance.tests.map((t) => t.testId)).toEqual([
      'test-2',
      'test-1',
    ]);
  });

  it('ranks Sections by accuracy, pushing never-answered Sections last', () => {
    const strong = makeSection('sec-strong', { questionCount: 2, orderIndex: 0 });
    const weak = makeSection('sec-weak', { questionCount: 2, orderIndex: 1 });
    const skipped = makeSection('sec-skipped', { questionCount: 2, orderIndex: 2 });

    const performance = buildPerformance([
      makeAttempt({
        id: 'attempt-1',
        sections: [strong, weak, skipped],
        responses: [
          { questionId: 'sec-strong-q1', selectedOptionIds: correct('sec-strong-q1') },
          { questionId: 'sec-strong-q2', selectedOptionIds: correct('sec-strong-q2') },
          { questionId: 'sec-weak-q1', selectedOptionIds: wrong('sec-weak-q1') },
          { questionId: 'sec-weak-q2', selectedOptionIds: wrong('sec-weak-q2') },
        ],
      }),
    ]);

    expect(performance.sections.map((s) => s.sectionId)).toEqual([
      'sec-strong',
      'sec-weak',
      'sec-skipped',
    ]);
    expect(performance.sections[0].accuracy).toBe(100);
    expect(performance.sections[1].accuracy).toBe(0);
    expect(performance.sections[2].accuracy).toBeNull();
  });

  it('accumulates a Section across every attempt that covered it', () => {
    const performance = buildPerformance([
      attemptAt('attempt-1', '2026-01-01T00:00:00.000Z', [
        correct('sec-a-q1'),
        wrong('sec-a-q2'),
      ]),
      attemptAt('attempt-2', '2026-01-02T00:00:00.000Z', [
        correct('sec-a-q1'),
        correct('sec-a-q2'),
      ]),
    ]);

    const [rolledUp] = performance.sections;
    expect(rolledUp.attemptCount).toBe(2);
    expect(rolledUp.totalQuestions).toBe(4);
    expect(rolledUp.correctCount).toBe(3);
    expect(rolledUp.accuracy).toBe(75);
  });

  it('averages the per-attempt percentages and sums the time spent', () => {
    const performance = buildPerformance([
      attemptAt('attempt-1', '2026-01-01T00:00:00.000Z', [
        correct('sec-a-q1'),
        correct('sec-a-q2'),
      ]),
      attemptAt('attempt-2', '2026-01-02T00:00:00.000Z', [
        correct('sec-a-q1'),
        wrong('sec-a-q2'),
      ]),
    ]);

    // 100% and 50%.
    expect(performance.averagePercentage).toBe(75);
    expect(performance.bestPercentage).toBe(100);
    expect(performance.totalTimeSpentSeconds).toBe(120);
    expect(performance.overallAccuracy).toBe(75);
  });
});
