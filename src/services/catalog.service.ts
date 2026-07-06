// Pure catalog-building logic for the Material Catalog (Req 2.5, 3.1, 3.10).
//
// This module contains only pure, side-effect-free functions: given the
// supported Category Types (with their Categories) and the raw Study Materials
// with their Tag assignments, it produces the `CatalogResponse` returned by
// `GET /api/catalog`. It performs no I/O and holds no state, so the DTO-shaping
// rules can be reasoned about and property-tested in isolation from the
// HTTP/persistence layers. Data access (loading Category Types and materials)
// is the responsibility of the repository layer, which supplies the inputs.
//
// Catalog shaping rules:
//   - The response echoes the supported Category Types verbatim (Req 3.1, 3.2).
//   - For each Study Material, `tagsByCategoryType` contains an entry for
//     EVERY supported Category Type key. The list under a Category Type key is
//     exactly the Tags the material carries under that type, in the order the
//     Categories are defined within the type; a material with no Tags under a
//     type maps to an empty array (Req 2.5).
//   - A Tag whose Category does not belong to any supported Category Type is
//     ignored, since it cannot be surfaced under a supported type.

import type {
  CategoryTypeDto,
  MaterialDto,
  TagDto,
  TagsByCategoryType,
} from '../types/domain.types';
import type { CatalogResponse } from '../types/api.types';
import type {
  CatalogInput,
  CatalogMaterialInput,
  CatalogTagAssignment,
} from './catalog.service.types';

/**
 * Build the `tagsByCategoryType` map for a single Study Material.
 *
 * Every supported Category Type id appears as a key. The value is the ordered
 * list of Tags the material carries under that Category Type — derived from the
 * Category Type's own Category ordering so the output is deterministic
 * regardless of the order the raw Tag assignments are supplied in. A Category
 * Type under which the material has no Tags maps to an empty array (Req 2.5).
 */
export function buildTagsByCategoryType(
  categoryTypes: readonly CategoryTypeDto[],
  tags: readonly CatalogTagAssignment[],
): TagsByCategoryType {
  const taggedCategoryIds = new Set(tags.map((tag) => tag.categoryId));
  const result: TagsByCategoryType = {};

  for (const categoryType of categoryTypes) {
    const entries: TagDto[] = categoryType.categories
      .filter((category) => taggedCategoryIds.has(category.id))
      .map((category) => ({ categoryId: category.id, name: category.name }));
    result[categoryType.id] = entries;
  }

  return result;
}

/**
 * Build the `MaterialDto` for a single raw Study Material, computing its
 * `tagsByCategoryType` map against the supported Category Types and carrying
 * through any present file-metadata and price fields unchanged (Req 2.5, 3.1).
 */
export function buildMaterialDto(
  categoryTypes: readonly CategoryTypeDto[],
  material: CatalogMaterialInput,
): MaterialDto {
  const dto: MaterialDto = {
    id: material.id,
    title: material.title,
    description: material.description,
    tagsByCategoryType: buildTagsByCategoryType(categoryTypes, material.tags),
  };

  if (material.fileName !== undefined) {
    dto.fileName = material.fileName;
  }
  if (material.contentType !== undefined) {
    dto.contentType = material.contentType;
  }
  if (material.fileSizeBytes !== undefined) {
    dto.fileSizeBytes = material.fileSizeBytes;
  }
  if (material.priceAmount !== undefined) {
    dto.priceAmount = material.priceAmount;
  }
  if (material.currency !== undefined) {
    dto.currency = material.currency;
  }
  if (material.isPaid !== undefined) {
    dto.isPaid = material.isPaid;
  }

  return dto;
}

/**
 * Assemble the full Material Catalog response from the supported Category Types
 * and the raw Study Materials with their Tag assignments (Req 2.5, 3.1, 3.10).
 *
 * The Category Types are echoed as-is; each material is shaped so that its
 * `tagsByCategoryType` map carries an entry for every supported Category Type
 * (empty array when the material has no Tags under that type). Material order is
 * preserved from the input.
 */
export function buildCatalog(input: CatalogInput): CatalogResponse {
  return {
    categoryTypes: [...input.categoryTypes],
    materials: input.materials.map((material) =>
      buildMaterialDto(input.categoryTypes, material),
    ),
  };
}
