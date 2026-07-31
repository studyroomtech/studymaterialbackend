// Prisma database seed.
//
// Creates the initial Category Types required by the Platform — a Subject
// Category Type and a Job Category Type (Req 2.1) — so that a freshly
// provisioned database starts with the two required dimensions of
// classification available for tagging Study Materials.
//
// It also seeds one free Sectional Timing Test so the Sequential Sectional
// Timing flow is runnable end to end without authoring a Test through the admin
// UI first. Its Sections use deliberately short Time Limits so a reviewer can
// watch a Section expire and the next one open without waiting.
//
// The seed is idempotent: Category Types upsert by their unique `name`, and the
// demo Test is skipped when a Test with the same title already exists, so
// running it repeatedly (for example on every deploy) neither creates
// duplicates nor fails.

import { PrismaClient } from '@prisma/client';
import { INITIAL_CATEGORY_TYPE_NAMES } from '../src/constants/categoryTypes.constant';
import { DEMO_SECTIONAL_TEST } from '../src/constants/seed.constant';

const prisma = new PrismaClient();

async function seedCategoryTypes(): Promise<void> {
  for (const name of INITIAL_CATEGORY_TYPE_NAMES) {
    const categoryType = await prisma.categoryType.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    console.log(`Seeded Category Type "${categoryType.name}" (${categoryType.id})`);
  }
}

/**
 * Seed the free Sequential Sectional Timing demo Test with its Sections,
 * Questions, and Options. `Test.title` is not unique in the schema, so
 * idempotency is achieved by skipping the insert when a Test with this title is
 * already present rather than by upserting.
 */
async function seedDemoSectionalTest(): Promise<void> {
  const existing = await prisma.test.findFirst({
    where: { title: DEMO_SECTIONAL_TEST.title },
    select: { id: true },
  });
  if (existing !== null) {
    console.log(
      `Demo Test "${DEMO_SECTIONAL_TEST.title}" already present (${existing.id}) — skipped`,
    );
    return;
  }

  const test = await prisma.test.create({
    data: {
      title: DEMO_SECTIONAL_TEST.title,
      timingMode: 'sectional',
      timeLimitSeconds: DEMO_SECTIONAL_TEST.timeLimitSeconds,
      // Free: a null Price amount means no Payment Entitlement is required, so
      // any signed-in Learner can start it immediately.
      priceAmount: null,
      sections: {
        create: DEMO_SECTIONAL_TEST.sections.map((section, sectionIndex) => ({
          title: section.title,
          orderIndex: sectionIndex,
          timeLimitSeconds: section.timeLimitSeconds,
          correctMarkCenti: DEMO_SECTIONAL_TEST.correctMarkCenti,
          negativeMarkCenti: DEMO_SECTIONAL_TEST.negativeMarkCenti,
          questions: {
            create: section.questions.map((question, questionIndex) => ({
              text: question.text,
              orderIndex: questionIndex,
              options: {
                create: question.options.map((option, optionIndex) => ({
                  text: option.text,
                  isCorrect: option.isCorrect,
                  orderIndex: optionIndex,
                })),
              },
            })),
          },
        })),
      },
    },
    select: { id: true, title: true },
  });

  console.log(`Seeded demo Test "${test.title}" (${test.id})`);
}

async function main(): Promise<void> {
  await seedCategoryTypes();
  await seedDemoSectionalTest();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Database seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
