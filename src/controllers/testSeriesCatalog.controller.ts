// Test catalog controller — Home Page Test Series and Sectional Tests listings
// (Req 6.1–6.4).
//
// Shapes the HTTP surface of `GET /api/tests`: it loads the Test Series list
// (every Test, including free Tests) and the Sectional Tests list (only Sections
// whose Price amount is present and positive) from the pure
// `createDefaultTestListingService()` and returns them as a single JSON body
// `{ testSeries, sectionalTests }`. Both lists are surfaced in the deterministic
// `createdAt asc, id asc` order the service preserves, so the ordering is
// identical across repeated loads of the same data (Req 6.4).
//
// The controller holds no business logic: the listing shaping (price
// classification, free indicator, ordering) lives in
// `testSeriesListing.service.ts`. Any failure is forwarded to the central error
// handler via `next(error)`.

import type { NextFunction, Request, Response } from 'express';

import { createDefaultTestListingService } from '../services/testSeriesListing.service';
import type { TestListingsResponse } from '../types/api.types';

/**
 * `GET /api/tests` — return the Test Series and Sectional Tests listings for the
 * Home Page (Req 6.1–6.4). The two listing reads are issued in parallel and
 * returned unwrapped as `{ testSeries, sectionalTests }`. Any failure is
 * forwarded to the central error handler.
 */
export async function getTestListingsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const service = createDefaultTestListingService();
    // Resolve the caller's identity (from their Access Token) so the service can
    // surface per-product ownership via `isEntitled`; an unauthenticated caller
    // has no `userId`, so every product resolves to `isEntitled = false`
    // (Req 2.1, 2.2, 2.3).
    const userId = req.auth.userId;
    const [testSeries, sectionalTests] = await Promise.all([
      service.listTestSeries(userId),
      service.listSectionalTests(userId),
    ]);
    const body: TestListingsResponse = { testSeries, sectionalTests };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}
