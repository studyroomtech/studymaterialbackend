// Catalog controller (Req 3.1, 3.10, 2.5).
//
// Shapes the HTTP surface of `GET /api/catalog`: it loads the supported
// Category Types (with their Categories) and every Study Material (with its
// resolved Tags) from the repository layer, hands them to the pure
// `buildCatalog` service to assemble the Material Catalog DTO — in which every
// material carries an entry for every supported Category Type (empty array when
// it has no Tags under that type, Req 2.5) — and returns it as JSON.
//
// The controller performs no business logic of its own: catalog shaping lives
// in `catalog.service.ts` and data access lives in the repositories. The shared
// `loadCatalog` helper is reused by the search controller so the search set is
// built from exactly the same catalog shape.

import type { NextFunction, Request, Response } from 'express';

import { listCategoryTypesWithCategories } from '../repositories/categoryType.repository';
import { listMaterials } from '../repositories/material.repository';
import { buildCatalog } from '../services/catalog.service';
import type {
  CatalogInput,
  CatalogMaterialInput,
} from '../services/catalog.service.types';
import type { CategoryTypeWithCategories } from '../repositories/categoryType.repository.types';
import type { MaterialWithTags } from '../repositories/material.repository.types';
import type { CategoryTypeDto } from '../types/domain.types';
import type { CatalogResponse } from '../types/api.types';

/**
 * Map a persisted Category Type (with its Categories) to the `CategoryTypeDto`
 * echoed verbatim in the catalog, preserving Category order (Req 3.2).
 */
function toCategoryTypeDto(
  categoryType: CategoryTypeWithCategories,
): CategoryTypeDto {
  return {
    id: categoryType.id,
    name: categoryType.name,
    categories: categoryType.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      categoryTypeId: tag.categoryTypeId,
    })),
  };
}

/**
 * Map a persisted Study Material (with its resolved Tags) to the raw catalog
 * input consumed by the pure builder. Only the Category id of each Tag is
 * carried through; the builder resolves the Category Type and display name from
 * the supported Category Types (Req 2.5).
 */
function toCatalogMaterialInput(
  material: MaterialWithTags,
): CatalogMaterialInput {
  return {
    id: material.id,
    title: material.title,
    description: material.description,
    tags: material.materialTags.map((materialTag) => ({
      categoryId: materialTag.tagId,
    })),
  };
}

/**
 * Load the supported Category Types and Study Materials from the repositories
 * and assemble the Material Catalog DTO via the pure `buildCatalog` service.
 * Shared by `getCatalog` and the search controller so both operate on an
 * identical catalog shape (Req 2.5, 3.1).
 */
export async function loadCatalog(): Promise<CatalogResponse> {
  const [categoryTypes, materials] = await Promise.all([
    listCategoryTypesWithCategories(),
    listMaterials(),
  ]);

  const input: CatalogInput = {
    categoryTypes: categoryTypes.map(toCategoryTypeDto),
    materials: materials.map(toCatalogMaterialInput),
  };

  return buildCatalog(input);
}

/**
 * `GET /api/catalog` — return the Material Catalog structure (Req 3.1, 3.10,
 * 2.5). Any failure is forwarded to the central error handler.
 */
export async function getCatalog(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const catalog = await loadCatalog();
    res.status(200).json(catalog);
  } catch (error) {
    next(error);
  }
}
