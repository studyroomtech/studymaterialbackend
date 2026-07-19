// Types for the Test Series repository (Req 1.15: type declarations live only
// in `*.types.ts`).
//
// The Test Series repository persists and reads the authoring graph
// (Test → Sections → Questions → Options) and the listing rows. Marks are stored
// as integer centi-marks and money as integer paise (see the Prisma schema); the
// repository passes those integers through unchanged and defers all
// serialization (decimal marks, ISO timestamps) to the service/DTO layer.

import type { Option, Question, Section, Test } from '@prisma/client';

/**
 * A single Option to persist for a Question. `orderIndex` fixes the
 * Admin-defined position within the Question (Req 4.1); `isCorrect` flags
 * membership of the Correct Option Set (Req 4.2).
 */
export interface OptionData {
  text: string;
  isCorrect: boolean;
  orderIndex: number;
}

/**
 * A single Question (with its Options) to persist within a Section.
 * `orderIndex` fixes the Admin-defined order within the Section (Req 3.6).
 */
export interface QuestionData {
  text: string;
  orderIndex: number;
  options: OptionData[];
}

/**
 * Fields persisted when creating a Test (Req 2.1–2.4). `priceAmount` is paise
 * (null => free Test); `currency` is omitted to let the schema default (INR)
 * apply. Validation (bounds, timing mode) is performed by the service layer
 * before the repository is called.
 */
export interface CreateTestData {
  title: string;
  timingMode: Test['timingMode'];
  timeLimitSeconds: number;
  priceAmount?: number | null;
  currency?: string;
}

/**
 * Editable Test-level fields (Req 5.5). Every field is optional so callers can
 * patch a subset; omitted fields are left unchanged and no Section is touched.
 */
export interface UpdateTestData {
  title?: string;
  timingMode?: Test['timingMode'];
  timeLimitSeconds?: number;
  priceAmount?: number | null;
  currency?: string;
}

/**
 * Fields persisted when adding a Section together with its Questions/Options
 * (Req 3.1–3.4, 5.1). The whole Section graph is written in a single
 * transaction so a Section is never partially persisted. `priceAmount` is paise
 * (null/0 => reachable only via the parent Test's Entitlement, Req 3.4).
 */
export interface CreateSectionData {
  title: string;
  orderIndex: number;
  timeLimitSeconds: number;
  correctMarkCenti: number;
  negativeMarkCenti: number;
  priceAmount?: number | null;
  currency?: string;
  questions: QuestionData[];
}

/**
 * Editable Section fields and, optionally, a full replacement of its Questions
 * (Req 5.2). When `questions` is provided the Section's existing Questions and
 * Options are replaced atomically; when omitted, only the scalar fields are
 * updated and the Questions are left unchanged. Editing one Section never
 * alters another Section (Req 5.5).
 */
export interface UpdateSectionData {
  title?: string;
  orderIndex?: number;
  timeLimitSeconds?: number;
  correctMarkCenti?: number;
  negativeMarkCenti?: number;
  priceAmount?: number | null;
  currency?: string;
  questions?: QuestionData[];
}

/**
 * Fields persisted when adding a Question (with its Options) to a Section
 * (Req 4.1). `orderIndex` fixes the Admin-defined position within the Section.
 */
export interface CreateQuestionData {
  text: string;
  orderIndex: number;
  options: OptionData[];
}

/**
 * Editable Question fields and, optionally, a full replacement of its Options
 * (Req 5.2). When `options` is provided the Question's existing Options are
 * replaced atomically; when omitted, only the scalar fields are updated.
 */
export interface UpdateQuestionData {
  text?: string;
  orderIndex?: number;
  options?: OptionData[];
}

/** A Question together with its Options ordered by `orderIndex` ascending. */
export type QuestionWithOptions = Question & { options: Option[] };

/**
 * A Section together with its ordered Questions → Options graph, as returned by
 * the authoring reads and the Section-scoped attempt/scoring reads.
 */
export type SectionWithQuestions = Section & {
  questions: QuestionWithOptions[];
};

/**
 * The full authoring/attempt graph for a Test: ordered Sections, each with its
 * ordered Questions → Options (Req 5.3, 6.4). Backs both the admin authoring
 * view and attempt start/scoring.
 */
export type TestGraph = Test & {
  sections: SectionWithQuestions[];
};

/**
 * A Section together with its parent Test and its ordered Questions → Options,
 * as needed to start and score a Section-scoped attempt (Req 8.2, 12.1).
 */
export type SectionGraph = Section & {
  test: Test;
  questions: QuestionWithOptions[];
};

/**
 * A priced Section together with its parent Test, for the Sectional Tests
 * listing (Req 6.1). Only Sections whose `priceAmount` is present and positive
 * are returned by the listing read.
 */
export type SectionWithTest = Section & { test: Test };

/**
 * The Test Series repository contract (Req 5.1, 5.2, 5.4, 6.4). Persistence and
 * ordered reads over the Test authoring graph, injected into the authoring,
 * listing, and attempt services exactly as the Prisma-backed repositories are
 * wired into the existing payment/material services.
 */
export interface TestRepository {
  /** Persist a new Test and return the created record (Req 2.1). */
  createTest(input: CreateTestData): Promise<Test>;
  /** Update Test-level fields only, leaving Sections untouched (Req 5.5). */
  updateTest(id: string, input: UpdateTestData): Promise<Test>;
  /**
   * Persist a Section with its nested Questions/Options in a single transaction
   * and return the ordered Section graph (Req 5.1, 5.4).
   */
  createSection(
    testId: string,
    input: CreateSectionData
  ): Promise<SectionWithQuestions>;
  /**
   * Update a Section (optionally replacing its Questions/Options) in a single
   * transaction; no other Section is altered (Req 5.2, 5.4, 5.5).
   */
  updateSection(
    id: string,
    input: UpdateSectionData
  ): Promise<SectionWithQuestions>;
  /** Persist a Question with its Options in a single transaction (Req 4.1, 5.4). */
  createQuestion(
    sectionId: string,
    input: CreateQuestionData
  ): Promise<QuestionWithOptions>;
  /**
   * Update a Question (optionally replacing its Options) in a single
   * transaction (Req 5.2, 5.4).
   */
  updateQuestion(
    id: string,
    input: UpdateQuestionData
  ): Promise<QuestionWithOptions>;
  /**
   * Load a Test with its ordered Sections → Questions → Options, or `null` when
   * none exists. Backs the admin authoring view (Req 5.3) and attempt
   * start/scoring for a whole-Test attempt.
   */
  findTestGraphById(id: string): Promise<TestGraph | null>;
  /**
   * Load a Section with its parent Test and ordered Questions → Options, or
   * `null` when none exists. Backs Section-scoped attempt start/scoring (Req 8.2).
   */
  findSectionGraphById(id: string): Promise<SectionGraph | null>;
  /**
   * List every Test (including free Tests) in the deterministic
   * `createdAt asc, id asc` order for the Test Series listing (Req 6.1, 6.4).
   */
  listTests(): Promise<Test[]>;
  /**
   * List every Section whose Price amount is present and positive, with its
   * parent Test, in the deterministic `createdAt asc, id asc` order for the
   * Sectional Tests listing (Req 6.1, 6.4).
   */
  listPricedSections(): Promise<SectionWithTest[]>;
}
