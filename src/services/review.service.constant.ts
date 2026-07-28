// Constant values for the Review service (Req 1.16: constant values live only
// in `*.constant.ts`).

/** Inclusive rating bounds: a rating is an integer star count in 1–5. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * Inclusive review body length bounds. An empty body is valid (a rating with no
 * written review); the upper bound mirrors the Study Material description bound.
 */
export const REVIEW_BODY_MIN_LENGTH = 0;
export const REVIEW_BODY_MAX_LENGTH = 2000;

/** Default and maximum page size for listing a material's reviews. */
export const REVIEWS_DEFAULT_LIMIT = 50;
export const REVIEWS_MAX_LIMIT = 100;
