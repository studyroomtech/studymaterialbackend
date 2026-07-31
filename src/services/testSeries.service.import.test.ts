// Whole-Test JSON import — `importTest` on the Test authoring service.
//
// The import configures a complete Test (Sections → Questions → Options) from
// one document. Two properties matter most and are the focus here:
//
//   1. Nothing is written unless the entire document is valid, so a rejected
//      import can never leave a half-built Test for an admin to discover.
//   2. Every problem in the document is reported at once, each labelled with
//      its position (`sections.1.questions.0.options.1.text`), so a large
//      payload does not have to be fixed one round-trip at a time.
//
// The repository is a recording fake, which also lets the tests assert what
// would have been persisted (order indices, centi-mark conversion) without a
// database.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { createTestService } from './testSeries.service';
import { importTestBodySchema } from '../routes/adminTestSeries.routes';
import { ValidationError } from '../utils/errors';
import type { ApiErrorFieldDto } from '../types/api.types';
import type { TestService } from './testSeries.service.types';
import type {
  CreateTestGraphData,
  TestRepository,
} from '../repositories/testSeries.repository.types';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

// --- Recording fake repository -------------------------------------------

let graphCalls: CreateTestGraphData[] = [];

/**
 * Echo the requested graph back as if it had been persisted, assigning
 * predictable ids so assertions can address entities by position.
 */
function persistGraph(input: CreateTestGraphData) {
  graphCalls.push(input);
  return Promise.resolve({
    id: 'test-1',
    title: input.title,
    timingMode: input.timingMode,
    timeLimitSeconds: input.timeLimitSeconds,
    priceAmount: input.priceAmount ?? null,
    currency: input.currency ?? 'INR',
    createdAt: EPOCH,
    updatedAt: EPOCH,
    sections: input.sections.map((section, sectionIndex) => ({
      ...section,
      id: `section-${sectionIndex}`,
      testId: 'test-1',
      priceAmount: section.priceAmount ?? null,
      currency: section.currency ?? 'INR',
      createdAt: EPOCH,
      updatedAt: EPOCH,
      questions: section.questions.map((question, questionIndex) => ({
        ...question,
        id: `question-${sectionIndex}-${questionIndex}`,
        sectionId: `section-${sectionIndex}`,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        options: question.options.map((option, optionIndex) => ({
          ...option,
          id: `option-${sectionIndex}-${questionIndex}-${optionIndex}`,
          questionId: `question-${sectionIndex}-${questionIndex}`,
        })),
      })),
    })),
  } as never);
}

function unusedRepositoryMethod(): never {
  throw new Error('The import must not reach this repository method.');
}

function buildService(): TestService {
  graphCalls = [];
  return createTestService({
    tests: {
      createTestGraph: persistGraph,
      createTest: unusedRepositoryMethod,
      updateTest: unusedRepositoryMethod,
      createSection: unusedRepositoryMethod,
      updateSection: unusedRepositoryMethod,
      createQuestion: unusedRepositoryMethod,
      updateQuestion: unusedRepositoryMethod,
      findTestGraphById: unusedRepositoryMethod,
      findSectionGraphById: unusedRepositoryMethod,
      listTests: unusedRepositoryMethod,
      listPricedSections: unusedRepositoryMethod,
    } as unknown as TestRepository,
  });
}

// --- Payload builders -----------------------------------------------------

function makeQuestion(text: string) {
  return {
    text,
    options: [
      { text: 'Correct answer', isCorrect: true },
      { text: 'Wrong answer', isCorrect: false },
    ],
  };
}

function makeSection(title: string, questionCount = 1) {
  return {
    title,
    timeLimitSeconds: 120,
    correctMark: 1,
    negativeMark: 0.25,
    questions: Array.from({ length: questionCount }, (_unused, index) =>
      makeQuestion(`${title} question ${index + 1}`),
    ),
  };
}

function makeImport(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Imported Mock Test',
    timingMode: 'sectional' as const,
    timeLimitSeconds: 360,
    sections: [
      makeSection('Quantitative Aptitude'),
      makeSection('Logical Reasoning', 2),
      makeSection('Verbal Ability'),
    ],
    ...overrides,
  };
}

/** Run an import expected to fail and return the per-field errors it reported. */
async function importErrors(
  service: TestService,
  payload: ReturnType<typeof makeImport>,
): Promise<ApiErrorFieldDto[]> {
  try {
    await service.importTest(payload as never);
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.fields ?? [];
    }
    throw error;
  }
  throw new Error('The import was expected to be rejected but succeeded.');
}

/** The field paths a rejected import complained about. */
async function importFieldErrors(
  service: TestService,
  payload: ReturnType<typeof makeImport>,
): Promise<string[]> {
  return (await importErrors(service, payload)).map((field) => field.field);
}

/** The reason reported against a single field path. */
async function importReasonFor(
  service: TestService,
  payload: ReturnType<typeof makeImport>,
  field: string,
): Promise<string | undefined> {
  const errors = await importErrors(service, payload);
  return errors.find((entry) => entry.field === field)?.reason;
}

describe('importTest', () => {
  let service: TestService;

  beforeEach(() => {
    service = buildService();
  });

  describe('a valid document', () => {
    it('returns the whole authoring graph', async () => {
      const test = await service.importTest(makeImport());

      expect(test.id).toBe('test-1');
      expect(test.sections).toHaveLength(3);
      expect(test.sections[1].questions).toHaveLength(2);
      expect(test.sections[0].questions[0].options).toHaveLength(2);
    });

    it('persists the Test in a single call so the import is atomic', async () => {
      await service.importTest(makeImport());

      expect(graphCalls).toHaveLength(1);
    });

    it('numbers the Sections by their position in the document', async () => {
      const test = await service.importTest(makeImport());

      // Section order is what Sequential Sectional Timing activates on, so the
      // document's order has to survive into `orderIndex` exactly.
      expect(test.sections.map((section) => section.title)).toEqual([
        'Quantitative Aptitude',
        'Logical Reasoning',
        'Verbal Ability',
      ]);
      expect(test.sections.map((section) => section.orderIndex)).toEqual([
        0, 1, 2,
      ]);
    });

    it('numbers Questions and Options within each Section', async () => {
      await service.importTest(makeImport());

      const [section] = graphCalls[0].sections.slice(1);
      expect(section.questions.map((question) => question.orderIndex)).toEqual([
        0, 1,
      ]);
      expect(
        section.questions[0].options.map((option) => option.orderIndex),
      ).toEqual([0, 1]);
    });

    it('converts decimal marks to integer centi-marks', async () => {
      await service.importTest(makeImport());

      expect(graphCalls[0].sections[0].correctMarkCenti).toBe(100);
      expect(graphCalls[0].sections[0].negativeMarkCenti).toBe(25);
    });

    it('treats an omitted Price as a free Test', async () => {
      const test = await service.importTest(makeImport());

      expect(test.isFree).toBe(true);
      expect(test.priceAmount).toBeNull();
    });

    it('accepts a priced Test and priced Sections', async () => {
      const sections = makeImport().sections;
      sections[0] = { ...sections[0], priceAmount: 9900 } as never;
      const test = await service.importTest(
        makeImport({ priceAmount: 49900, sections }) as never,
      );

      expect(test.isFree).toBe(false);
      expect(test.priceAmount).toBe(49900);
      expect(test.sections[0].isPriced).toBe(true);
      expect(test.sections[1].isPriced).toBe(false);
    });

    it('trims surrounding whitespace from authored text', async () => {
      const test = await service.importTest(
        makeImport({ title: '  Imported Mock Test  ' }) as never,
      );

      expect(test.title).toBe('Imported Mock Test');
    });

    it('imports an Overall Timing Test just as readily', async () => {
      const test = await service.importTest(
        makeImport({ timingMode: 'overall' }) as never,
      );

      expect(test.timingMode).toBe('overall');
      expect(test.sections).toHaveLength(3);
    });
  });

  describe('a rejected document', () => {
    it('writes nothing at all', async () => {
      await importFieldErrors(service, makeImport({ title: '' }) as never);

      expect(graphCalls).toHaveLength(0);
    });

    it('locates a bad Option by its full path in the document', async () => {
      const sections = makeImport().sections;
      sections[1].questions[0].options[1].text = '';

      const errors = await importFieldErrors(
        service,
        makeImport({ sections }) as never,
      );

      expect(errors).toContain('sections.1.questions.0.options.1.text');
    });

    it('locates a bad Section field by its path', async () => {
      const sections = makeImport().sections;
      sections[2].timeLimitSeconds = 0;

      const errors = await importFieldErrors(
        service,
        makeImport({ sections }) as never,
      );

      expect(errors).toContain('sections.2.timeLimitSeconds');
    });

    it('reports every problem in one response rather than only the first', async () => {
      const sections = makeImport().sections;
      sections[0].title = '';
      sections[1].questions[1].text = '';
      sections[2].questions[0].options[0].isCorrect = false;
      sections[2].questions[0].options[1].isCorrect = false;

      const errors = await importFieldErrors(
        service,
        makeImport({ sections }) as never,
      );

      expect(errors).toEqual(
        expect.arrayContaining([
          'sections.0.title',
          'sections.1.questions.1.text',
          'sections.2.questions.0.options',
        ]),
      );
    });

    it('rejects a Question whose Options are all incorrect', async () => {
      const sections = makeImport().sections;
      sections[0].questions[0].options[0].isCorrect = false;

      const errors = await importFieldErrors(
        service,
        makeImport({ sections }) as never,
      );

      expect(errors).toContain('sections.0.questions.0.options');
    });

    it('rejects a Test with no Sections', async () => {
      const reason = await importReasonFor(
        service,
        makeImport({ sections: [] }) as never,
        'sections',
      );

      expect(reason).toBe('at least 1 Section is required.');
    });

    it('rejects a Section with no Questions', async () => {
      const sections = makeImport().sections;
      sections[1].questions = [];

      const reason = await importReasonFor(
        service,
        makeImport({ sections }) as never,
        'sections.1.questions',
      );

      expect(reason).toBe('at least 1 Question is required.');
    });

    it('rejects more Sections than a single import may carry', async () => {
      const reason = await importReasonFor(
        service,
        makeImport({
          sections: Array.from({ length: 51 }, (_unused, index) =>
            makeSection(`Section ${index}`),
          ),
        }) as never,
        'sections',
      );

      expect(reason).toBe('at most 50 Sections are allowed.');
    });

    it('rejects more Questions than a single Section may carry', async () => {
      const sections = makeImport().sections;
      sections[0].questions = Array.from({ length: 501 }, (_unused, index) =>
        makeQuestion(`Question ${index}`),
      );

      const reason = await importReasonFor(
        service,
        makeImport({ sections }) as never,
        'sections.0.questions',
      );

      expect(reason).toBe('at most 500 Questions are allowed.');
    });

    it('labels a Test-level problem under the test path', async () => {
      const errors = await importFieldErrors(
        service,
        makeImport({ timingMode: 'per-question' }) as never,
      );

      expect(errors).toContain('test.timingMode');
    });

    it('rejects a negative mark', async () => {
      const sections = makeImport().sections;
      sections[0].negativeMark = -1;

      const errors = await importFieldErrors(
        service,
        makeImport({ sections }) as never,
      );

      expect(errors).toContain('sections.0.negativeMark');
    });

    it('rejects a Price in a currency the Platform does not charge in', async () => {
      const errors = await importFieldErrors(
        service,
        makeImport({ priceAmount: 49900, currency: 'USD' }) as never,
      );

      expect(errors).toContain('test.currency');
    });
  });

  // The sample is what an admin copies to write their first import, so it has
  // to stay importable as the rules evolve. Read from disk rather than imported
  // so the file stays outside `rootDir` and out of the compiled output.
  describe('the shipped sample payload', () => {
    const readSample = () =>
      JSON.parse(
        readFileSync(
          join(__dirname, '..', '..', 'samples', 'test-import.sample.json'),
          'utf8',
        ),
      );

    it('satisfies the schema the route enforces', () => {
      // The service validators are authoritative, but a request has to clear
      // the Zod body schema first — so the sample must pass both.
      expect(importTestBodySchema.safeParse(readSample()).success).toBe(true);
    });

    it('imports cleanly', async () => {
      const test = await service.importTest(readSample());

      expect(test.sections).toHaveLength(3);
      expect(test.sections.map((section) => section.orderIndex)).toEqual([
        0, 1, 2,
      ]);
      // Exercises the interesting corners: a priced Section inside a priced
      // Test, and a multiple-correct Question.
      expect(test.isFree).toBe(false);
      expect(test.sections[1].isPriced).toBe(true);
      expect(
        test.sections[0].questions[2].options.filter(
          (option) => option.isCorrect,
        ),
      ).toHaveLength(2);
    });
  });
});
