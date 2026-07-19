// Test authoring service — Admin Content Management for Tests, Sections, and
// Questions with incremental per-section persistence (Req 2–5).
//
// This service coordinates the admin authoring actions:
//
//   - createTest  — validate Test fields (title 1–200, Timing Mode, positive
//     overall Time Limit; optional Price) and persist a Test (Req 2.1–2.5).
//   - editTest    — patch Test-level fields only, leaving every Section
//     untouched (Req 5.5).
//   - addSection  — validate the Section and each of its Questions, then persist
//     the Section together with its Questions/Options in one transaction,
//     appended after the existing Sections and altering no other Section
//     (Req 3.*, 5.1, 5.4, 5.5).
//   - editSection — patch a persisted Section (optionally replacing its whole
//     Questions/Options subtree) without touching any other Section (Req 5.2,
//     5.5).
//   - addQuestion / editQuestion — append or patch a Question within a Section
//     (Req 4, 5.2).
//   - getTestForAdmin — load the ordered Test → Sections → Questions → Options
//     graph for the authoring UI (Req 5.3).
//
// The field rules that require no I/O — bounds/timing-mode/correct-option-set
// validation, decimal-mark → centi-mark conversion, and mapping persisted
// records to DTOs — are isolated into exported pure functions (`validateTestFields`,
// `validateSectionFields`, `validateQuestion`, `isMultipleCorrect`) so they can
// be reasoned about independently of persistence. Each validator throws a
// `ValidationError` naming every invalid field and persists nothing on failure
// (Req 2.5, 3.5, 4.4). All persistence is reached only through the injected
// `TestRepository`, keeping the service independent of Prisma (mirroring
// `createDefaultPaymentService`).

import {
  CENTIMARKS_PER_MARK,
  MIN_CORRECT_OPTIONS_PER_QUESTION,
  MIN_OPTIONS_PER_QUESTION,
  OPTION_TEXT_MAX_LENGTH,
  OPTION_TEXT_MIN_LENGTH,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_TEXT_MIN_LENGTH,
  TEST_TITLE_MAX_LENGTH,
  TEST_TITLE_MIN_LENGTH,
} from '../constants/limits.constant';
import { NotFoundError, ValidationError } from '../utils/errors';
import { classifyPrice, validatePrice } from './price.service';
import * as testSeriesRepository from '../repositories/testSeries.repository';
import type { ApiErrorFieldDto } from '../types/api.types';
import type { TestTimingMode } from '../types/domain.types';
import type {
  CreateQuestionData,
  QuestionData,
  QuestionWithOptions,
  SectionWithQuestions,
  TestGraph,
  UpdateQuestionData,
  UpdateSectionData,
  UpdateTestData,
} from '../repositories/testSeries.repository.types';
import type { Option, Test } from '@prisma/client';
import type {
  AdminTestDto,
  CreateQuestionInput,
  CreateSectionInput,
  CreateTestInput,
  EditQuestionInput,
  EditSectionInput,
  EditTestInput,
  NormalizedOption,
  NormalizedQuestion,
  NormalizedSection,
  NormalizedTest,
  OptionDto,
  OptionInput,
  QuestionDto,
  SectionDto,
  TestDto,
  TestService,
  TestServiceDeps,
} from './testSeries.service.types';

// The Timing Modes a Test may carry (Req 2.2). Kept local to the validators.
const TIMING_MODES: readonly TestTimingMode[] = ['overall', 'sectional'];

const VALIDATION_MESSAGE = 'The request contains one or more invalid fields.';

// --- Pure primitives (no I/O) ---------------------------------------------

/** Trim surrounding whitespace, coalescing a nullish value to an empty string. */
function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** Whether a value is a positive whole number of seconds (Req 2.1, 3.1). */
function isPositiveWholeSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Whether a value is a finite, non-negative decimal mark (Req 3.1). */
function isNonNegativeMark(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Convert a non-negative decimal mark to integer centi-marks (R3, Req 13.2). */
function marksToCenti(marks: number): number {
  return Math.round(marks * CENTIMARKS_PER_MARK);
}

/** Whether a string length falls within an inclusive `[min, max]` bound. */
function isWithinLength(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max;
}

// --- Field collectors (push per-field errors) -----------------------------

/**
 * Validate a title against the shared 1–200 bound, pushing a `title` field
 * error when out of bounds (Req 2.1). Returns the trimmed title.
 */
function collectTitle(
  raw: string | null | undefined,
  fields: ApiErrorFieldDto[],
): string {
  const title = normalizeText(raw);
  if (!isWithinLength(title, TEST_TITLE_MIN_LENGTH, TEST_TITLE_MAX_LENGTH)) {
    fields.push({
      field: 'title',
      reason: `title must be between ${TEST_TITLE_MIN_LENGTH} and ${TEST_TITLE_MAX_LENGTH} characters.`,
    });
  }
  return title;
}

/** Push a `timingMode` error when the value is not exactly overall/sectional (Req 2.2). */
function collectTimingMode(value: unknown, fields: ApiErrorFieldDto[]): void {
  if (!TIMING_MODES.includes(value as TestTimingMode)) {
    fields.push({
      field: 'timingMode',
      reason: 'timingMode must be one of "overall" or "sectional".',
    });
  }
}

/** Push a `timeLimitSeconds` error when the value is not a positive whole number (Req 2.1, 3.1). */
function collectTimeLimit(value: unknown, fields: ApiErrorFieldDto[]): void {
  if (!isPositiveWholeSeconds(value)) {
    fields.push({
      field: 'timeLimitSeconds',
      reason: 'timeLimitSeconds must be a positive whole number of seconds.',
    });
  }
}

/** Push a `<field>` error when the mark is negative or non-numeric (Req 3.1, 3.5). */
function collectMark(
  value: unknown,
  field: string,
  fields: ApiErrorFieldDto[],
): void {
  if (!isNonNegativeMark(value)) {
    fields.push({ field, reason: `${field} must be a non-negative number.` });
  }
}

/**
 * Validate a Question's text bound and its Option set (≥2 Options, each 1–1000
 * chars, ≥1 flagged correct), pushing a per-field error for each violation
 * (Req 4.1, 4.2, 4.4). Field paths are indexed (`options.<i>.text`) so the
 * authoring UI can surface the offending Option.
 */
function collectQuestionText(
  text: string,
  fields: ApiErrorFieldDto[],
): void {
  if (!isWithinLength(text, QUESTION_TEXT_MIN_LENGTH, QUESTION_TEXT_MAX_LENGTH)) {
    fields.push({
      field: 'text',
      reason: `text must be between ${QUESTION_TEXT_MIN_LENGTH} and ${QUESTION_TEXT_MAX_LENGTH} characters.`,
    });
  }
}

function collectOptions(
  options: readonly OptionInput[] | null | undefined,
  fields: ApiErrorFieldDto[],
): void {
  const list = options ?? [];
  if (list.length < MIN_OPTIONS_PER_QUESTION) {
    fields.push({
      field: 'options',
      reason: `a Question must have at least ${MIN_OPTIONS_PER_QUESTION} Options.`,
    });
  }
  list.forEach((option, index) => {
    const optionText = normalizeText(option?.text);
    if (!isWithinLength(optionText, OPTION_TEXT_MIN_LENGTH, OPTION_TEXT_MAX_LENGTH)) {
      fields.push({
        field: `options.${index}.text`,
        reason: `option text must be between ${OPTION_TEXT_MIN_LENGTH} and ${OPTION_TEXT_MAX_LENGTH} characters.`,
      });
    }
  });
  const correctCount = list.filter((option) => option?.isCorrect === true).length;
  if (correctCount < MIN_CORRECT_OPTIONS_PER_QUESTION) {
    fields.push({
      field: 'options',
      reason: `a Question must have at least ${MIN_CORRECT_OPTIONS_PER_QUESTION} correct Option.`,
    });
  }
}

/** Normalize an Option set (trim text, coerce the correct flag). */
function normalizeOptions(options: readonly OptionInput[]): NormalizedOption[] {
  return options.map((option) => ({
    text: normalizeText(option.text),
    isCorrect: option.isCorrect === true,
  }));
}

// --- Exported pure validators ---------------------------------------------

/**
 * Validate the Test-level fields for creation and return the normalized Test
 * (Req 2.1–2.5). Throws a `ValidationError` naming every invalid field (title,
 * timingMode, timeLimitSeconds) and persists nothing; the Price is validated by
 * the shared `validatePrice` (paise amount, `null` for a free Test).
 */
export function validateTestFields(input: CreateTestInput): NormalizedTest {
  const fields: ApiErrorFieldDto[] = [];
  const title = collectTitle(input.title, fields);
  collectTimingMode(input.timingMode, fields);
  collectTimeLimit(input.timeLimitSeconds, fields);
  if (fields.length > 0) {
    throw new ValidationError(VALIDATION_MESSAGE, fields);
  }
  const price = validatePrice(input.priceAmount, input.currency);
  return {
    title,
    timingMode: input.timingMode,
    timeLimitSeconds: input.timeLimitSeconds,
    priceAmount: price.amount,
    currency: price.currency,
  };
}

/**
 * Validate a Section's own fields for creation and return the normalized
 * Section with marks converted to integer centi-marks (Req 3.1–3.5, R3). Throws
 * a `ValidationError` naming every invalid field and persists nothing; the
 * Price is validated by the shared `validatePrice`.
 */
export function validateSectionFields(input: CreateSectionInput): NormalizedSection {
  const fields: ApiErrorFieldDto[] = [];
  const title = collectTitle(input.title, fields);
  collectTimeLimit(input.timeLimitSeconds, fields);
  collectMark(input.correctMark, 'correctMark', fields);
  collectMark(input.negativeMark, 'negativeMark', fields);
  if (fields.length > 0) {
    throw new ValidationError(VALIDATION_MESSAGE, fields);
  }
  const price = validatePrice(input.priceAmount, input.currency);
  return {
    title,
    timeLimitSeconds: input.timeLimitSeconds,
    correctMarkCenti: marksToCenti(input.correctMark),
    negativeMarkCenti: marksToCenti(input.negativeMark),
    priceAmount: price.amount,
    currency: price.currency,
  };
}

/**
 * Validate a Question and its Options for creation and return the normalized
 * Question (Req 4.1, 4.2, 4.4). Throws a `ValidationError` naming every invalid
 * field (question text and each offending Option) and persists nothing.
 */
export function validateQuestion(input: CreateQuestionInput): NormalizedQuestion {
  const fields: ApiErrorFieldDto[] = [];
  const text = normalizeText(input.text);
  collectQuestionText(text, fields);
  collectOptions(input.options, fields);
  if (fields.length > 0) {
    throw new ValidationError(VALIDATION_MESSAGE, fields);
  }
  return { text, options: normalizeOptions(input.options) };
}

/**
 * Whether an Option set makes its Question a Multiple-Correct Question — i.e. it
 * carries two or more correct Options (Req 4.3). Pure.
 */
export function isMultipleCorrect(options: readonly OptionInput[]): boolean {
  return (
    options.filter((option) => option?.isCorrect === true).length >=
    MIN_OPTIONS_PER_QUESTION
  );
}

// --- Pure mappers (normalized/persisted → repository input / DTO) ----------

/** Map a normalized Question to the repository nested-create payload at `orderIndex`. */
function toQuestionData(question: NormalizedQuestion, orderIndex: number): QuestionData {
  return {
    text: question.text,
    orderIndex,
    options: question.options.map((option, index) => ({
      text: option.text,
      isCorrect: option.isCorrect,
      orderIndex: index,
    })),
  };
}

/** Map a persisted Option to its authoring DTO. */
function toOptionDto(option: Option): OptionDto {
  return {
    id: option.id,
    text: option.text,
    isCorrect: option.isCorrect,
    orderIndex: option.orderIndex,
  };
}

/** Map a persisted Question (with Options) to its authoring DTO. */
function toQuestionDto(question: QuestionWithOptions): QuestionDto {
  return {
    id: question.id,
    sectionId: question.sectionId,
    text: question.text,
    orderIndex: question.orderIndex,
    options: question.options.map(toOptionDto),
  };
}

/** Map a persisted Section (with its ordered Questions) to its authoring DTO. */
function toSectionDto(section: SectionWithQuestions): SectionDto {
  return {
    id: section.id,
    testId: section.testId,
    title: section.title,
    orderIndex: section.orderIndex,
    timeLimitSeconds: section.timeLimitSeconds,
    correctMark: section.correctMarkCenti / CENTIMARKS_PER_MARK,
    negativeMark: section.negativeMarkCenti / CENTIMARKS_PER_MARK,
    priceAmount: section.priceAmount,
    currency: section.currency,
    isPriced: classifyPrice(section.priceAmount) === 'paid',
    questions: section.questions.map(toQuestionDto),
  };
}

/** Map a persisted Test to its authoring DTO (marks/prices/timestamps serialized). */
function toTestDto(test: Test): TestDto {
  return {
    id: test.id,
    title: test.title,
    timingMode: test.timingMode,
    timeLimitSeconds: test.timeLimitSeconds,
    priceAmount: test.priceAmount,
    currency: test.currency,
    isFree: classifyPrice(test.priceAmount) === 'free',
    createdAt: test.createdAt.toISOString(),
    updatedAt: test.updatedAt.toISOString(),
  };
}

/** Map the ordered Test graph to the full admin authoring view (Req 5.3). */
function toAdminTestDto(graph: TestGraph): AdminTestDto {
  return {
    ...toTestDto(graph),
    sections: graph.sections.map(toSectionDto),
  };
}

// --- Service factory ------------------------------------------------------

/**
 * Construct the Test authoring service over the injected `TestRepository`. The
 * default wiring (`createDefaultTestService`) supplies the concrete
 * Prisma-backed repository.
 */
export function createTestService(deps: TestServiceDeps): TestService {
  const { tests } = deps;

  /**
   * Create a Test from validated fields and return its DTO (Req 2.1–2.5).
   * Validation runs before any persistence, so a rejected submission persists
   * nothing (Req 2.5).
   */
  async function createTest(input: CreateTestInput): Promise<TestDto> {
    const normalized = validateTestFields(input);
    const created = await tests.createTest({
      title: normalized.title,
      timingMode: normalized.timingMode,
      timeLimitSeconds: normalized.timeLimitSeconds,
      priceAmount: normalized.priceAmount,
      currency: normalized.currency,
    });
    return toTestDto(created);
  }

  /**
   * Edit Test-level fields only, leaving every Section untouched (Req 5.5). A
   * missing Test yields a not-found error with nothing changed (Req 5.4). Only
   * the supplied fields are validated and patched; omitted fields are left
   * unchanged.
   */
  async function editTest(testId: string, input: EditTestInput): Promise<TestDto> {
    const existing = await tests.findTestGraphById(testId);
    if (existing === null) {
      throw new NotFoundError('The requested Test was not found.');
    }

    const fields: ApiErrorFieldDto[] = [];
    const update: UpdateTestData = {};
    if (input.title !== undefined) {
      update.title = collectTitle(input.title, fields);
    }
    if (input.timingMode !== undefined) {
      collectTimingMode(input.timingMode, fields);
      update.timingMode = input.timingMode;
    }
    if (input.timeLimitSeconds !== undefined) {
      collectTimeLimit(input.timeLimitSeconds, fields);
      update.timeLimitSeconds = input.timeLimitSeconds;
    }
    if (fields.length > 0) {
      throw new ValidationError(VALIDATION_MESSAGE, fields);
    }
    if (input.priceAmount !== undefined) {
      const price = validatePrice(input.priceAmount, input.currency);
      update.priceAmount = price.amount;
      update.currency = price.currency;
    }

    const updated = await tests.updateTest(testId, update);
    return toTestDto(updated);
  }

  /**
   * Persist a Section together with its Questions/Options independently of the
   * other Sections and return it (Req 5.1, 5.4). The Section is appended after
   * the existing Sections (preserving the Admin-defined order, Req 2.6); a
   * missing Test yields a not-found error with nothing persisted (Req 5.4).
   */
  async function addSection(
    testId: string,
    input: CreateSectionInput,
  ): Promise<SectionDto> {
    const normalized = validateSectionFields(input);
    const questions = (input.questions ?? []).map(validateQuestion);

    const test = await tests.findTestGraphById(testId);
    if (test === null) {
      throw new NotFoundError('The requested Test was not found.');
    }

    const created = await tests.createSection(testId, {
      title: normalized.title,
      orderIndex: test.sections.length,
      timeLimitSeconds: normalized.timeLimitSeconds,
      correctMarkCenti: normalized.correctMarkCenti,
      negativeMarkCenti: normalized.negativeMarkCenti,
      priceAmount: normalized.priceAmount,
      currency: normalized.currency,
      questions: questions.map(toQuestionData),
    });
    return toSectionDto(created);
  }

  /**
   * Edit a persisted Section (optionally replacing its whole Questions/Options
   * subtree) without altering any other Section (Req 5.2, 5.5). A missing
   * Section yields a not-found error with nothing changed (Req 5.4). Only the
   * supplied fields are validated and patched.
   */
  async function editSection(
    sectionId: string,
    input: EditSectionInput,
  ): Promise<SectionDto> {
    const existing = await tests.findSectionGraphById(sectionId);
    if (existing === null) {
      throw new NotFoundError('The requested Section was not found.');
    }

    const fields: ApiErrorFieldDto[] = [];
    const update: UpdateSectionData = {};
    if (input.title !== undefined) {
      update.title = collectTitle(input.title, fields);
    }
    if (input.timeLimitSeconds !== undefined) {
      collectTimeLimit(input.timeLimitSeconds, fields);
      update.timeLimitSeconds = input.timeLimitSeconds;
    }
    if (input.correctMark !== undefined) {
      collectMark(input.correctMark, 'correctMark', fields);
    }
    if (input.negativeMark !== undefined) {
      collectMark(input.negativeMark, 'negativeMark', fields);
    }
    // Validate any supplied Questions up-front so the whole edit is rejected
    // before persistence if any Question is invalid (Req 4.4, 5.4).
    const normalizedQuestions =
      input.questions !== undefined
        ? input.questions.map((question) => {
            try {
              return validateQuestion(question);
            } catch (error) {
              if (error instanceof ValidationError && error.fields !== undefined) {
                fields.push(...error.fields);
                return null;
              }
              throw error;
            }
          })
        : undefined;
    if (fields.length > 0) {
      throw new ValidationError(VALIDATION_MESSAGE, fields);
    }
    if (input.correctMark !== undefined) {
      update.correctMarkCenti = marksToCenti(input.correctMark);
    }
    if (input.negativeMark !== undefined) {
      update.negativeMarkCenti = marksToCenti(input.negativeMark);
    }
    if (input.priceAmount !== undefined) {
      const price = validatePrice(input.priceAmount, input.currency);
      update.priceAmount = price.amount;
      update.currency = price.currency;
    }
    if (normalizedQuestions !== undefined) {
      update.questions = (normalizedQuestions as NormalizedQuestion[]).map(
        toQuestionData,
      );
    }

    const updated = await tests.updateSection(sectionId, update);
    return toSectionDto(updated);
  }

  /**
   * Append a validated Question (with its Options) to a Section and return it
   * (Req 4.1, 5.2). A missing Section yields a not-found error with nothing
   * persisted (Req 5.4). The Question is appended after the existing Questions,
   * preserving the Admin-defined order (Req 3.6).
   */
  async function addQuestion(
    sectionId: string,
    input: CreateQuestionInput,
  ): Promise<QuestionDto> {
    const normalized = validateQuestion(input);

    const section = await tests.findSectionGraphById(sectionId);
    if (section === null) {
      throw new NotFoundError('The requested Section was not found.');
    }

    const data: CreateQuestionData = toQuestionData(
      normalized,
      section.questions.length,
    );
    const created = await tests.createQuestion(sectionId, data);
    return toQuestionDto(created);
  }

  /**
   * Edit a persisted Question (optionally replacing its Options) (Req 5.2). Only
   * the supplied fields are validated and patched; a supplied Option set must
   * still satisfy the ≥2 Options / ≥1 correct bounds (Req 4.1, 4.2, 4.4).
   */
  async function editQuestion(
    questionId: string,
    input: EditQuestionInput,
  ): Promise<QuestionDto> {
    const fields: ApiErrorFieldDto[] = [];
    const update: UpdateQuestionData = {};

    let text: string | undefined;
    if (input.text !== undefined) {
      text = normalizeText(input.text);
      collectQuestionText(text, fields);
    }
    if (input.options !== undefined) {
      collectOptions(input.options, fields);
    }
    if (fields.length > 0) {
      throw new ValidationError(VALIDATION_MESSAGE, fields);
    }
    if (text !== undefined) {
      update.text = text;
    }
    if (input.options !== undefined) {
      update.options = normalizeOptions(input.options).map((option, index) => ({
        text: option.text,
        isCorrect: option.isCorrect,
        orderIndex: index,
      }));
    }

    const updated = await tests.updateQuestion(questionId, update);
    return toQuestionDto(updated);
  }

  /**
   * Load a Test with its ordered Sections → Questions → Options for the admin
   * authoring view (Req 5.3). A missing Test yields a not-found error (Req 5.4).
   */
  async function getTestForAdmin(testId: string): Promise<AdminTestDto> {
    const graph = await tests.findTestGraphById(testId);
    if (graph === null) {
      throw new NotFoundError('The requested Test was not found.');
    }
    return toAdminTestDto(graph);
  }

  return {
    createTest,
    editTest,
    addSection,
    editSection,
    addQuestion,
    editQuestion,
    getTestForAdmin,
  };
}

// --- Default wiring -------------------------------------------------------

/**
 * Construct the Test authoring service wired to the real Prisma-backed Test
 * repository. Used by the controller layer in production (mirrors
 * `createDefaultPaymentService` / `createDefaultMaterialService`).
 */
export function createDefaultTestService(): TestService {
  return createTestService({
    tests: {
      createTest: testSeriesRepository.createTest,
      updateTest: testSeriesRepository.updateTest,
      createSection: testSeriesRepository.createSection,
      updateSection: testSeriesRepository.updateSection,
      createQuestion: testSeriesRepository.createQuestion,
      updateQuestion: testSeriesRepository.updateQuestion,
      findTestGraphById: testSeriesRepository.findTestGraphById,
      findSectionGraphById: testSeriesRepository.findSectionGraphById,
      listTests: testSeriesRepository.listTests,
      listPricedSections: testSeriesRepository.listPricedSections,
    },
  });
}
