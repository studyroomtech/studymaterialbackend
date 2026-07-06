// Download Record repository (Req 9.1–9.3).
//
// Wraps Prisma access to the `Download` table. Each successful download is
// persisted as a separate Download Record referencing the Learner's User
// Record and the downloaded Study Material, with the completion timestamp
// (`downloadedAt`, defaulted to now and serialized ISO 8601 per Req 9.2). A
// Learner who downloads multiple times accumulates one record per download
// (Req 9.3).

import type { Download } from '@prisma/client';

import { getPrismaClient } from './prismaClient';

/**
 * Persist a Download Record linking `userId` to `studyMaterialId` at the
 * current time (Req 9.1–9.3). The `downloadedAt` timestamp defaults to now via
 * the schema.
 */
export function createDownload(
  userId: string,
  studyMaterialId: string
): Promise<Download> {
  return getPrismaClient().download.create({
    data: { userId, studyMaterialId },
  });
}

/**
 * List a Learner's Download Records, most recent first.
 */
export function listDownloadsByUser(userId: string): Promise<Download[]> {
  return getPrismaClient().download.findMany({
    where: { userId },
    orderBy: { downloadedAt: 'desc' },
  });
}
