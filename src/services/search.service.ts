// Pure search/filter matching logic for the Material Catalog (Req 4).
//
// This module contains only pure, side-effect-free functions: given a list of
// Study Materials and a set of criteria, it returns the subset that matches.
// It performs no I/O and holds no state, so the matching rules can be reasoned
// about and property-tested in isolation from the HTTP/persistence layers.
//
// Matching rules:
//   - A search query matches a material when the query, after trimming leading
//     and trailing whitespace, is a case-insensitive substring of the
//     material's title OR of any of its Tag names (Req 4.1).
//   - An empty or whitespace-only query matches every material (Req 4.3).
//   - A Category filter matches a material when the material is tagged with the
//     selected Category (Req 4.2).
//   - When a query and a Category filter are both active, a material must
//     satisfy both — the intersection (Req 4.4).
//   - Materials that match nothing are simply absent from the result, yielding
//     an empty list when there are no matches (Req 4.5).

import type { MaterialDto } from '../types/domain.types';
import type { SearchCriteria } from './search.service.types';

/**
 * Normalize a raw query for matching: coalesce null/undefined to an empty
 * string, trim surrounding whitespace, and lower-case it (Req 4.1, 4.3).
 */
export function normalizeQuery(query: string | null | undefined): string {
  return (query ?? '').trim().toLowerCase();
}

/**
 * Whether a query is "blank" — empty or whitespace-only after trimming. A blank
 * query imposes no search constraint and matches every material (Req 4.3).
 */
export function isBlankQuery(query: string | null | undefined): boolean {
  return normalizeQuery(query).length === 0;
}

/**
 * Collect every Tag name assigned to a material across all Category Types.
 */
function tagNames(material: MaterialDto): string[] {
  return Object.values(material.tagsByCategoryType)
    .flat()
    .map((tag) => tag.name);
}

/**
 * Whether a material satisfies the search query. A blank query matches every
 * material (Req 4.3); otherwise the trimmed, lower-cased query must be a
 * substring of the title or of any Tag name (Req 4.1).
 */
export function matchesQuery(
  material: MaterialDto,
  query: string | null | undefined,
): boolean {
  const normalized = normalizeQuery(query);
  if (normalized.length === 0) {
    return true;
  }
  const haystacks = [material.title, ...tagNames(material)];
  return haystacks.some((value) => value.toLowerCase().includes(normalized));
}

/**
 * Whether a material satisfies the Category filter. An absent/empty
 * `categoryId` imposes no filter and matches every material; otherwise the
 * material must carry a Tag for the selected Category (Req 4.2).
 */
export function matchesCategory(
  material: MaterialDto,
  categoryId: string | null | undefined,
): boolean {
  if (categoryId === null || categoryId === undefined || categoryId === '') {
    return true;
  }
  return Object.values(material.tagsByCategoryType).some((tags) =>
    tags.some((tag) => tag.categoryId === categoryId),
  );
}

/**
 * Return only the materials whose title or any Tag name matches the query
 * (Req 4.1, 4.3).
 */
export function filterByQuery(
  materials: readonly MaterialDto[],
  query: string | null | undefined,
): MaterialDto[] {
  return materials.filter((material) => matchesQuery(material, query));
}

/**
 * Return only the materials tagged with the selected Category (Req 4.2).
 */
export function filterByCategory(
  materials: readonly MaterialDto[],
  categoryId: string | null | undefined,
): MaterialDto[] {
  return materials.filter((material) => matchesCategory(material, categoryId));
}

/**
 * Apply the full search/filter criteria to a collection of materials, returning
 * the materials that satisfy both the query and the Category filter — the
 * intersection when both are active (Req 4.4). A blank query and/or absent
 * Category filter relax the corresponding constraint (Req 4.2, 4.3), and no
 * matches yield an empty list (Req 4.5).
 */
export function searchMaterials(
  materials: readonly MaterialDto[],
  criteria: SearchCriteria,
): MaterialDto[] {
  return materials.filter(
    (material) =>
      matchesQuery(material, criteria.query) &&
      matchesCategory(material, criteria.categoryId),
  );
}
