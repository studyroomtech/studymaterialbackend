// Pure attempt analytics — the result summary, the per-Section breakdown, and
// the cross-attempt performance roll-up (Req 14.1, 14.2).
//
// This module contains only pure, side-effect-free functions. Every figure it
// reports is derived from data the platform already stores: the recorded
// Responses, each Option's `isCorrect` flag, each Section's own Correct/Negative
// Mark (Req 3.1), and the banked Accumulated Active Time on each timed scope
// (R1). Nothing here is persisted and no new query shape is required — the
// attempt review graph already carries all of it.
//
// Question classification follows the scoring rules exactly (Req 13.1–13.4), so
// the counts can never disagree with the Score:
//   - No recorded Response            -> Unanswered (scores zero).
//   - Selected set exactly equal      -> Correct    (+correctMarkCenti).
//   - Any other recorded Response     -> Incorrect  (-negativeMarkCenti).
// A recorded but empty selection is therefore Incorrect, not Unanswered, which
// is what `scoreQuestion` already charges the Negative Mark for.
//
// Marks are integer centi-marks internally (R3) and serialized as decimal marks;
// percentages are rounded to one decimal for display and may be negative,
// because negative marking can drive a Score below zero.

import { CENTIMARKS_PER_MARK } from '../constants/limits.constant';
import { isExactlyCorrect } from './scoring.service';
import type {
  AnswerBreakdown,
  AttemptAnalysis,
  PerformanceAttemptInput,
  PerformanceQuestionInput,
  PerformanceSectionInput,
  SectionAccumulator,
  TestAccumulator,
} from './performance.service.types';
import type {
  PerformanceDto,
  SectionPerformanceDto,
  SectionResultDto,
  TestPerformanceDto,
} from '../types/domain.types';

/** Convert integer centi-marks to decimal marks for serialization (R3, Req 13.5). */
function toMarks(centimarks: number): number {
  return centimarks / CENTIMARKS_PER_MARK;
}

/** Round to one decimal place, the precision every reported percentage uses. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * `scored / obtainable` as a percentage. Zero when nothing is obtainable, so an
 * empty Section reads as 0% rather than NaN.
 */
function percentageOf(scoredCenti: number, maxCenti: number): number {
  if (maxCenti <= 0) {
    return 0;
  }
  return round1((scoredCenti / maxCenti) * 100);
}

/**
 * Accuracy over answered Questions only — skipped Questions are excluded rather
 * than counted against the Learner. `null` when nothing was answered, which is
 * the one case where accuracy carries no meaning.
 */
function accuracyOf(breakdown: AnswerBreakdown): number | null {
  const answered = breakdown.correctCount + breakdown.incorrectCount;
  if (answered === 0) {
    return null;
  }
  return round1((breakdown.correctCount / answered) * 100);
}

/** The ids of a Question's Options flagged correct (the Correct Option Set, Req 4.2). */
function correctOptionIds(question: PerformanceQuestionInput): string[] {
  return question.options.filter((o) => o.isCorrect).map((o) => o.id);
}

/** An empty breakdown, the identity for accumulation. */
function emptyBreakdown(): AnswerBreakdown {
  return {
    totalQuestions: 0,
    correctCount: 0,
    incorrectCount: 0,
    unansweredCount: 0,
  };
}

/** Add `addend` into `target` in place. */
function addBreakdown(target: AnswerBreakdown, addend: AnswerBreakdown): void {
  target.totalQuestions += addend.totalQuestions;
  target.correctCount += addend.correctCount;
  target.incorrectCount += addend.incorrectCount;
  target.unansweredCount += addend.unansweredCount;
}

/**
 * The Sections an attempt covers, in Admin-defined order: every Section for a
 * whole-Test attempt, or only the purchased one for a Section-scoped attempt
 * (Req 8.2). Sorting here keeps the ordering guarantee local rather than
 * relying on the caller's query.
 */
function inScopeSections(
  attempt: PerformanceAttemptInput,
): PerformanceSectionInput[] {
  const sections =
    attempt.scopedSectionId === null
      ? attempt.test.sections
      : attempt.test.sections.filter((s) => s.id === attempt.scopedSectionId);
  return [...sections].sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Total Accumulated Active Time for an attempt (R1). Under Sectional Timing the
 * attempt's time is the sum of its Section clocks; under Overall Timing the Test
 * Attempt itself is the single timed scope. A completed attempt has
 * `lastResumedAt` cleared, so the banked seconds are already final and no
 * reconciliation is needed.
 */
function totalTimeSpentSeconds(
  attempt: PerformanceAttemptInput,
  sectionIds: ReadonlySet<string>,
): number {
  const covered = attempt.sectionAttempts.filter((sa) =>
    sectionIds.has(sa.sectionId),
  );
  if (covered.length === 0) {
    return attempt.accumulatedActiveSeconds;
  }
  return covered.reduce((sum, sa) => sum + sa.accumulatedActiveSeconds, 0);
}

/**
 * Analyze one completed attempt: score and classify every in-scope Question
 * under its own Section's marking scheme, then roll the Sections up into the
 * headline summary.
 *
 * The headline `scoreMarks` prefers the persisted `scoreCentimarks` — the
 * authoritative Score written when the attempt was finalized (Req 13.5) —
 * falling back to the recomputed sum only when it is absent. Both apply the same
 * rules to the same data, so they agree.
 */
export function analyzeAttempt(attempt: PerformanceAttemptInput): AttemptAnalysis {
  const selectionByQuestion = new Map<string, string[]>(
    attempt.responses.map((r) => [r.questionId, r.selectedOptionIds]),
  );
  const timeBySection = new Map<string, number>(
    attempt.sectionAttempts.map((sa) => [
      sa.sectionId,
      sa.accumulatedActiveSeconds,
    ]),
  );

  const sections: SectionResultDto[] = [];
  const totals = emptyBreakdown();
  let totalScoreCenti = 0;
  let totalMaxCenti = 0;

  for (const section of inScopeSections(attempt)) {
    const breakdown = emptyBreakdown();
    let scoreCenti = 0;

    for (const question of section.questions) {
      breakdown.totalQuestions += 1;
      const selected = selectionByQuestion.get(question.id);

      if (selected === undefined) {
        breakdown.unansweredCount += 1;
        continue;
      }
      if (isExactlyCorrect(selected, correctOptionIds(question))) {
        breakdown.correctCount += 1;
        scoreCenti += section.correctMarkCenti;
        continue;
      }
      breakdown.incorrectCount += 1;
      scoreCenti -= section.negativeMarkCenti;
    }

    const maxCenti = breakdown.totalQuestions * section.correctMarkCenti;
    // Absent under Overall Timing, where no Section Attempt exists because the
    // whole Test shares one clock.
    const spent = timeBySection.get(section.id);

    sections.push({
      ...breakdown,
      sectionId: section.id,
      title: section.title,
      orderIndex: section.orderIndex,
      scoreMarks: toMarks(scoreCenti),
      maxMarks: toMarks(maxCenti),
      percentage: percentageOf(scoreCenti, maxCenti),
      accuracy: accuracyOf(breakdown),
      timeSpentSeconds: spent ?? null,
      timeLimitSeconds: section.timeLimitSeconds,
    });

    addBreakdown(totals, breakdown);
    totalScoreCenti += scoreCenti;
    totalMaxCenti += maxCenti;
  }

  const scoreCenti = attempt.scoreCentimarks ?? totalScoreCenti;
  const sectionIds = new Set(sections.map((s) => s.sectionId));

  return {
    sections,
    summary: {
      ...totals,
      scoreMarks: toMarks(scoreCenti),
      maxMarks: toMarks(totalMaxCenti),
      percentage: percentageOf(scoreCenti, totalMaxCenti),
      accuracy: accuracyOf(totals),
      timeSpentSeconds: totalTimeSpentSeconds(attempt, sectionIds),
    },
  };
}

/**
 * Rank Sections by accuracy, weakest signal last: a Section the Learner only
 * ever skipped has `accuracy === null` and is pushed to the end, since it says
 * nothing about strength either way. Ties break on title for a stable order.
 */
function compareSectionPerformance(
  a: SectionPerformanceDto,
  b: SectionPerformanceDto,
): number {
  if (a.accuracy === null && b.accuracy === null) {
    return a.title.localeCompare(b.title);
  }
  if (a.accuracy === null) {
    return 1;
  }
  if (b.accuracy === null) {
    return -1;
  }
  if (a.accuracy !== b.accuracy) {
    return b.accuracy - a.accuracy;
  }
  return a.title.localeCompare(b.title);
}

/**
 * Roll every completed attempt up into the Learner's performance view: overall
 * totals, a per-Test trend across retakes (Req 15), and a per-Section ranking
 * that surfaces strong and weak areas.
 *
 * Input order is irrelevant — Tests come back most recently completed first and
 * each Test's attempts oldest first, so the trend reads left to right.
 */
export function buildPerformance(
  attempts: readonly PerformanceAttemptInput[],
): PerformanceDto {
  const totals = emptyBreakdown();
  const byTest = new Map<string, TestAccumulator>();
  const bySection = new Map<string, SectionAccumulator>();
  const percentages: number[] = [];
  let totalTime = 0;

  for (const attempt of attempts) {
    const { summary, sections } = analyzeAttempt(attempt);
    const completedAt = attempt.completedAt ?? attempt.createdAt;

    addBreakdown(totals, summary);
    percentages.push(summary.percentage);
    totalTime += summary.timeSpentSeconds;

    const test = byTest.get(attempt.test.id) ?? {
      testId: attempt.test.id,
      testTitle: attempt.test.title,
      points: [],
      lastCompletedAt: 0,
    };
    test.points.push({
      attemptId: attempt.id,
      completedAt: completedAt.toISOString(),
      scoreMarks: summary.scoreMarks,
      maxMarks: summary.maxMarks,
      percentage: summary.percentage,
      accuracy: summary.accuracy,
      timeSpentSeconds: summary.timeSpentSeconds,
    });
    test.lastCompletedAt = Math.max(test.lastCompletedAt, completedAt.getTime());
    byTest.set(attempt.test.id, test);

    for (const section of sections) {
      const entry = bySection.get(section.sectionId) ?? {
        sectionId: section.sectionId,
        title: section.title,
        testTitle: attempt.test.title,
        attemptCount: 0,
        breakdown: emptyBreakdown(),
        scoreCenti: 0,
        maxCenti: 0,
      };
      entry.attemptCount += 1;
      addBreakdown(entry.breakdown, section);
      // Back to integer centi-marks so repeated accumulation stays exact (R3).
      entry.scoreCenti += Math.round(section.scoreMarks * CENTIMARKS_PER_MARK);
      entry.maxCenti += Math.round(section.maxMarks * CENTIMARKS_PER_MARK);
      bySection.set(section.sectionId, entry);
    }
  }

  const tests: TestPerformanceDto[] = [...byTest.values()]
    .sort((a, b) => b.lastCompletedAt - a.lastCompletedAt)
    .map((test) => {
      const points = [...test.points].sort(
        (a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt),
      );
      return {
        testId: test.testId,
        testTitle: test.testTitle,
        attemptCount: points.length,
        bestPercentage: Math.max(...points.map((p) => p.percentage)),
        latestPercentage: points[points.length - 1].percentage,
        attempts: points,
      };
    });

  const sections: SectionPerformanceDto[] = [...bySection.values()]
    .map((entry) => ({
      ...entry.breakdown,
      sectionId: entry.sectionId,
      title: entry.title,
      testTitle: entry.testTitle,
      attemptCount: entry.attemptCount,
      accuracy: accuracyOf(entry.breakdown),
      percentage: percentageOf(entry.scoreCenti, entry.maxCenti),
    }))
    .sort(compareSectionPerformance);

  const averagePercentage =
    percentages.length === 0
      ? 0
      : round1(
          percentages.reduce((sum, p) => sum + p, 0) / percentages.length,
        );

  return {
    ...totals,
    totalAttempts: attempts.length,
    testsCompleted: byTest.size,
    averagePercentage,
    bestPercentage:
      percentages.length === 0 ? null : Math.max(...percentages),
    overallAccuracy: accuracyOf(totals),
    totalTimeSpentSeconds: totalTime,
    tests,
    sections,
  };
}
