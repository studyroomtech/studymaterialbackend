// Attempt lifecycle service (Req 8–15, 17).
//
// Orchestrates the learner attempt lifecycle by composing the three pure cores
// — `timing` (server-authoritative Accumulated Active Time), `scoring`
// (all-or-nothing multiple-correct with negative marking), and `access`
// (entitlement resolution with the admin short-circuit) — over the injected
// Test/Attempt/Entitlement/User repositories and the JWT token verifier. All
// timing/scoring/access decisions are server-side; the client renders the
// returned state as-is.
//
// Timing is reconciled lazily (R2): because the platform has no scheduler, every
// learner request that touches an attempt first re-derives Accumulated Active
// Time from server-recorded timestamps and, if a scope has reached its Time
// Limit, transitions it to `completed` and persists that before proceeding — so
// a deadline is observed at the next interaction (start/resume/respond/submit).
//
// Timing model (the single choke point is `reconcile`):
//   - Overall Timing whole-Test attempt (`timingMode === 'overall'`,
//     `scopedSectionId === null`): the Test Attempt itself is the one timed
//     scope, limited by the Test's overall Time Limit; no Section Attempts are
//     created and any Question in any Section may be answered while in_progress
//     (Req 11.1). This is the only "overall-scoped" shape.
//   - Every other shape — a Sectional Timing whole-Test attempt, or ANY
//     Section-scoped attempt (bought via a Section Entitlement) — is
//     "section-scoped": each covered Section has its own Section Attempt timed
//     independently by that Section's Time Limit (Req 12.1). A whole-Test
//     Sectional attempt creates one Section Attempt per Section at start (each
//     with its Start Timestamp, Req 12.2); a Section-scoped attempt creates the
//     single covered Section's Section Attempt regardless of the Test's Timing
//     Mode (you are timed by the Section you purchased). The Test Attempt's
//     status is the container status kept in sync by pause/resume and set to
//     `completed` when every Section Attempt is completed (Req 12.7).
//
// Marks are integer centi-marks internally (R3) and serialized as decimal marks
// (`centimarks / CENTIMARKS_PER_MARK`); timestamps serialize ISO 8601 UTC `Z`
// (Req 16.3). Failures surface as typed domain errors the errorHandler maps to
// the unified envelope without leaking internals.

import { CENTIMARKS_PER_MARK } from '../constants/limits.constant';
import { ROLE_ADMIN, ROLE_COMMON } from '../constants/roles.constant';
import {
  AuthRequiredError,
  NotFoundError,
  PaymentRequiredError,
  ValidationError,
} from '../utils/errors';
import * as attemptRepository from '../repositories/attempt.repository';
import * as entitlementRepository from '../repositories/entitlement.repository';
import * as testSeriesRepository from '../repositories/testSeries.repository';
import * as userRepository from '../repositories/user.repository';
import { classifyPrice } from './price.service';
import { canAccessSection, canAccessTest } from './access.service';
import { scoreAttempt } from './scoring.service';
import {
  accumulatedActiveSeconds,
  complete as completeScope,
  isExpired,
  pause as pauseScope,
  remainingSeconds,
  resume as resumeScope,
} from './timing.service';
import { verifyToken } from './token.service';
import type { TimedScopeState } from './timing.service.types';
import type { QuestionScoringInput } from './scoring.service.types';
import type {
  AttemptStateRecord,
  AttemptReviewRecord,
} from '../repositories/attempt.repository.types';
import type {
  AttemptHistoryItemDto,
  AttemptQuestionDto,
  AttemptQuestionsDto,
  AttemptReviewDto,
  AttemptStateDto,
  ReviewQuestionDto,
  SectionStateDto,
} from '../types/domain.types';
import type {
  AttemptResultDto,
  AttemptService,
  AttemptServiceDeps,
  ResolvedCaller,
  SubmitResponseInput,
} from './attempt.service.types';

// --- Pure helpers (no I/O) ------------------------------------------------

/** Serialize a Date as an ISO 8601 combined date-time in UTC with a `Z` (Req 16.3). */
function toIsoUtc(date: Date): string {
  return date.toISOString();
}

/** Convert integer centi-marks to decimal marks for serialization (R3, Req 13.5). */
function toMarks(centimarks: number): number {
  return centimarks / CENTIMARKS_PER_MARK;
}

/**
 * Project any timed record (a Test Attempt or a Section Attempt) to the minimal
 * `TimedScopeState` the pure timing core operates on.
 */
function toScope(record: {
  status: TimedScopeState['status'];
  accumulatedActiveSeconds: number;
  lastResumedAt: Date | null;
}): TimedScopeState {
  return {
    status: record.status,
    accumulatedActiveSeconds: record.accumulatedActiveSeconds,
    lastResumedAt: record.lastResumedAt,
  };
}

/**
 * Whether an attempt is "overall-scoped" — the Test Attempt itself is the single
 * timed scope. True only for an Overall Timing whole-Test attempt; every other
 * shape is timed per Section Attempt (see the module header).
 */
function isOverallScoped(state: {
  scopedSectionId: string | null;
  test: { timingMode: string };
}): boolean {
  return state.test.timingMode === 'overall' && state.scopedSectionId === null;
}

/**
 * Build the correct Option-id set for a Question from its Options' `isCorrect`
 * flags (the Correct Option Set, Req 4.2).
 */
function correctOptionIds(question: {
  options: { id: string; isCorrect: boolean }[];
}): string[] {
  return question.options.filter((o) => o.isCorrect).map((o) => o.id);
}

// --- Service factory ------------------------------------------------------

/**
 * Construct the attempt service over the injected collaborators. The controller
 * layer wires in the concrete Prisma-backed repositories, the JWT verifier, and
 * the wall clock via `createDefaultAttemptService`.
 */
export function createAttemptService(deps: AttemptServiceDeps): AttemptService {
  const { tests, attempts, entitlements, users } = deps;

  /**
   * Resolve the caller's User Record from a learner Access Token and derive the
   * admin flag (Req 8.5, 17.1). A missing/invalid/expired token, a non-learner
   * token, or an id that no longer resolves all fail closed with a 401. The
   * admin flag is `true` iff the learner token's `roles` (from `User.roles`)
   * include `role_admin`, exactly as `authMiddleware` elevates the request.
   */
  async function resolveCaller(token: string): Promise<ResolvedCaller> {
    const claims = deps.verifyToken(token);
    if (
      claims === null ||
      claims.role !== ROLE_COMMON ||
      typeof claims.sub !== 'string'
    ) {
      throw new AuthRequiredError(
        'A valid Access Token is required to attempt a Test.',
      );
    }
    const user = await users.findUserById(claims.sub);
    if (user === null) {
      throw new AuthRequiredError(
        'A valid Access Token is required to attempt a Test.',
      );
    }
    const roles = Array.isArray(claims.roles) ? claims.roles : [];
    return { userId: user.id, isAdmin: roles.includes(ROLE_ADMIN) };
  }

  /**
   * Map a loaded attempt state to its server-authoritative `AttemptStateDto`
   * (Req 9.1–9.3, 10.1, 10.3, 12.1). For an overall-scoped attempt the
   * attempt's own timing is used and `sections` is empty; otherwise each Section
   * Attempt reports its own status and remaining time, and the attempt-level
   * remaining is the greatest remaining across the Sections (the last Section to
   * close). All timing is derived at `now`.
   */
  function buildStateDto(state: AttemptStateRecord, now: Date): AttemptStateDto {
    let attemptRemaining: number;
    let sections: SectionStateDto[];

    if (isOverallScoped(state)) {
      attemptRemaining = remainingSeconds(
        toScope(state),
        state.test.timeLimitSeconds,
        now,
      );
      sections = [];
    } else {
      sections = state.sectionAttempts.map((sa) => ({
        sectionId: sa.sectionId,
        status: sa.status,
        remainingSeconds: remainingSeconds(
          toScope(sa),
          sa.section.timeLimitSeconds,
          now,
        ),
      }));
      attemptRemaining = sections.reduce(
        (max, s) => (s.remainingSeconds > max ? s.remainingSeconds : max),
        0,
      );
    }

    const dto: AttemptStateDto = {
      attemptId: state.id,
      testId: state.testId,
      status: state.status,
      timingMode: state.test.timingMode,
      startedAt: toIsoUtc(state.startedAt),
      remainingSeconds: attemptRemaining,
      sections,
    };
    if (state.status === 'completed' && state.scoreCentimarks !== null) {
      dto.scoreMarks = toMarks(state.scoreCentimarks);
    }
    return dto;
  }

  /**
   * Compute a Test Attempt's Score (centi-marks) from its review graph, scoring
   * only the Questions in scope: every Section for a whole-Test attempt, or the
   * single covered Section for a Section-scoped attempt (Req 13.1–13.5). Each
   * Question's marks come from its owning Section's Correct/Negative Mark.
   */
  function computeScoreCentimarks(review: AttemptReviewRecord): number {
    const responseByQuestion = new Map<string, string[]>(
      review.responses.map((r) => [r.questionId, r.selectedOptionIds]),
    );
    const questions: QuestionScoringInput[] = [];
    for (const section of review.test.sections) {
      if (
        review.scopedSectionId !== null &&
        section.id !== review.scopedSectionId
      ) {
        continue;
      }
      for (const question of section.questions) {
        const selected = responseByQuestion.get(question.id);
        questions.push({
          correctOptionIds: correctOptionIds(question),
          selectedOptionIds: selected ?? null,
          correctMarkCenti: section.correctMarkCenti,
          negativeMarkCenti: section.negativeMarkCenti,
        });
      }
    }
    return scoreAttempt(questions);
  }

  /**
   * Finalize an attempt (Req 11.4, 12.7, 13.5): load the review graph, compute
   * the Score, close every still-open Section Attempt (banking its Accumulated
   * Active Time at `now`), and persist status `completed` + Score + `completedAt`
   * in one transaction so no partial completion is stored (Req 16.4). Returns
   * the review record used (so callers can shape a result without re-reading).
   */
  async function finalizeAttempt(
    userId: string,
    attemptId: string,
    now: Date,
  ): Promise<AttemptReviewRecord> {
    const review = await attempts.findAttemptForReview(userId, attemptId);
    if (review === null) {
      throw new NotFoundError('The requested Test Attempt was not found.');
    }
    const scoreCentimarks = computeScoreCentimarks(review);

    // Close any Section Attempt that has not already completed, banking its
    // final active time at `now` (Req 12.3, 12.7).
    const sectionCompletions = review.sectionAttempts
      .filter((sa) => sa.status !== 'completed')
      .map((sa) => ({
        id: sa.id,
        accumulatedActiveSeconds: accumulatedActiveSeconds(toScope(sa), now),
        completedAt: now,
      }));

    // For an overall-scoped attempt, bank the attempt's own active time; for a
    // section-scoped attempt the attempt-level field is not the timing source,
    // so its stored value is preserved.
    const attemptActive = isOverallScoped(review)
      ? accumulatedActiveSeconds(toScope(review), now)
      : review.accumulatedActiveSeconds;

    await attempts.completeAttempt({
      attemptId,
      scoreCentimarks,
      completedAt: now,
      accumulatedActiveSeconds: attemptActive,
      sectionCompletions,
    });
    return review;
  }

  /**
   * Load an owner-scoped attempt and reconcile its timing before acting (R2).
   * A missing/unowned attempt is a 404 (Req 8.6). A `completed` attempt is
   * terminal and returned unchanged. For an overall-scoped attempt, an expired
   * scope is completed; for a section-scoped attempt, each expired Section
   * Attempt is closed and, once every Section Attempt is completed, the whole
   * attempt is finalized (Req 11.2, 12.3, 12.7). Returns the reconciled state.
   */
  async function reconcile(
    userId: string,
    attemptId: string,
    now: Date,
  ): Promise<AttemptStateRecord> {
    const state = await attempts.findAttemptState(userId, attemptId);
    if (state === null) {
      throw new NotFoundError('The requested Test Attempt was not found.');
    }
    if (state.status === 'completed') {
      return state;
    }

    if (isOverallScoped(state)) {
      if (
        state.status === 'in_progress' &&
        isExpired(toScope(state), state.test.timeLimitSeconds, now)
      ) {
        await finalizeAttempt(userId, attemptId, now);
        return requireState(userId, attemptId);
      }
      return state;
    }

    // Section-scoped: close each expired in_progress Section Attempt.
    let changed = false;
    for (const sa of state.sectionAttempts) {
      if (
        sa.status === 'in_progress' &&
        isExpired(toScope(sa), sa.section.timeLimitSeconds, now)
      ) {
        const closed = completeScope(toScope(sa), now);
        await attempts.updateSectionAttempt(sa.id, {
          status: 'completed',
          accumulatedActiveSeconds: closed.accumulatedActiveSeconds,
          lastResumedAt: null,
          completedAt: now,
        });
        changed = true;
      }
    }
    const current = changed ? await requireState(userId, attemptId) : state;

    // Once every Section Attempt is completed, finalize the whole attempt (Req 12.7).
    if (
      current.status !== 'completed' &&
      current.sectionAttempts.length > 0 &&
      current.sectionAttempts.every((sa) => sa.status === 'completed')
    ) {
      await finalizeAttempt(userId, attemptId, now);
      return requireState(userId, attemptId);
    }
    return current;
  }

  /** Reload an attempt's state, treating a now-missing attempt as a 404. */
  async function requireState(
    userId: string,
    attemptId: string,
  ): Promise<AttemptStateRecord> {
    const state = await attempts.findAttemptState(userId, attemptId);
    if (state === null) {
      throw new NotFoundError('The requested Test Attempt was not found.');
    }
    return state;
  }

  /**
   * Start or resume a whole-Test attempt (Req 9.1, 9.5, 8.*, 15.*, 17.*). Shared
   * by `startTest` and `retakeTest`: both resolve the caller, 404 an unknown
   * Test, return the caller's existing in_progress/paused attempt if one exists
   * (Req 9.5, 15.6), gate on access via the pure `access` core (bypassed for an
   * admin, Req 17.1), and otherwise create a fresh Test Attempt — recording the
   * Start Timestamp and, for a Sectional Timing Test, one in_progress Section
   * Attempt per Section (Req 12.2). A retake creates a new row, leaving prior
   * attempts untouched (Req 15.3).
   */
  async function startOrResumeTest(
    token: string,
    testId: string,
  ): Promise<AttemptStateDto> {
    const { userId, isAdmin } = await resolveCaller(token);
    const now = deps.now();

    const test = await tests.findTestGraphById(testId);
    if (test === null) {
      throw new NotFoundError('The requested Test was not found.');
    }

    // Return the existing in-flight attempt rather than creating another (Req 9.5, 15.6).
    const existing = await attempts.findActiveAttempt({
      userId,
      testId,
      scopedSectionId: null,
    });
    if (existing !== null) {
      return buildStateDto(await reconcile(userId, existing.id, now), now);
    }

    // Access gate (bypassed for an admin before any entitlement lookup, Req 17.1).
    const isFreeTest = classifyPrice(test.priceAmount) === 'free';
    const entitledTestIds =
      isAdmin || isFreeTest ? [] : await entitlements.listEntitledTestIds(userId);
    if (!canAccessTest({ isAdmin, isFreeTest, testId, entitledTestIds })) {
      throw new PaymentRequiredError('A Payment is required to access this Test.');
    }

    const attempt = await attempts.createAttempt({
      userId,
      testId,
      scopedSectionId: null,
      startedAt: now,
      lastResumedAt: now,
      status: 'in_progress',
    });

    // A Sectional Timing whole-Test attempt times each Section independently, so
    // create one in_progress Section Attempt per Section at start (Req 12.1, 12.2).
    if (test.timingMode === 'sectional') {
      await createSectionAttempts(attempt.id, test.sections, now);
    }

    return buildStateDto(await requireState(userId, attempt.id), now);
  }

  /**
   * Create one in_progress Section Attempt per Section, each with its Start
   * Timestamp and an open interval opened at `now` (Req 12.2).
   */
  async function createSectionAttempts(
    testAttemptId: string,
    sections: readonly { id: string }[],
    now: Date,
  ): Promise<void> {
    for (const section of sections) {
      await attempts.createSectionAttempt({
        testAttemptId,
        sectionId: section.id,
        startedAt: now,
        lastResumedAt: now,
        status: 'in_progress',
      });
    }
  }

  /** Start or resume a whole-Test attempt (Req 9.1, 9.5). */
  async function startTest(
    token: string,
    testId: string,
  ): Promise<AttemptStateDto> {
    return startOrResumeTest(token, testId);
  }

  /**
   * Create a fresh attempt for an entitled/free/admin Test, preserving history
   * (Req 15.1–15.3, 15.5, 15.6). Identical to `startTest`: it returns an
   * existing in-flight attempt (Req 15.6) and otherwise creates a new Test
   * Attempt without a new Payment, leaving every prior attempt untouched.
   */
  async function retakeTest(
    token: string,
    testId: string,
  ): Promise<AttemptStateDto> {
    return startOrResumeTest(token, testId);
  }

  /**
   * Start or resume a Section-scoped attempt for a Section Entitlement (Req 8.2,
   * 17.*). 404 an unknown Section, return an existing in-flight Section-scoped
   * attempt (Req 9.5), gate on `canAccessSection` (admin bypass, Req 17.1), and
   * otherwise create a Test Attempt scoped to the Section plus its single
   * in_progress Section Attempt timed by that Section's Time Limit.
   */
  async function startSection(
    token: string,
    sectionId: string,
  ): Promise<AttemptStateDto> {
    const { userId, isAdmin } = await resolveCaller(token);
    const now = deps.now();

    const section = await tests.findSectionGraphById(sectionId);
    if (section === null) {
      throw new NotFoundError('The requested Section was not found.');
    }
    const { testId } = section;

    const existing = await attempts.findActiveAttempt({
      userId,
      testId,
      scopedSectionId: sectionId,
    });
    if (existing !== null) {
      return buildStateDto(await reconcile(userId, existing.id, now), now);
    }

    const isFreeTest = classifyPrice(section.test.priceAmount) === 'free';
    const entitledTestIds =
      isAdmin || isFreeTest ? [] : await entitlements.listEntitledTestIds(userId);
    const entitledSectionIds =
      isAdmin || isFreeTest
        ? []
        : await entitlements.listEntitledSectionIds(userId);
    if (
      !canAccessSection({
        isAdmin,
        isFreeTest,
        testId,
        sectionId,
        entitledTestIds,
        entitledSectionIds,
      })
    ) {
      throw new PaymentRequiredError(
        'A Payment is required to access this Section.',
      );
    }

    const attempt = await attempts.createAttempt({
      userId,
      testId,
      scopedSectionId: sectionId,
      startedAt: now,
      lastResumedAt: now,
      status: 'in_progress',
    });
    await attempts.createSectionAttempt({
      testAttemptId: attempt.id,
      sectionId,
      startedAt: now,
      lastResumedAt: now,
      status: 'in_progress',
    });

    return buildStateDto(await requireState(userId, attempt.id), now);
  }

  /**
   * Pause an attempt (Req 10.1, 10.6). Reconciles timing first, then rejects
   * with a 422 when the attempt is not `in_progress` (Req 10.6). Banks the
   * current interval so no paused time is ever counted (Req 10.2): for an
   * overall-scoped attempt on the Test Attempt, otherwise on every currently
   * in_progress Section Attempt, with the container Test Attempt marked paused.
   */
  async function pause(
    token: string,
    attemptId: string,
  ): Promise<AttemptStateDto> {
    const { userId } = await resolveCaller(token);
    const now = deps.now();

    const state = await reconcile(userId, attemptId, now);
    if (state.status !== 'in_progress') {
      throw new ValidationError('Only an in-progress attempt can be paused.');
    }

    if (isOverallScoped(state)) {
      const paused = pauseScope(toScope(state), now);
      await attempts.updateAttemptTiming(attemptId, {
        status: 'paused',
        accumulatedActiveSeconds: paused.accumulatedActiveSeconds,
        lastResumedAt: null,
      });
    } else {
      for (const sa of state.sectionAttempts) {
        if (sa.status === 'in_progress') {
          const paused = pauseScope(toScope(sa), now);
          await attempts.updateSectionAttempt(sa.id, {
            status: 'paused',
            accumulatedActiveSeconds: paused.accumulatedActiveSeconds,
            lastResumedAt: null,
          });
        }
      }
      await attempts.updateAttemptTiming(attemptId, { status: 'paused' });
    }

    return buildStateDto(await requireState(userId, attemptId), now);
  }

  /**
   * Resume a paused attempt (Req 10.3, 10.5, 10.7). Rejects with a 422 when the
   * attempt is not `paused` (Req 10.7). Any scope whose banked Accumulated
   * Active Time already reached its Time Limit is closed rather than reopened
   * (Req 10.5) — a Section closed under Sectional Timing is never returned to
   * in_progress. Non-expired scopes begin a fresh active interval at `now`. When
   * resuming closes the last open Section Attempt, the whole attempt is
   * finalized (Req 12.7).
   */
  async function resume(
    token: string,
    attemptId: string,
  ): Promise<AttemptStateDto> {
    const { userId } = await resolveCaller(token);
    const now = deps.now();

    const state = await requireState(userId, attemptId);
    if (state.status !== 'paused') {
      throw new ValidationError('Only a paused attempt can be resumed.');
    }

    if (isOverallScoped(state)) {
      const scope = toScope(state);
      if (isExpired(scope, state.test.timeLimitSeconds, now)) {
        // Banked time already reached the limit → close instead of reopening (Req 10.5).
        await finalizeAttempt(userId, attemptId, now);
      } else {
        const resumed = resumeScope(scope, now);
        await attempts.updateAttemptTiming(attemptId, {
          status: 'in_progress',
          accumulatedActiveSeconds: resumed.accumulatedActiveSeconds,
          lastResumedAt: now,
        });
      }
    } else {
      for (const sa of state.sectionAttempts) {
        if (sa.status !== 'paused') {
          continue; // completed Sections stay closed; never reopened (Req 10.5).
        }
        if (isExpired(toScope(sa), sa.section.timeLimitSeconds, now)) {
          const closed = completeScope(toScope(sa), now);
          await attempts.updateSectionAttempt(sa.id, {
            status: 'completed',
            accumulatedActiveSeconds: closed.accumulatedActiveSeconds,
            lastResumedAt: null,
            completedAt: now,
          });
        } else {
          const resumed = resumeScope(toScope(sa), now);
          await attempts.updateSectionAttempt(sa.id, {
            status: 'in_progress',
            accumulatedActiveSeconds: resumed.accumulatedActiveSeconds,
            lastResumedAt: now,
          });
        }
      }
      const current = await requireState(userId, attemptId);
      if (current.sectionAttempts.every((sa) => sa.status === 'completed')) {
        await finalizeAttempt(userId, attemptId, now);
      } else {
        await attempts.updateAttemptTiming(attemptId, { status: 'in_progress' });
      }
    }

    return buildStateDto(await requireState(userId, attemptId), now);
  }

  /**
   * Locate the Section a Question belongs to within an attempt's scope, or
   * `undefined` when the Question is not in scope (Req 12.6). For a Section-scoped
   * attempt only the covered Section's Questions are in scope; for a whole-Test
   * attempt every Section is searched.
   */
  async function findQuestionSection(
    state: AttemptStateRecord,
    questionId: string,
  ): Promise<string | undefined> {
    if (state.scopedSectionId !== null) {
      const section = await tests.findSectionGraphById(state.scopedSectionId);
      if (section !== null && section.questions.some((q) => q.id === questionId)) {
        return state.scopedSectionId;
      }
      return undefined;
    }
    const test = await tests.findTestGraphById(state.testId);
    if (test === null) {
      return undefined;
    }
    for (const section of test.sections) {
      if (section.questions.some((q) => q.id === questionId)) {
        return section.id;
      }
    }
    return undefined;
  }

  /**
   * Record a Response for a Question (Req 9.4). Reconciles timing first, then
   * rejects with a 422 when the owning scope is paused/completed/expired
   * (Req 10.4, 11.3, 12.4) or, under per-Section timing, when the Question is
   * not in a currently in_progress Section (Req 12.5, 12.6). Otherwise the
   * selected Option set is upserted and the refreshed attempt state returned.
   */
  async function submitResponse(
    token: string,
    attemptId: string,
    input: SubmitResponseInput,
  ): Promise<AttemptStateDto> {
    const { userId } = await resolveCaller(token);
    const now = deps.now();

    const state = await reconcile(userId, attemptId, now);
    if (state.status === 'paused') {
      throw new ValidationError('A Response cannot be recorded while paused.');
    }
    if (state.status === 'completed') {
      throw new ValidationError(
        'A Response cannot be recorded for a completed attempt.',
      );
    }

    const sectionId = await findQuestionSection(state, input.questionId);
    if (sectionId === undefined) {
      throw new ValidationError(
        'The Question is not part of this attempt.',
        [{ field: 'questionId', reason: 'The Question is not in scope.' }],
      );
    }

    if (!isOverallScoped(state)) {
      const sectionAttempt = state.sectionAttempts.find(
        (sa) => sa.sectionId === sectionId,
      );
      if (sectionAttempt === undefined || sectionAttempt.status !== 'in_progress') {
        throw new ValidationError(
          'The Section for this Question is not currently in progress.',
          [{ field: 'questionId', reason: 'The Section is not in progress.' }],
        );
      }
    }

    await attempts.upsertResponse({
      testAttemptId: attemptId,
      questionId: input.questionId,
      selectedOptionIds: input.selectedOptionIds,
    });

    return buildStateDto(await requireState(userId, attemptId), now);
  }

  /**
   * Finalize an attempt (Req 11.4, 12.7). Reconciles first; if the attempt has
   * not already been completed by that reconciliation, it is finalized now
   * (status `completed`, Score computed and persisted in one transaction).
   * Returns the completed attempt's result.
   */
  async function submitAttempt(
    token: string,
    attemptId: string,
  ): Promise<AttemptResultDto> {
    const { userId } = await resolveCaller(token);
    const now = deps.now();

    const state = await reconcile(userId, attemptId, now);
    if (state.status !== 'completed') {
      await finalizeAttempt(userId, attemptId, now);
    }

    const final = await requireState(userId, attemptId);
    return {
      attemptId: final.id,
      testId: final.testId,
      status: 'completed',
      scoreMarks: toMarks(final.scoreCentimarks ?? 0),
      completedAt: toIsoUtc(final.completedAt ?? now),
    };
  }

  /**
   * Every completed attempt for the caller, most recently completed first
   * (Req 14.1, 14.3). Score is serialized as decimal marks and completion time
   * as ISO 8601 UTC `Z`.
   */
  async function listHistory(token: string): Promise<AttemptHistoryItemDto[]> {
    const { userId } = await resolveCaller(token);
    const rows = await attempts.listCompletedAttempts(userId);
    return rows.map((row) => ({
      attemptId: row.id,
      testId: row.testId,
      testTitle: row.test.title,
      scoreMarks: toMarks(row.scoreCentimarks ?? 0),
      completedAt: toIsoUtc(row.completedAt ?? row.createdAt),
    }));
  }

  /**
   * One owner-scoped attempt's review (Req 14.2, 14.4): for each in-scope
   * Question, its text, Options, Correct Option Set, and the Learner's recorded
   * Response. A missing or unowned attempt surfaces uniformly as a 404
   * (Req 14.4).
   */
  async function getAttemptReview(
    token: string,
    attemptId: string,
  ): Promise<AttemptReviewDto> {
    const { userId } = await resolveCaller(token);
    const review = await attempts.findAttemptForReview(userId, attemptId);
    if (review === null) {
      throw new NotFoundError('The requested Test Attempt was not found.');
    }

    const responseByQuestion = new Map<string, string[]>(
      review.responses.map((r) => [r.questionId, r.selectedOptionIds]),
    );
    const questions: ReviewQuestionDto[] = [];
    for (const section of review.test.sections) {
      if (
        review.scopedSectionId !== null &&
        section.id !== review.scopedSectionId
      ) {
        continue;
      }
      for (const question of section.questions) {
        questions.push({
          questionId: question.id,
          text: question.text,
          options: question.options.map((o) => ({ id: o.id, text: o.text })),
          correctOptionIds: correctOptionIds(question),
          selectedOptionIds: responseByQuestion.get(question.id) ?? [],
        });
      }
    }

    return {
      attemptId: review.id,
      testTitle: review.test.title,
      scoreMarks: toMarks(review.scoreCentimarks ?? 0),
      completedAt: toIsoUtc(review.completedAt ?? review.createdAt),
      questions,
    };
  }

  /**
   * The in-scope Questions for the caller's attempt, for rendering the Test
   * Player while the attempt is open (Req 9.4). Owner-scoped — a missing or
   * unowned attempt is a 404 (Req 8.6). For a Section-scoped attempt only the
   * covered Section's Questions are returned; for a whole-Test attempt every
   * Section's Questions are returned, all in Admin-defined order. The Options'
   * correct/incorrect flags are deliberately NOT included — correctness is never
   * revealed while the attempt is open (D4, Req 13); each Question carries the
   * Learner's currently recorded selection so a resumed attempt can seed prior
   * answers.
   */
  async function getAttemptQuestions(
    token: string,
    attemptId: string,
  ): Promise<AttemptQuestionsDto> {
    const { userId } = await resolveCaller(token);
    const review = await attempts.findAttemptForReview(userId, attemptId);
    if (review === null) {
      throw new NotFoundError('The requested Test Attempt was not found.');
    }

    const responseByQuestion = new Map<string, string[]>(
      review.responses.map((r) => [r.questionId, r.selectedOptionIds]),
    );
    const questions: AttemptQuestionDto[] = [];
    for (const section of review.test.sections) {
      if (
        review.scopedSectionId !== null &&
        section.id !== review.scopedSectionId
      ) {
        continue;
      }
      for (const question of section.questions) {
        questions.push({
          questionId: question.id,
          sectionId: section.id,
          text: question.text,
          // Option text only — never the `isCorrect` flag (D4, Req 13).
          options: question.options.map((o) => ({ id: o.id, text: o.text })),
          selectedOptionIds: responseByQuestion.get(question.id) ?? [],
        });
      }
    }

    return { attemptId: review.id, questions };
  }

  return {
    startTest,
    startSection,
    pause,
    resume,
    submitResponse,
    submitAttempt,
    retakeTest,
    listHistory,
    getAttemptReview,
    getAttemptQuestions,
  };
}

// --- Default wiring -------------------------------------------------------

/**
 * Construct the attempt service wired to the real Prisma-backed repositories,
 * the JWT token verifier, and the system clock. Used by the attempt controller
 * in production (mirrors `createDefaultPaymentService`). The repository function
 * exports satisfy the injected contracts directly.
 */
export function createDefaultAttemptService(): AttemptService {
  return createAttemptService({
    tests: {
      findTestGraphById: testSeriesRepository.findTestGraphById,
      findSectionGraphById: testSeriesRepository.findSectionGraphById,
    },
    attempts: {
      findActiveAttempt: attemptRepository.findActiveAttempt,
      createAttempt: attemptRepository.createAttempt,
      findAttemptState: attemptRepository.findAttemptState,
      findSectionAttempt: attemptRepository.findSectionAttempt,
      createSectionAttempt: attemptRepository.createSectionAttempt,
      updateSectionAttempt: attemptRepository.updateSectionAttempt,
      updateAttemptTiming: attemptRepository.updateAttemptTiming,
      upsertResponse: attemptRepository.upsertResponse,
      completeAttempt: attemptRepository.completeAttempt,
      listCompletedAttempts: attemptRepository.listCompletedAttempts,
      findAttemptForReview: attemptRepository.findAttemptForReview,
    },
    entitlements: {
      listEntitledTestIds: entitlementRepository.listEntitledTestIds,
      listEntitledSectionIds: entitlementRepository.listEntitledSectionIds,
    },
    users: {
      async findUserById(id) {
        const user = await userRepository.findUserById(id);
        return user === null ? null : { id: user.id };
      },
    },
    verifyToken,
    now: () => new Date(),
  });
}
