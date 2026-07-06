// Material controller — search and single-material read (Req 4, 5).
//
// Shapes the HTTP surface of the two public material endpoints:
//
//   - `GET /api/materials/search` — reads the trimmed `q` and optional
//     `categoryId` from the query string, builds the catalog material set, and
//     delegates the matching to the pure `searchMaterials` service. An empty /
//     whitespace-only query returns every material (Req 4.3); an active query
//     and/or Category filter narrows the set (Req 4.1, 4.2, 4.4); no matches
//     yield an empty list (Req 4.5).
//   - `GET /api/materials/:id` — returns the complete metadata for one Study
//     Material, delegating to the material service; a missing material surfaces
//     as a not-found error with no content (Req 5.1, 5.3, 5.4).
//
// The controller holds no business logic: matching lives in `search.service.ts`
// and the single-material read lives in `material.service.ts`.

import type { NextFunction, Request, Response } from 'express';

import { createDefaultMaterialService } from '../services/material.service';
import { searchMaterials } from '../services/search.service';
import { loadCatalog } from './catalog.controller';
import type { SearchMaterialsResponse } from '../types/api.types';

/**
 * Read a query-string value as a single string, coalescing an absent or
 * non-string (for example a repeated) parameter to `undefined` so the pure
 * search service applies the corresponding relaxed constraint (Req 4.2, 4.3).
 */
function readQueryParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * `GET /api/materials/search` — return the Study Materials matching the search
 * query and/or Category filter (Req 4.1–4.5). The response carries the matched
 * materials and their count; an empty array signals "no matching materials"
 * (Req 4.5).
 */
export async function searchMaterialsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { materials } = await loadCatalog();
    const matched = searchMaterials(materials, {
      query: readQueryParam(req.query.q),
      categoryId: readQueryParam(req.query.categoryId),
    });
    const body: SearchMaterialsResponse = {
      materials: matched,
      matched: matched.length,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/materials/:id` — return the complete metadata for one Study
 * Material (Req 5.1, 5.3). A missing material yields a not-found error with no
 * content (Req 5.4).
 *
 * The read is entitlement-aware: the resolved Learner id (attached to
 * `req.auth` by `auth.middleware`, `undefined` for an unauthenticated caller)
 * is passed into the service so a Paid Material's content is gated on a Payment
 * Entitlement — an unentitled/unauthenticated caller receives a
 * `403 PAYMENT_REQUIRED` with no content. Free Materials are unaffected
 * (Req 12.2, 12.3).
 */
export async function getMaterialHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const material = await createDefaultMaterialService().getMaterial(
      req.params.id,
      req.auth.userId,
    );
    // Return the material unwrapped (fields at top level) as documented for
    // this endpoint, so the Frontend Project consumes it directly.
    res.status(200).json(material);
  } catch (error) {
    next(error);
  }
}
