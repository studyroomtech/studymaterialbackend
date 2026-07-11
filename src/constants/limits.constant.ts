// Validation bounds and platform limits.
//
// These constants centralize the character-length bounds, the per-material Tag
// limit, and the Access Token lifetime referenced across the requirements so
// that validation (Zod schemas), services, and token issuance share a single
// source of truth.
//
// References:
//   - Req 6.2:  Download Gate name (1–100) and email (1–254, valid format).
//   - Req 6.5:  Access Token expires 2592000 seconds after issuance.
//   - Req 11.2: Study Material title (1–200).
//   - Req 11.6: Study Material description (0–2000).
//   - Req 2.1:  Category Type name (1–100).
//   - Req 11.11 / Category name (1–100).
//   - Req 4.1:  Search query (1–100).
//   - Req 2.2:  A Study Material may carry between 0 and 50 Tags (50-Tag limit).

// --- Learner (Download Gate) ---
export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 100;

export const EMAIL_MIN_LENGTH = 1;
export const EMAIL_MAX_LENGTH = 254;

// --- Account password ---
// Password length bounds enforced when a Learner sets a password (Req 2.4) and
// mirrored by the login schema's max bound (Req 4.3).
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// --- Study Material metadata ---
export const TITLE_MIN_LENGTH = 1;
export const TITLE_MAX_LENGTH = 200;

export const DESCRIPTION_MIN_LENGTH = 0;
export const DESCRIPTION_MAX_LENGTH = 2000;

// --- Category Type / Category names ---
export const CATEGORY_TYPE_NAME_MIN_LENGTH = 1;
export const CATEGORY_TYPE_NAME_MAX_LENGTH = 100;

export const CATEGORY_NAME_MIN_LENGTH = 1;
export const CATEGORY_NAME_MAX_LENGTH = 100;

// --- Search ---
export const SEARCH_QUERY_MIN_LENGTH = 1;
export const SEARCH_QUERY_MAX_LENGTH = 100;

// --- Tagging ---
// Maximum number of Tags a single Study Material may carry (Req 2.2, 2.4).
export const MAX_TAGS_PER_MATERIAL = 50;

// --- Access Token ---
// Access Token time-to-live in seconds (30 days) used to compute the token
// expiry at issuance (Req 6.5).
export const ACCESS_TOKEN_TTL_SECONDS = 2592000;

// --- Rate limiting ---
// A single client (keyed by IP) may make at most RATE_LIMIT_MAX_REQUESTS
// requests within any RATE_LIMIT_WINDOW_MS millisecond sliding window; further
// requests in that window are rejected with 429 TOO_MANY_REQUESTS.
export const RATE_LIMIT_MAX_REQUESTS = 20;
export const RATE_LIMIT_WINDOW_SECONDS = 10;
export const RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_SECONDS * 1000;

// Grouped view of the length bounds for convenient, type-safe access.
export const LENGTH_BOUNDS = {
  name: { min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH },
  email: { min: EMAIL_MIN_LENGTH, max: EMAIL_MAX_LENGTH },
  title: { min: TITLE_MIN_LENGTH, max: TITLE_MAX_LENGTH },
  description: { min: DESCRIPTION_MIN_LENGTH, max: DESCRIPTION_MAX_LENGTH },
  categoryTypeName: {
    min: CATEGORY_TYPE_NAME_MIN_LENGTH,
    max: CATEGORY_TYPE_NAME_MAX_LENGTH,
  },
  categoryName: { min: CATEGORY_NAME_MIN_LENGTH, max: CATEGORY_NAME_MAX_LENGTH },
  searchQuery: { min: SEARCH_QUERY_MIN_LENGTH, max: SEARCH_QUERY_MAX_LENGTH },
} as const;
