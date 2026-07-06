// Types for the pure search/filter service (Req 1.15: type declarations live
// only in `*.types.ts`).
//
// These describe the inputs to the pure matching logic in `search.service.ts`,
// which selects Study Materials by a case-insensitive substring query over the
// title and Tag names and/or a Category filter (Req 4.1–4.4).

/**
 * The search/filter criteria applied to a collection of Study Materials.
 *
 * - `query`: the raw learner-supplied search string. It is trimmed of leading
 *   and trailing whitespace and matched case-insensitively; an absent, empty,
 *   or whitespace-only value matches every material (Req 4.1, 4.3).
 * - `categoryId`: an optional Category filter. When present, only materials
 *   tagged with that Category are retained; an absent/empty value applies no
 *   Category filter (Req 4.2). When both fields are active, a material must
 *   satisfy both — the intersection (Req 4.4).
 */
export interface SearchCriteria {
  query?: string | null;
  categoryId?: string | null;
}
