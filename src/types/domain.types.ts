// Shared domain DTO types for the Study Materials Platform backend.
//
// These describe the shapes exchanged between the service/controller layers and
// the Frontend Project (Req 1.15: all type/interface declarations live in
// `*.types.ts`). They mirror the Material Catalog and material metadata
// responses defined in the design (Req 2.5, 3.1, 5.1).
//
// Payment-specific DTO types (PaymentStatus, PaymentOrderDto,
// PaymentVerifyResultDto) are introduced in Phase 2 (task 16.1) below.

/**
 * The two Role values supported by the Backend API (Req 10.1).
 * `role_common` is the unauthenticated default; `role_admin` is the elevated,
 * authenticated Role permitted to perform Content Management Actions.
 */
export type Role = 'role_common' | 'role_admin';

/**
 * A Category within a Category Type — a named classification value such as
 * "Mathematics" under Subject (Req 2.1).
 */
export interface CategoryDto {
  id: string;
  name: string;
  categoryTypeId: string;
}

/**
 * A Category Type — a classification dimension (for example, Subject or Job)
 * together with the Categories defined within it (Req 2.1, 3.2).
 */
export interface CategoryTypeDto {
  id: string;
  name: string;
  categories: CategoryDto[];
}

/**
 * A Tag as surfaced under a Category Type in a material's
 * `tagsByCategoryType` map: the assignment of a Category to a Study Material
 * (Req 2.3, 2.5).
 */
export interface TagDto {
  categoryId: string;
  name: string;
}

/**
 * The Tags assigned to a Study Material, grouped by Category Type id. Every
 * supported Category Type key is present; a Category Type with no assigned
 * Tags maps to an empty array (Req 2.5).
 */
export type TagsByCategoryType = Record<string, TagDto[]>;

/**
 * A Study Material's metadata as returned by the catalog and material
 * endpoints. File bytes live in Object Storage; the Object Storage Key is
 * never included in responses (Req 1.13, 3.1, 5.1).
 *
 * The optional file-metadata fields are populated by the single-material
 * endpoint (Req 5.1); the catalog listing may omit them. The optional
 * price fields describe a Paid Material's Price; in Phase 1 all materials are
 * served as Free Materials and these remain unset (price handling and the
 * entitlement gate are added in Phase 2, Req 11.13–11.15, 12).
 */
export interface MaterialDto {
  id: string;
  title: string;
  description: string;
  tagsByCategoryType: TagsByCategoryType;
  fileName?: string;
  contentType?: string;
  fileSizeBytes?: number;
  priceAmount?: number | null;
  currency?: string;
  isPaid?: boolean;
}

/**
 * The state of a Payment (Req 12 glossary: Payment Status). The string values
 * mirror `constants/payment.constant.ts` and form part of the persisted
 * Payment Record and API contract.
 */
export type PaymentStatus =
  | 'created'
  | 'successful'
  | 'failed'
  | 'system_cancelled_due_to_old_age';

/**
 * The Razorpay order details returned to the Frontend Project after the
 * Backend API initiates a Payment (Req 12.4, 12.5). Only the non-secret
 * Razorpay Public Key Identifier is included; the Razorpay Key Secret is never
 * exposed to the client (Req 12.17).
 */
export interface PaymentOrderDto {
  /** The Backend API's Payment Record identifier. */
  paymentId: string;
  /** The Razorpay Order Identifier assigned to the created order. */
  razorpayOrderId: string;
  /** The Paid Material this order is for. */
  studyMaterialId: string;
  /** The charge amount, matching the Paid Material's Price amount. */
  amount: number;
  /** The Currency of the charge (defaults to INR). */
  currency: string;
  /** The non-secret Razorpay Public Key Identifier for presenting checkout. */
  razorpayKeyId: string;
}

/**
 * The outcome of server-side Payment Signature Verification (Req 12.6, 12.15,
 * 12.18). A Payment Entitlement is granted only when `verified` is `true`.
 */
export interface PaymentVerifyResultDto {
  /** Whether Payment Signature Verification succeeded. */
  verified: boolean;
  /** The resulting Payment Status after verification. */
  status: PaymentStatus;
  /** The Paid Material the Payment applies to. */
  studyMaterialId: string;
  /** Whether the Learner now holds a Payment Entitlement for the material. */
  entitled: boolean;
}

// ---------------------------------------------------------------------------
// Test Series domain DTO types
//
// These describe the shapes exchanged between the Test Series service/controller
// layers and the Frontend Project. Following the platform's serialization
// contract (Req 16.3, 16.5, and R3 of the design):
//   - timestamps are serialized as ISO 8601 UTC strings ending in `Z`;
//   - monetary amounts are non-negative integers in the smallest currency unit
//     (paise) accompanied by a Currency;
//   - marks are surfaced as decimal marks (stored `centimarks / 100`, R3).
// Type declarations only — no logic (Req 1.15 `*.types.ts` convention).
// ---------------------------------------------------------------------------

/**
 * The lifecycle state of a Test Attempt or Section Attempt (Attempt Status,
 * Req 9 glossary). The string values mirror the Prisma `AttemptStatus` enum and
 * form part of the persisted attempt record and the API contract. Declared as a
 * string-union to mirror `PaymentStatus`.
 */
export type AttemptStatus = 'in_progress' | 'paused' | 'completed';

/**
 * The Timing Mode of a Test (Req 2.2). Exactly one of Overall Timing or
 * Sectional Timing. The string values mirror the Prisma `TestTimingMode` enum.
 * Declared as a string-union to mirror `PaymentStatus`.
 */
export type TestTimingMode = 'overall' | 'sectional';

/**
 * A Test offered on the Home Page as a Test Series product (Req 6.1–6.3). Free
 * Tests are included with `priceAmount` null and `isFree` true; priced Tests
 * carry a positive paise `priceAmount` and Currency.
 */
export interface TestSeriesListingDto {
  id: string;
  title: string;
  timingMode: TestTimingMode;
  timeLimitSeconds: number;
  /** Paise; null => free Test (Req 6.2, 6.3). */
  priceAmount: number | null;
  currency: string;
  isFree: boolean;
  /**
   * Whether the requesting Learner already holds a Payment Entitlement for this
   * Test — `true` shows "Start test" instead of "Buy" (Req 2.3). Resolved from
   * the caller's Access Token; `false` for an unauthenticated caller.
   */
  isEntitled: boolean;
}

/**
 * A Section offered on the Home Page as a Sectional Test product (Req 6.1, 6.2).
 * Only Sections with a positive Price are listed, so `priceAmount` is always
 * present and positive.
 */
export interface SectionalTestListingDto {
  sectionId: string;
  testId: string;
  title: string;
  timeLimitSeconds: number;
  /** Paise; always positive for a Sectional Test product (Req 6.2). */
  priceAmount: number;
  currency: string;
  /**
   * Whether the requesting Learner already holds a Payment Entitlement for this
   * Section — `true` shows "Start test" instead of "Buy" (Req 2.3). Resolved
   * from the caller's Access Token; `false` for an unauthenticated caller.
   */
  isEntitled: boolean;
}

/**
 * The per-Section timing/status snapshot within an attempt (used under
 * Sectional Timing, Req 12.1). `remainingSeconds` is the server-computed
 * remaining time for that Section Attempt (Section Time Limit minus its
 * Accumulated Active Time).
 */
export interface SectionStateDto {
  sectionId: string;
  status: AttemptStatus;
  /** Server-computed remaining time for this Section (Req 12.1). */
  remainingSeconds: number;
}

/**
 * The server-authoritative state of a Test Attempt returned to the client on
 * start/resume/pause/respond (Req 9.1–9.3, 10.1, 10.3). All timing decisions are
 * the server's; the client renders this state as-is.
 */
export interface AttemptStateDto {
  attemptId: string;
  testId: string;
  status: AttemptStatus;
  timingMode: TestTimingMode;
  /** Start Timestamp, ISO 8601 UTC `Z` (Req 9.1, 16.3). */
  startedAt: string;
  /** Server-computed remaining time for the attempt scope (Req 9.3). */
  remainingSeconds: number;
  /** Per-Section status + remaining time (Sectional Timing, Req 12.1). */
  sections: SectionStateDto[];
  /** Present only when `status === 'completed'`; decimal marks (R3, Req 13.5). */
  scoreMarks?: number;
}

/**
 * One Question as surfaced in an attempt review (Req 14.2): the Question text,
 * its Options, the Correct Option Set, and the Learner's recorded Response.
 */
export interface ReviewQuestionDto {
  questionId: string;
  text: string;
  /** The Question's Options, in Admin-defined order. */
  options: ReviewOptionDto[];
  /** The ids of the Options flagged correct (the Correct Option Set, Req 14.2). */
  correctOptionIds: string[];
  /** The ids of the Options the Learner selected; empty when unanswered. */
  selectedOptionIds: string[];
}

/**
 * An Option as surfaced in an attempt review — identifier and display text only
 * (the correct/incorrect flag is conveyed via `ReviewQuestionDto.correctOptionIds`).
 */
export interface ReviewOptionDto {
  id: string;
  text: string;
}

/**
 * A completed Test Attempt reviewed by its owning Learner (Req 14.2). Returns
 * every Question with its Options, Correct Option Set, and recorded Response.
 */
export interface AttemptReviewDto {
  attemptId: string;
  testTitle: string;
  /** Total Score as decimal marks (R3, Req 13.5). */
  scoreMarks: number;
  /** Completion time, ISO 8601 UTC `Z` (Req 16.3). */
  completedAt: string;
  questions: ReviewQuestionDto[];
}

/**
 * One entry in a Learner's attempt history: a completed Test Attempt with its
 * Test title, total Score, and completion time (Req 14.1).
 */
export interface AttemptHistoryItemDto {
  attemptId: string;
  testId: string;
  testTitle: string;
  /** Total Score as decimal marks (R3, Req 13.5). */
  scoreMarks: number;
  /** Completion time, ISO 8601 UTC `Z` (Req 16.3). */
  completedAt: string;
}

/**
 * One Question surfaced to a Learner while taking an attempt
 * (`GET /api/attempts/:id/questions`, Req 9.4). Carries the Question text and
 * its Options (id + text only) in Admin-defined order plus the Learner's
 * currently recorded selection so a resumed attempt can seed prior answers.
 * The correct/incorrect flags are NEVER included while the attempt is open —
 * scoring is server-side on submit (D4, Req 13).
 */
export interface AttemptQuestionDto {
  questionId: string;
  sectionId: string;
  text: string;
  /** The Question's Options (id + text only), in Admin-defined order. */
  options: ReviewOptionDto[];
  /** The Options the Learner has currently selected; empty when unanswered. */
  selectedOptionIds: string[];
}

/**
 * The in-scope Questions for a Learner's attempt, in Admin-defined order
 * (`GET /api/attempts/:id/questions`, Req 9.4). For a Section-scoped attempt only
 * the covered Section's Questions are returned; for a whole-Test attempt every
 * Section's Questions are returned. Correctness is never included.
 */
export interface AttemptQuestionsDto {
  attemptId: string;
  questions: AttemptQuestionDto[];
}
