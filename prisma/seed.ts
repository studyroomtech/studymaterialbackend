// Prisma database seed.
//
// Creates the initial Category Types required by the Platform — a Subject
// Category Type and a Job Category Type (Req 2.1) — so that a freshly
// provisioned database starts with the two required dimensions of
// classification available for tagging Study Materials.
//
// The seed is idempotent: it upserts each Category Type by its unique `name`,
// so running it repeatedly (for example on every deploy) neither creates
// duplicates nor fails once the records already exist. `CategoryType.name` is
// unique in the schema, which makes the upsert-by-name safe.

import { PrismaClient } from '@prisma/client';
import { INITIAL_CATEGORY_TYPE_NAMES } from '../src/constants/categoryTypes.constant';

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

async function main(): Promise<void> {
  await seedCategoryTypes();
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
