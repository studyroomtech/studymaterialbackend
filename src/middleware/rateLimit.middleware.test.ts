// Unit and property tests for the sliding-window rate-limiting middleware.
//
// These verify that a client (keyed by IP) may make up to `max` requests within
// a `windowMs` window, that the (max + 1)-th request in the window is rejected
// with a typed TooManyRequestsError (429 TOO_MANY_REQUESTS) carrying a
// Retry-After header, that distinct clients are tracked independently, and that
// budget frees up again once requests age out of the window.

import type { NextFunction, Request, Response } from 'express';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from './rateLimit.middleware';
import { TooManyRequestsError } from '../utils/errors';

function makeReq(ip = '1.2.3.4'): Request {
  return { ip, socket: { remoteAddress: ip } } as unknown as Request;
}

function makeRes(): Response {
  return { setHeader: vi.fn() } as unknown as Response;
}

/** The argument forwarded to next() on the given call (undefined = proceed). */
function nextArg(next: NextFunction, call = 0): unknown {
  return (next as unknown as ReturnType<typeof vi.fn>).mock.calls[call]?.[0];
}

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the limit, then rejects with 429 (TOO_MANY_REQUESTS)', () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 10_000 });
    const req = makeReq();

    for (let i = 0; i < 3; i += 1) {
      const next = vi.fn() as unknown as NextFunction;
      limiter(req, makeRes(), next);
      expect(nextArg(next)).toBeUndefined();
    }

    const next = vi.fn() as unknown as NextFunction;
    limiter(req, makeRes(), next);
    const err = nextArg(next);
    expect(err).toBeInstanceOf(TooManyRequestsError);
    expect((err as TooManyRequestsError).statusCode).toBe(429);
    expect((err as TooManyRequestsError).code).toBe('TOO_MANY_REQUESTS');
  });

  it('sets a Retry-After header on a throttled request', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 10_000 });
    limiter(makeReq(), makeRes(), vi.fn() as unknown as NextFunction);

    const res = makeRes();
    limiter(makeReq(), res, vi.fn() as unknown as NextFunction);

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '10');
  });

  it('tracks distinct client IPs independently', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 10_000 });

    const firstA = vi.fn() as unknown as NextFunction;
    limiter(makeReq('10.0.0.1'), makeRes(), firstA);
    expect(nextArg(firstA)).toBeUndefined();

    // A different IP still has its full budget.
    const firstB = vi.fn() as unknown as NextFunction;
    limiter(makeReq('10.0.0.2'), makeRes(), firstB);
    expect(nextArg(firstB)).toBeUndefined();

    // The first IP is now over budget.
    const secondA = vi.fn() as unknown as NextFunction;
    limiter(makeReq('10.0.0.1'), makeRes(), secondA);
    expect(nextArg(secondA)).toBeInstanceOf(TooManyRequestsError);
  });

  it('frees up budget once requests age out of the sliding window', () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 10_000 });
    const req = makeReq();

    limiter(req, makeRes(), vi.fn() as unknown as NextFunction);
    limiter(req, makeRes(), vi.fn() as unknown as NextFunction);

    // Third request within the window is rejected.
    const blocked = vi.fn() as unknown as NextFunction;
    limiter(req, makeRes(), blocked);
    expect(nextArg(blocked)).toBeInstanceOf(TooManyRequestsError);

    // Advance past the window so the earlier hits expire.
    vi.advanceTimersByTime(10_001);

    const allowed = vi.fn() as unknown as NextFunction;
    limiter(req, makeRes(), allowed);
    expect(nextArg(allowed)).toBeUndefined();
  });

  // Property: for any positive limit and a single client, exactly the first
  // `max` requests within the window proceed and every subsequent request in
  // that same window is rejected with a TooManyRequestsError.
  it('permits exactly `max` requests per window for a single client', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 20 }),
        (max, extra) => {
          vi.setSystemTime(0);
          const limiter = createRateLimiter({ max, windowMs: 10_000 });
          const req = makeReq('9.9.9.9');
          const total = max + extra;

          for (let i = 0; i < total; i += 1) {
            const next = vi.fn() as unknown as NextFunction;
            limiter(req, makeRes(), next);
            const arg = nextArg(next);
            if (i < max) {
              expect(arg).toBeUndefined();
            } else {
              expect(arg).toBeInstanceOf(TooManyRequestsError);
            }
          }
        },
      ),
    );
  });
});
