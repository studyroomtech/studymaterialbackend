// Types for the Test authoring service (Req 1.15: all type/interface
// declarations live only in `*.types.ts`).
//
// This module describes the public surface of the Test authoring service
// (`testSeries.service.ts`) together with:
//   - the Admin-supplied Create/Edit inputs for Tests, Sections, and Questions,
//   - the normalized/validated shapes the pure validators return, and
//   - the response DTOs the service maps persisted records to.
//
// The service persists through the injected `TestRepository`
// (`repositories/testSeries.repository.types.ts`), mirroring how the
// payment/material services are wired over their repositories. Following the
// platform serialization contract (Req 16.3, 16.5, R3): timestamps are ISO 8601
// UTC `Z` strings, monetary amounts are integer paise + Currency, and marks are
// surfaced as decimal marks (stored `centimarks / 100`, R3) while
// Admin-supplied marks are decimal marks converted to integer centi-marks on
// persistence.

import type { TestTimingMode } from '../types/domain.types';
import type { TestRepository } from '../repositories/testSeries.repository.types';

// --- Inputs (Admin-supplied) ----------------------------------------------

/**
 * A single Option supplied when authoring a Question (Req 4.1). `text` is the
 * display text (1–1000 chars); `isCorrect` flags membership of the Correct
 * Option Set (Req 4.2).
 */
export interface OptionInput {
  text: string;
  isCorrect: boolean;
}

/**
 * The input to create a Question: its text (1–2000 chars) and two or more
 * Options, at least one flagged correct (Req 4.1, 4.2).
 */
export interface CreateQuestionInput {
  text: string;
  options: OptionInput[];
}

/**
 * The editable Question fields (Req 5.2). Every field is optional so callers can
 * patch a subset; when `options` is supplied it fully replaces the Question's
 * Options (and must still satisfy the ≥2 Options / ≥1 correct bounds).
 */
export interface EditQuestionInput {
  text?: string;
  options?: OptionInput[];
}

/**
 * The input to create a Section together with its Questions (Req 3.1–3.4, 5.1).
 * `correctMark`/`negativeMark` are non-negative decimal marks (converted to
 * integer centi-marks on persistence, R3); `timeLimitSeconds` is a positive
 * whole number; the optional Price amount is integer paise (null/0 => reachable
 * only via the parent Test's Entitlement, Req 3.4).
 */
export interface CreateSectionInput {
  title: string;
  timeLimitSeconds: number;
  correctMark: number;
  negativeMark: number;
  priceAmount?: number | null;
  currency?: string | null;
  questions?: CreateQuestionInput[];
}

/**
 * The editable Section fields and, optionally, a full replacement of its
 * Questions (Req 5.2). Every field is optional; omitted fields are left
 * unchanged and no other Section is altered (Req 5.5).
 */
export interface EditSectionInput {
  title?: string;
  timeLimitSeconds?: number;
  correctMark?: number;
  negativeMark?: number;
  priceAmount?: number | null;
  currency?: string | null;
  questions?: CreateQuestionInput[];
}

/**
 * The input to create a Test (Req 2.1–2.4): a title (1–200 chars), a Timing
 * Mode (exactly `overall` or `sectional`), a positive whole-second overall Time
 * Limit, and an optional Price amount in integer paise (null/0 => free Test).
 */
export interface CreateTestInput {
  title: string;
  timingMode: TestTimingMode;
  timeLimitSeconds: number;
  priceAmount?: number | null;
  currency?: string | null;
}

/**
 * The editable Test-level fields (Req 5.5). Every field is optional; omitted
 * fields are left unchanged and every Section is left untouched.
 */
export interface EditTestInput {
  title?: string;
  timingMode?: TestTimingMode;
  timeLimitSeconds?: number;
  priceAmount?: number | null;
  currency?: string | null;
}

// --- Normalized (validated) shapes ----------------------------------------

/**
 * A validated, normalized Test as produced by `validateTestFields`: the trimmed
 * title, the Timing Mode, the positive Time Limit, and the validated Price
 * (amount in paise, `null` for a free Test) with its Currency.
 */
export interface NormalizedTest {
  title: string;
  timingMode: TestTimingMode;
  timeLimitSeconds: number;
  priceAmount: number | null;
  currency: string;
}

/**
 * A validated, normalized Section as produced by `validateSectionFields`. Marks
 * are already converted to non-negative integer centi-marks (R3); the Price is
 * validated (amount in paise, `null` when the Section is reachable only via the
 * parent Test).
 */
export interface NormalizedSection {
  title: string;
  timeLimitSeconds: number;
  correctMarkCenti: number;
  negativeMarkCenti: number;
  priceAmount: number | null;
  currency: string;
}

/** A validated, normalized Option (trimmed text + correct flag). */
export interface NormalizedOption {
  text: string;
  isCorrect: boolean;
}

/**
 * A validated, normalized Question as produced by `validateQuestion`: the
 * trimmed text and its normalized Options (≥2, ≥1 correct).
 */
export interface NormalizedQuestion {
  text: string;
  options: NormalizedOption[];
}

// --- Response DTOs --------------------------------------------------------

/**
 * A Test's authoring metadata (Req 2.1–2.4). `priceAmount` is integer paise
 * (`null` for a free Test); `isFree` mirrors the pure `classifyPrice` decision.
 * Timestamps are ISO 8601 UTC `Z` strings (Req 16.3).
 */
export interface TestDto {
  id: string;
  title: string;
  timingMode: TestTimingMode;
  timeLimitSeconds: number;
  priceAmount: number | null;
  currency: string;
  isFree: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * An Option within the admin authoring view: its identifier, display text, the
 * correct/incorrect flag (visible to the authoring Admin), and its
 * Admin-defined position (Req 4.1, 5.3).
 */
export interface OptionDto {
  id: string;
  text: string;
  isCorrect: boolean;
  orderIndex: number;
}

/**
 * A Question within the admin authoring view with its ordered Options (Req 3.6,
 * 4.1, 5.3).
 */
export interface QuestionDto {
  id: string;
  sectionId: string;
  text: string;
  orderIndex: number;
  options: OptionDto[];
}

/**
 * A Section within the admin authoring view (Req 3.1–3.6, 5.3). Marks are
 * surfaced as decimal marks (`centimarks / 100`, R3); `priceAmount` is integer
 * paise (`null` when reachable only via the parent Test); `isPriced` is true
 * iff the Section is an independently purchasable Sectional Test product
 * (Req 3.3).
 */
export interface SectionDto {
  id: string;
  testId: string;
  title: string;
  orderIndex: number;
  timeLimitSeconds: number;
  correctMark: number;
  negativeMark: number;
  priceAmount: number | null;
  currency: string;
  isPriced: boolean;
  questions: QuestionDto[];
}

/**
 * The full admin authoring view for a Test: the Test metadata plus its ordered
 * Sections → Questions → Options (Req 5.3).
 */
export interface AdminTestDto extends TestDto {
  sections: SectionDto[];
}

// --- Service contract -----------------------------------------------------

/**
 * The dependency bundle the Test authoring service is constructed with. The
 * concrete Prisma-backed `TestRepository` is injected by the default wiring
 * (`createDefaultTestService`), matching how `createDefaultPaymentService`
 * wires the payment repositories.
 */
export interface TestServiceDeps {
  tests: TestRepository;
}

/**
 * The public surface of the Test authoring service. Every method resolves with
 * the affected entity's DTO or throws a typed domain error (ValidationError →
 * 422 with per-field `fields`; NotFoundError → 404) that the errorHandler maps
 * to the unified envelope without leaking internals (Req 2.5, 3.5, 4.4, 8.3).
 */
export interface TestService {
  /** Create a Test (title 1–200, Timing Mode, positive overall time; optional Price) (Req 2.1–2.5). */
  createTest(input: CreateTestInput): Promise<TestDto>;
  /** Edit Test-level fields only; leaves every Section untouched (Req 5.5). */
  editTest(testId: string, input: EditTestInput): Promise<TestDto>;
  /** Persist a Section (+ its Questions/Options) independently and return it (Req 5.1, 3.*). */
  addSection(testId: string, input: CreateSectionInput): Promise<SectionDto>;
  /** Update a persisted Section (or its Questions); no other Section is altered (Req 5.2, 5.5). */
  editSection(sectionId: string, input: EditSectionInput): Promise<SectionDto>;
  /** Add a Question (text 1–2000, ≥2 Options each 1–1000, ≥1 correct) to a Section (Req 4). */
  addQuestion(sectionId: string, input: CreateQuestionInput): Promise<QuestionDto>;
  /** Edit a persisted Question (optionally replacing its Options) (Req 5.2). */
  editQuestion(questionId: string, input: EditQuestionInput): Promise<QuestionDto>;
  /** Load a Test with ordered Sections/Questions/Options for the authoring UI (Req 5.3). */
  getTestForAdmin(testId: string): Promise<AdminTestDto>;
}
