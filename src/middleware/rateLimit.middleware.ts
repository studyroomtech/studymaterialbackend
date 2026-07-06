// In-memory sliding-window rate-limiting middleware.
//
// Enforces that a single client — keyed by its source IP — makes at most
// `max` requests within any `windowMs` sliding window. Requests beyond that
// budget are rejected with a typed `TooManyRequestsError` (429
// TOO_MANY_REQUESTS) forwarded via `next(err)` so the central
// `errorHandler.middleware` maps it to the unified error envelope
// (`{ error: { code, message } }`). Because the request is rejected here —
// before any controller/service runs — no stored data is created, edited, or
// deleted.
//
// The default configuration (30 requests / 10 seconds) comes from
// `limits.constant.ts`. The limiter is a true sliding window: for each client
// it retains the timestamps of requests inside the current window and drops
// any that have aged out, so a burst is throttled precisely rather than
// resetting on a fixed calendar boundary.
//
// State is process-local (a `Map`), which is appropriate for a single-instance
// deployment. Behind multiple instances / a load balancer this would need a
// shared store (e.g. Redis); that is out of scope here.

import type { NextFunction, Request, Response } from 'express';

import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '../constants/limits.constant';
import { TooManyRequestsError } from '../utils/errors';
import type { RateLimitOptions } from './rateLimit.middleware.types';

/**
 * Resolve a stable client key for a request. Prefers Express's `req.ip`
 * (honours the configured trust-proxy setting); falls back to the raw socket
 * address, then to a shared bucket so a request is never left unkeyed.
 */
function resolveClientKey(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Create a sliding-window rate-limiting middleware. Each distinct client IP is
 * allowed `max` requests per `windowMs`; the (max + 1)-th request inside the
 * window is rejected with 429 TOO_MANY_REQUESTS and a `Retry-After` header
 * indicating when the client may retry.
 */
export function createRateLimiter(
  options: RateLimitOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const max = options.max ?? RATE_LIMIT_MAX_REQUESTS;
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;

  // client key -> ascending list of request timestamps (ms) within the window.
  const hits = new Map<string, number[]>();

  return function rateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const now = Date.now();
    const windowStart = now - windowMs;
    const key = resolveClientKey(req);

    // Drop timestamps that have aged out of the current window.
    const previous = hits.get(key) ?? [];
    const recent = previous.filter((timestamp) => timestamp > windowStart);

    if (recent.length >= max) {
      // Over budget: reject without recording this request. The window frees up
      // once the oldest retained hit ages out.
      const oldest = recent[0];
      const retryAfterMs = oldest + windowMs - now;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      // Persist the pruned list so memory does not grow unbounded.
      hits.set(key, recent);
      next(new TooManyRequestsError());
      return;
    }

    // Within budget: record this request and let it proceed.
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

/**
 * Default rate limiter (30 requests / 10 seconds per client IP) used by the
 * application to throttle the public API surface.
 */
export const rateLimit = createRateLimiter();
