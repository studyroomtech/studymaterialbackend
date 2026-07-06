// Types for the pure catalog-building service (Req 1.15: type declarations
// live only in `*.types.ts`).
//
// These describe the inputs consumed by the pure DTO-building logic in
// `catalog.service.ts`, which assembles the Material Catalog structure returned
// by `GET /api/catalog` (Req 2.5, 3.1, 3.10). The pure builder takes the
// supported Category Types (with their Categories) and the raw Study Materials
// together with their Tag assignments, and produces a `CatalogResponse` in
// which every material carries an entry for every supported Category Type
// (empty array when the material has no Tags under that type).

import type { CategoryTypeDto } from '../types/domain.types';

/**
 * A single Tag assignment on a Study Material, referencing the Category it was
 * assigned under by id (Req 2.3). The Category's Category Type and display name
 * are resolved from the supported Category Types during catalog building.
 */
export interface CatalogTagAssignment {
  categoryId: string;
}

/**
 * A raw Study Material together with its Tag assignments, as supplied to the
 * pure catalog builder before its `tagsByCategoryType` map is computed.
 *
 * The optional file-metadata and price fields are carried through unchanged
 * onto the resulting `MaterialDto` when present; in Phase 1 the price fields
 * remain unset (all materials are Free Materials).
 */
export interface CatalogMaterialInput {
  id: string;
  title: string;
  description: string;
  tags: readonly CatalogTagAssignment[];
  fileName?: string;
  contentType?: string;
  fileSizeBytes?: number;
  priceAmount?: number | null;
  currency?: string;
  isPaid?: boolean;
}

/**
 * The complete raw input to the pure catalog builder: the supported Category
 * Types (each with its ordered Categories) and the raw Study Materials with
 * their Tag assignments (Req 2.5, 3.1).
 */
export interface CatalogInput {
  categoryTypes: readonly CategoryTypeDto[];
  materials: readonly CatalogMaterialInput[];
}
