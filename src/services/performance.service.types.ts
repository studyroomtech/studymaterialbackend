// Types for the pure performance core (Req 1.15: type declarations live only in
// `*.types.ts`).
//
// The input interfaces describe the minimal shape the analytics need, not the
// Prisma payload: `AttemptReviewRecord` satisfies them structurally, so the
// attempt service can hand its existing review graph straight to this core
// without a mapping layer, while tests can build small literals.

import type {
  AttemptSummaryDto,
  PerformanceAttemptPointDto,
  SectionResultDto,
} from '../types/domain.types';

/** An Option as the analytics see it: identity plus its correct/incorrect flag. */
export interface PerformanceOptionInput {
  id: string;
  isCorrect: boolean;
}

/** A Question with the Options its Correct Option Set is derived from. */
export interface PerformanceQuestionInput {
  id: string;
  options: PerformanceOptionInput[];
}

/**
 * A Section with the marking scheme its Questions are scored under (R3) and the
 * Time Limit its spent time is measured against.
 */
export interface PerformanceSectionInput {
  id: string;
  title: string;
  orderIndex: number;
  timeLimitSeconds: number;
  correctMarkCenti: number;
  negativeMarkCenti: number;
  questions: PerformanceQuestionInput[];
}

/**
 * A Section Attempt reduced to its banked active time. A completed attempt has
 * `lastResumedAt` cleared, so `accumulatedActiveSeconds` is already final and
 * no timing reconciliation is needed here.
 */
export interface PerformanceSectionAttemptInput {
  sectionId: string;
  accumulatedActiveSeconds: number;
}

/** The Learner's recorded selection for one Question. */
export interface PerformanceResponseInput {
  questionId: string;
  selectedOptionIds: string[];
}

/**
 * One completed Test Attempt with everything the analytics derive from. Every
 * figure this core reports is computed from these fields — no new columns and
 * no extra queries.
 */
export interface PerformanceAttemptInput {
  id: string;
  /** The single covered Section for a Section-scoped attempt; null for a whole-Test attempt. */
  scopedSectionId: string | null;
  /** Banked active time on the Test Attempt itself (the Overall Timing scope). */
  accumulatedActiveSeconds: number;
  scoreCentimarks: number | null;
  completedAt: Date | null;
  createdAt: Date;
  test: {
    id: string;
    title: string;
    sections: PerformanceSectionInput[];
  };
  sectionAttempts: PerformanceSectionAttemptInput[];
  responses: PerformanceResponseInput[];
}

/**
 * How the in-scope Questions of an attempt (or one Section of it) were
 * answered. `correctCount + incorrectCount + unansweredCount === totalQuestions`
 * always holds: a Question is Correct only on exact Correct-Option-Set equality
 * (Req 13.1), any other recorded Response is Incorrect (Req 13.3), and a
 * Question with no Response is Unanswered (Req 13.4).
 */
export interface AnswerBreakdown {
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
}

/** One completed attempt's headline result plus its per-Section breakdown. */
export interface AttemptAnalysis {
  summary: AttemptSummaryDto;
  sections: SectionResultDto[];
}

/**
 * Mutable accumulator for one Test's attempts while rolling up.
 * `lastCompletedAt` is an epoch-millisecond instant, used only to order Tests
 * by recency.
 */
export interface TestAccumulator {
  testId: string;
  testTitle: string;
  points: PerformanceAttemptPointDto[];
  lastCompletedAt: number;
}

/**
 * Mutable accumulator for one Section across every attempt that covered it.
 * Marks are held as integer centi-marks (R3) so repeated accumulation stays
 * exact, and converted to decimal marks only on serialization.
 */
export interface SectionAccumulator {
  sectionId: string;
  title: string;
  testTitle: string;
  attemptCount: number;
  breakdown: AnswerBreakdown;
  scoreCenti: number;
  maxCenti: number;
}
