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
 * Count unique downloaders per Study Material (repeat downloads and per-file
 * downloads by the same Learner count once). Restricted to `studyMaterialIds`
 * when given; materials with no downloads are absent from the map.
 */
export async function countDownloadersByMaterial(
  studyMaterialIds?: string[]
): Promise<Map<string, number>> {
  // ponytail: groupBy returns one row per distinct (material, user) pair and we
  // tally in JS; fine for thousands of rows. If Download grows large, switch to
  // a denormalized `downloadCount` on StudyMaterial (like ratingCount).
  const pairs = await getPrismaClient().download.groupBy({
    by: ['studyMaterialId', 'userId'],
    where:
      studyMaterialIds === undefined
        ? undefined
        : { studyMaterialId: { in: studyMaterialIds } },
  });
  const counts = new Map<string, number>();
  for (const { studyMaterialId } of pairs) {
    counts.set(studyMaterialId, (counts.get(studyMaterialId) ?? 0) + 1);
  }
  return counts;
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
