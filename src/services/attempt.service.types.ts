// Types for the Attempt lifecycle service (Req 1.15: type/interface
// declarations live only in `*.types.ts`).
//
// The Attempt service orchestrates the learner attempt lifecycle (Req 8–15,
// 17): start/resume a whole-Test or Section-scoped attempt, pause/resume,
// record Responses, submit + score, retake, and the history/review reads. It
// composes the pure `timing`, `scoring`, and `access` cores over the injected
// Test/Attempt/Entitlement/User repositories and the token verifier, matching
// the `createXxxService(deps)` + `createDefaultXxxService()` split used by the
// payment/material/download services.
//
// This module describes the injected dependency contract, the service inputs,
// and the small service-local result DTO (`AttemptResultDto`) returned on
// submit. The attempt/state/review DTOs the service returns
// (`AttemptStateDto`, `AttemptReviewDto`, `AttemptHistoryItemDto`) live in
// `../types/domain.types`.

import type { AccessTokenClaims } from '../types/auth.types';
import type {
  AttemptHistoryItemDto,
  AttemptQuestionsDto,
  AttemptReviewDto,
  AttemptStateDto,
} from '../types/domain.types';
import type { AttemptRepository } from '../repositories/attempt.repository.types';
import type { TestRepository } from '../repositories/testSeries.repository.types';

/**
 * The repository slice the attempt service reads for the Test/Section authoring
 * graph: the ordered Test graph for a whole-Test attempt and the Section graph
 * (with its parent Test) for a Section-scoped attempt. Both back the access
 * gate, the question→section scope check, and score computation. Narrowed from
 * `TestRepository` so the service is injected with exactly what it needs.
 */
export type AttemptTestRepository = Pick<
  TestRepository,
  'findTestGraphById' | 'findSectionGraphById'
>;

/**
 * The Payment Entitlement lookups the access gate depends on: the Test and
 * Section ids the Learner's User Record holds an Entitlement for (Req 8.1, 8.2).
 * Fed into the pure `access` core alongside the caller's admin flag.
 */
export interface AttemptEntitlementRepository {
  listEntitledTestIds(userId: string): Promise<string[]>;
  listEntitledSectionIds(userId: string): Promise<string[]>;
}

/**
 * The minimal User Record the attempt service resolves from a learner Access
 * Token before any lifecycle action (Req 8.5). Returns `null` (never throws)
 * when the id does not resolve so the service maps absence to a 401.
 */
export interface AttemptUserRecord {
  id: string;
}

/**
 * User Record lookup contract consumed by the attempt service. Mirrors the
 * payment service's `PaymentUserRepository`.
 */
export interface AttemptUserRepository {
  findUserById(id: string): Promise<AttemptUserRecord | null>;
}

/**
 * The dependency bundle the attempt service is constructed with. The concrete
 * Prisma-backed repositories, the JWT token verifier, and the clock are injected
 * by `createDefaultAttemptService`, keeping the service logic independent of
 * Prisma, JWT, and the wall clock (so timing is deterministic under `now`).
 */
export interface AttemptServiceDeps {
  tests: AttemptTestRepository;
  attempts: AttemptRepository;
  entitlements: AttemptEntitlementRepository;
  users: AttemptUserRepository;
  /** Verify a learner Access Token, returning its claims or `null` (Req 8.5). */
  verifyToken(token: string): AccessTokenClaims | null;
  /** The current instant, injected so the timing core stays deterministic (R1). */
  now(): Date;
}

/**
 * The resolved caller of a lifecycle action: the User Record id and the admin
 * flag derived from the learner Access Token's roles (Req 8.5, 17.1). Produced
 * by the service's internal `resolveCaller` and threaded into the access core.
 */
export interface ResolvedCaller {
  userId: string;
  isAdmin: boolean;
}

/**
 * The Learner's selected Option set for one Question, submitted during an
 * in_progress attempt scope (Req 9.4). `selectedOptionIds` is the exact set the
 * Learner selected; it is recorded as-is (scoring uses set equality, R3/D4).
 */
export interface SubmitResponseInput {
  questionId: string;
  selectedOptionIds: string[];
}

/**
 * The result returned when an attempt is finalized (Req 11.4, 12.7). The
 * attempt is `completed` with its computed Score serialized as decimal marks
 * (`centimarks / 100`, R3) and its completion instant as an ISO 8601 UTC `Z`
 * string (Req 16.3).
 */
export interface AttemptResultDto {
  attemptId: string;
  testId: string;
  status: 'completed';
  /** Total Score as decimal marks (R3, Req 13.5). */
  scoreMarks: number;
  /** Completion time, ISO 8601 UTC `Z` (Req 16.3). */
  completedAt: string;
}

/**
 * The public surface of the attempt service (Req 8–15, 17). Every method
 * resolves the Learner from the token (else `AuthRequiredError` 401) and throws
 * a typed domain error the errorHandler maps to the unified envelope:
 *   - AuthRequiredError → 401 (no learner resolved, Req 8.5)
 *   - PaymentRequiredError → 403 (no access and not free/admin, Req 8.4, 15.5)
 *   - NotFoundError → 404 (unknown Test/Section/attempt, Req 8.6, 14.4, 17.6)
 *   - ValidationError → 422 (illegal transition / out-of-scope Response, Req 10, 11, 12)
 */
export interface AttemptService {
  /** Start or resume a whole-Test attempt (Req 9.1, 9.5, 8.*, 17.*). */
  startTest(token: string, testId: string): Promise<AttemptStateDto>;
  /** Start or resume a Section-scoped attempt (Req 8.2, 17.*). */
  startSection(token: string, sectionId: string): Promise<AttemptStateDto>;
  /** Pause an in_progress attempt (else 422) (Req 10.1, 10.6). */
  pause(token: string, attemptId: string): Promise<AttemptStateDto>;
  /** Resume a paused attempt, auto-closing expired scopes (else 422) (Req 10.3, 10.5, 10.7). */
  resume(token: string, attemptId: string): Promise<AttemptStateDto>;
  /** Record a Response, reconciling timing first (Req 9.4, 10.4, 11.3, 12.4–12.6). */
  submitResponse(
    token: string,
    attemptId: string,
    input: SubmitResponseInput,
  ): Promise<AttemptStateDto>;
  /** Finalize an attempt: mark completed, compute + persist Score (Req 11.4, 12.7). */
  submitAttempt(token: string, attemptId: string): Promise<AttemptResultDto>;
  /** Create a fresh attempt for an entitled/free/admin Test, preserving history (Req 15). */
  retakeTest(token: string, testId: string): Promise<AttemptStateDto>;
  /** Every completed attempt for the caller (Req 14.1, 14.3). */
  listHistory(token: string): Promise<AttemptHistoryItemDto[]>;
  /** One owner-scoped completed attempt with its full review graph (Req 14.2, 14.4). */
  getAttemptReview(token: string, attemptId: string): Promise<AttemptReviewDto>;
  /**
   * The in-scope Questions for the caller's attempt, with Option text but never
   * correctness, so the Test Player can render them while the attempt is open
   * (Req 9.4). Owner-scoped: a missing or unowned attempt is a 404 (Req 8.6).
   */
  getAttemptQuestions(
    token: string,
    attemptId: string,
  ): Promise<AttemptQuestionsDto>;
}
