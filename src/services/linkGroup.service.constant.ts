// Constant values for the Link_Manager service (Req 1.16: constant values live
// only in `*.constant.ts`).
//
// These bound a single link operation: the maximum number of existing materials
// that may be referenced, and the minimum number of distinct materials a link
// must reference (counting the subject) for a group to exist.

/**
 * Maximum number of existing materials that may be referenced in a single link
 * operation. Exceeding it is a `VALIDATION_ERROR` that names this maximum
 * (Req 1.1, 1.6).
 */
export const LINK_GROUP_MAX_REFERENCES = 100;

/**
 * Minimum number of distinct materials a link must reference, counting the
 * subject. Fewer than this is a `VALIDATION_ERROR` (Req 2.3, 11.2), and a group
 * that would drop below this count is dissolved (Req 2.5, 3.4).
 */
export const LINK_GROUP_MIN_DISTINCT = 2;
