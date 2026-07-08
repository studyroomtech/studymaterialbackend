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
import type { GrantEntitlementInput } from './entitlement.repository.types';

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
    where: { userId },
    select: { studyMaterialId: true },
  });
  return rows.map((row) => row.studyMaterialId);
}
