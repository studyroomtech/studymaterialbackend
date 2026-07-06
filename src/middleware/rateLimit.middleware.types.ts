// Types for the rate-limiting middleware (`rateLimit.middleware.ts`).

/** Tunable knobs for a rate limiter instance. */
export interface RateLimitOptions {
  /** Maximum number of requests permitted within the window. */
  max?: number;
  /** Sliding window length in milliseconds. */
  windowMs?: number;
}
