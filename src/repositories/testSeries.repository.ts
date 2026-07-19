// Test Series repository (Req 2.6, 3.6, 5.1, 5.2, 5.4, 6.4).
//
// Wraps Prisma access to the Test authoring graph (Test → Section → Question →
// Option) and the listing reads. Marks are persisted as integer centi-marks and
// money as integer paise exactly as supplied — all serialization (decimal
// marks, ISO timestamps, price shaping) is deferred to the service/DTO layer.
//
// Per-Section persistence is all-or-nothing: adding or editing a Section writes
// the Section together with its nested Questions/Options in a single
// transaction, so a Section is never partially persisted and editing one
// Section never disturbs another (Req 5.1, 5.2, 5.4, 5.5). Reads return the
// ordered graph (Sections/Questions/Options by `orderIndex`) so the
// Admin-defined order is preserved across views (Req 2.6, 3.6).

import type { Test } from '@prisma/client';

import { getPrismaClient } from './prismaClient';
import type {
  CreateQuestionData,
  CreateSectionData,
  CreateTestData,
  QuestionData,
  QuestionWithOptions,
  SectionGraph,
  SectionWithQuestions,
  SectionWithTest,
  TestGraph,
  UpdateQuestionData,
  UpdateSectionData,
  UpdateTestData,
} from './testSeries.repository.types';

// Include shapes that resolve each level of the graph in the Admin-defined
// order (`orderIndex` ascending), so every read preserves ordering (Req 2.6, 3.6).
const QUESTION_INCLUDE = {
  options: { orderBy: { orderIndex: 'asc' } },
} as const;

const SECTION_GRAPH_INCLUDE = {
  questions: {
    orderBy: { orderIndex: 'asc' },
    include: QUESTION_INCLUDE,
  },
} as const;

const TEST_GRAPH_INCLUDE = {
  sections: {
    orderBy: { orderIndex: 'asc' },
    include: SECTION_GRAPH_INCLUDE,
  },
} as const;

// Deterministic total order for listings: creation time, breaking ties by id so
// the order is identical across repeated loads of the same data (Req 6.4).
const LISTING_ORDER = [{ createdAt: 'asc' }, { id: 'asc' }] as const;

/**
 * Map a validated Question (with Options) to a Prisma nested-create payload.
 * Shared by Section create/update and Question create so the nested-write shape
 * stays in one place.
 */
function nestedQuestionCreate(question: QuestionData) {
  return {
    text: question.text,
    orderIndex: question.orderIndex,
    options: {
      create: question.options.map((option) => ({
        text: option.text,
        isCorrect: option.isCorrect,
        orderIndex: option.orderIndex,
      })),
    },
  };
}

/**
 * Persist a new Test's authoring metadata and return the created record
 * (Req 2.1–2.4). `currency` is omitted from the write when not supplied so the
 * schema default (INR) applies; `priceAmount` defaults to `null` (free Test).
 */
export function createTest(input: CreateTestData): Promise<Test> {
  return getPrismaClient().test.create({
    data: {
      title: input.title,
      timingMode: input.timingMode,
      timeLimitSeconds: input.timeLimitSeconds,
      priceAmount: input.priceAmount ?? null,
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
    },
  });
}

/**
 * Update a Test's own fields, leaving omitted fields and every Section
 * unchanged (Req 5.5). Returns the updated Test record.
 */
export function updateTest(id: string, input: UpdateTestData): Promise<Test> {
  return getPrismaClient().test.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.timingMode !== undefined
        ? { timingMode: input.timingMode }
        : {}),
      ...(input.timeLimitSeconds !== undefined
        ? { timeLimitSeconds: input.timeLimitSeconds }
        : {}),
      ...(input.priceAmount !== undefined
        ? { priceAmount: input.priceAmount }
        : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
    },
  });
}

/**
 * Persist a Section together with its nested Questions/Options in a single
 * atomic write and return the ordered Section graph (Req 5.1, 5.4). A Prisma
 * nested create is one statement, so the Section and its whole subtree either
 * all persist or none do; other Sections of the Test are untouched.
 */
export function createSection(
  testId: string,
  input: CreateSectionData
): Promise<SectionWithQuestions> {
  return getPrismaClient().section.create({
    data: {
      testId,
      title: input.title,
      orderIndex: input.orderIndex,
      timeLimitSeconds: input.timeLimitSeconds,
      correctMarkCenti: input.correctMarkCenti,
      negativeMarkCenti: input.negativeMarkCenti,
      priceAmount: input.priceAmount ?? null,
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      questions: { create: input.questions.map(nestedQuestionCreate) },
    },
    include: SECTION_GRAPH_INCLUDE,
  });
}

/**
 * Update a Section and, when `questions` is provided, atomically replace its
 * entire Questions/Options subtree (Req 5.2, 5.4). The delete-then-recreate is
 * wrapped in a transaction with the scalar update so the Section is never left
 * partially edited; the cascading `Question → Option` relation removes the old
 * Options. Omitting `questions` updates only the scalar fields, leaving the
 * Questions unchanged. No other Section is altered (Req 5.5).
 */
export function updateSection(
  id: string,
  input: UpdateSectionData
): Promise<SectionWithQuestions> {
  const scalarData = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
    ...(input.timeLimitSeconds !== undefined
      ? { timeLimitSeconds: input.timeLimitSeconds }
      : {}),
    ...(input.correctMarkCenti !== undefined
      ? { correctMarkCenti: input.correctMarkCenti }
      : {}),
    ...(input.negativeMarkCenti !== undefined
      ? { negativeMarkCenti: input.negativeMarkCenti }
      : {}),
    ...(input.priceAmount !== undefined
      ? { priceAmount: input.priceAmount }
      : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
  };
  const { questions } = input;

  return getPrismaClient().$transaction(async (tx) => {
    if (questions !== undefined) {
      await tx.question.deleteMany({ where: { sectionId: id } });
    }
    return tx.section.update({
      where: { id },
      data: {
        ...scalarData,
        ...(questions !== undefined
          ? { questions: { create: questions.map(nestedQuestionCreate) } }
          : {}),
      },
      include: SECTION_GRAPH_INCLUDE,
    });
  });
}

/**
 * Persist a Question with its Options in a single atomic write and return the
 * Question with its ordered Options (Req 4.1, 5.4).
 */
export function createQuestion(
  sectionId: string,
  input: CreateQuestionData
): Promise<QuestionWithOptions> {
  return getPrismaClient().question.create({
    data: {
      sectionId,
      text: input.text,
      orderIndex: input.orderIndex,
      options: {
        create: input.options.map((option) => ({
          text: option.text,
          isCorrect: option.isCorrect,
          orderIndex: option.orderIndex,
        })),
      },
    },
    include: QUESTION_INCLUDE,
  });
}

/**
 * Update a Question and, when `options` is provided, atomically replace its
 * Options (Req 5.2, 5.4). The delete-then-recreate is wrapped in a transaction
 * with the scalar update. Omitting `options` updates only the scalar fields.
 */
export function updateQuestion(
  id: string,
  input: UpdateQuestionData
): Promise<QuestionWithOptions> {
  const scalarData = {
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
  };
  const { options } = input;

  return getPrismaClient().$transaction(async (tx) => {
    if (options !== undefined) {
      await tx.option.deleteMany({ where: { questionId: id } });
    }
    return tx.question.update({
      where: { id },
      data: {
        ...scalarData,
        ...(options !== undefined
          ? {
              options: {
                create: options.map((option) => ({
                  text: option.text,
                  isCorrect: option.isCorrect,
                  orderIndex: option.orderIndex,
                })),
              },
            }
          : {}),
      },
      include: QUESTION_INCLUDE,
    });
  });
}

/**
 * Load a Test with its ordered Sections → Questions → Options, or `null` when
 * none exists so the service layer can return a `NOT_FOUND` without content.
 * Backs the admin authoring view (Req 5.3) and whole-Test attempt start/scoring
 * (the Option `isCorrect` flags supply the Correct Option Set for scoring).
 */
export function findTestGraphById(id: string): Promise<TestGraph | null> {
  return getPrismaClient().test.findUnique({
    where: { id },
    include: TEST_GRAPH_INCLUDE,
  });
}

/**
 * Load a Section with its parent Test and ordered Questions → Options, or
 * `null` when none exists. Backs Section-scoped attempt start/scoring (Req 8.2).
 */
export function findSectionGraphById(
  id: string
): Promise<SectionGraph | null> {
  return getPrismaClient().section.findUnique({
    where: { id },
    include: { test: true, ...SECTION_GRAPH_INCLUDE },
  });
}

/**
 * List every Test (including free Tests) in the deterministic
 * `createdAt asc, id asc` order for the Test Series listing (Req 6.1, 6.4).
 */
export function listTests(): Promise<Test[]> {
  return getPrismaClient().test.findMany({
    orderBy: [...LISTING_ORDER],
  });
}

/**
 * List every Section whose Price amount is present and positive, with its
 * parent Test, in the deterministic `createdAt asc, id asc` order for the
 * Sectional Tests listing (Req 6.1, 6.4). A Section with no/zero Price is not a
 * Sectional Test product and is excluded (Req 3.3, 3.4).
 */
export function listPricedSections(): Promise<SectionWithTest[]> {
  return getPrismaClient().section.findMany({
    where: { priceAmount: { gt: 0 } },
    orderBy: [...LISTING_ORDER],
    include: { test: true },
  });
}


