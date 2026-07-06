// Constant values for the Download Gate / download service (Req 1.16: all
// constant values live in a `*.constant.ts` file).
//
// The character-length bounds for the Download Gate name and email live in
// `constants/limits.constant.ts` (shared with the Zod validation layer); this
// module holds the download-service-specific email-format pattern used to
// enforce Req 6.2/6.3 (an email must be in a valid email format, in addition to
// its 1–254 character bound).

/**
 * Pragmatic email-format pattern (Req 6.2, 6.3).
 *
 * Requires a non-empty local part, a single `@`, and a domain containing at
 * least one dot with non-empty labels, disallowing whitespace anywhere. This is
 * intentionally a practical validation rather than a full RFC 5322 grammar: it
 * rejects the common malformed shapes (missing `@`, missing domain, missing
 * TLD, embedded spaces) while accepting ordinary addresses. The 1–254 character
 * length bound is enforced separately from `limits.constant.ts`.
 */
export const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
