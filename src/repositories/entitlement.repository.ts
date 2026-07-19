// Payment Entitlement repository (Req 12.2, 12.3, 12.8, 12.11).
//
// Wraps Prisma access to the `Entitlement` table. A successful Payment grants
// an Entitlement for `(userId, studyMaterialId)`, upserted so a duplicate
// confirmation (client `verify` plus webhook) creates no second row — the
// schema's `@@unique([userId, studyMaterialId])` makes the grant idempotent
// (Req 12.8, 12.19). The entitlement gate resolves the Entitlement for a
// `(userId, materialId)` pair to decide whether a Paid Material's content may
// be served (Req 12.2, 12.3).

import type { Entitlement } from '@prisma/client';

import { getPrismaClient } from './prismaClient';
import type {
  GrantEntitlementInput,
  GrantProductEntitlementInput,
} from './entitlement.repository.types';

/**
 * Grant a Payment Entitlement for `(userId, studyMaterialId)`, idempotently
 * (Req 12.8, 12.11, 12.19). When an Entitlement already exists for the pair the
 * existing row is preserved (no-op update), so a duplicate confirmation never
 * creates a second Entitlement. On first grant the row is created referencing
 * the successful Payment.
 */
export function upsertEntitlement(
  input: GrantEntitlementInput
): Promise<Entitlement> {
  return getPrismaClient().entitlement.upsert({
    where: {
      userId_studyMaterialId: {
        userId: input.userId,
        studyMaterialId: input.studyMaterialId,
      },
    },
    update: {},
    create: {
      userId: input.userId,
      studyMaterialId: input.studyMaterialId,
      paymentId: input.paymentId,
    },
  });
}

/**
 * Find the Payment Entitlement for a `(userId, studyMaterialId)` pair, or
 * `null` when none exists. Backs the entitlement gate that decides whether a
 * Paid Material's view content / download presigning may proceed (Req 12.2,
 * 12.3).
 */
export function findEntitlement(
  userId: string,
  studyMaterialId: string
): Promise<Entitlement | null> {
  return getPrismaClient().entitlement.findUnique({
    where: {
      userId_studyMaterialId: { userId, studyMaterialId },
    },
  });
}

/**
 * List the Study Material ids the given Learner is entitled to. Backs the
 * entitlement-aware Paid Materials listing so already-purchased materials show
 * View/Download instead of Buy (Req 12.3).
 */
export async function listEntitledMaterialIds(
  userId: string
): Promise<string[]> {
  const rows = await getPrismaClient().entitlement.findMany({
    where: { userId, studyMaterialId: { not: null } },
    select: { studyMaterialId: true },
  });
  return rows.flatMap((row) =>
    row.studyMaterialId === null ? [] : [row.studyMaterialId]
  );
}

/**
 * Grant a Payment Entitlement for a covered product — a Study Material, a Test,
 * or a Section — idempotently (Req 7.2, 7.8). Exactly one of
 * `studyMaterialId`/`testId`/`sectionId` is written according to
 * `input.product.type`; the remaining two stay null. The grant is upserted
 * against the matching composite unique index
 * (`@@unique([userId, studyMaterialId])`/`@@unique([userId, testId])`/
 * `@@unique([userId, sectionId])`), so a duplicate confirmation (client
 * `verify` plus webhook) preserves the existing row and never creates a second
 * Entitlement for the same `(userId, product)` pair (Req 7.8).
 */
export function upsertProductEntitlement(
  input: GrantProductEntitlementInput
): Promise<Entitlement> {
  const { userId, product, paymentId } = input;
  const prisma = getPrismaClient();
  switch (product.type) {
    case 'study_material':
      return prisma.entitlement.upsert({
        where: {
          userId_studyMaterialId: { userId, studyMaterialId: product.id },
        },
        update: {},
        create: { userId, studyMaterialId: product.id, paymentId },
      });
    case 'test':
      return prisma.entitlement.upsert({
        where: { userId_testId: { userId, testId: product.id } },
        update: {},
        create: { userId, testId: product.id, paymentId },
      });
    case 'section':
      return prisma.entitlement.upsert({
        where: { userId_sectionId: { userId, sectionId: product.id } },
        update: {},
        create: { userId, sectionId: product.id, paymentId },
      });
    default: {
      const exhaustive: never = product.type;
      throw new Error(`Unsupported entitlement product type: ${exhaustive}`);
    }
  }
}

/**
 * List the Test ids the given Learner holds a Test Entitlement for. Backs the
 * access gate: a Test Entitlement permits attempting every Section of that Test
 * (Req 8.1).
 */
export async function listEntitledTestIds(userId: string): Promise<string[]> {
  const rows = await getPrismaClient().entitlement.findMany({
    where: { userId, testId: { not: null } },
    select: { testId: true },
  });
  return rows.flatMap((row) => (row.testId === null ? [] : [row.testId]));
}

/**
 * List the Section ids the given Learner holds a Section Entitlement for. Backs
 * the access gate: a Section Entitlement permits attempting only that exact
 * Section and never a sibling Section (Req 8.2).
 */
export async function listEntitledSectionIds(
  userId: string
): Promise<string[]> {
  const rows = await getPrismaClient().entitlement.findMany({
    where: { userId, sectionId: { not: null } },
    select: { sectionId: true },
  });
  return rows.flatMap((row) => (row.sectionId === null ? [] : [row.sectionId]));
}
