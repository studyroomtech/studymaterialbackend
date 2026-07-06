// Unit and property tests for the requireAdmin authorization middleware.
//
// These verify that only an authenticated Admin (role_admin) may proceed to a
// Content Management Action, that an authenticated Learner (role_common) is
// rejected with FORBIDDEN (403, Req 10.7), that a caller with no admin
// authentication present is rejected with AUTH_REQUIRED (401, Req 10.6, 10.8),
// and that a rejected request never reaches the next handler (so no stored data
// is mutated — Req 10.6, 10.7, 11.16).

import type { NextFunction, Request, Response } from 'express';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { requireAdmin } from './requireAdmin.middleware';
import { AuthRequiredError, ForbiddenError } from '../utils/errors';
import { ROLE_ADMIN, ROLE_COMMON } from '../constants/roles.constant';
import type { AuthContext } from '../types/auth.types';

function makeReq(auth?: AuthContext): Request {
  return { auth } as unknown as Request;
}

function makeRes(): Response {
  // requireAdmin never touches the response object; a bare stub is sufficient.
  return {} as unknown as Response;
}

describe('requireAdmin', () => {
  it('allows an authenticated Admin (role_admin) to proceed (Req 10.4, 10.5)', () => {
    const next = vi.fn() as unknown as NextFunction;

    requireAdmin(
      makeReq({ role: ROLE_ADMIN, username: 'root', userId: 'admin_1' }),
      makeRes(),
      next,
    );

    // next() called with NO argument means the request proceeds.
    expect(next).toHaveBeenCalledTimes(1);
    expect((next as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(
      [],
    );
  });

  it('rejects an authenticated Learner holding role_common with 403 (Req 10.7)', () => {
    const next = vi.fn() as unknown as NextFunction;

    requireAdmin(
      makeReq({ role: ROLE_COMMON, userId: 'user_1', email: 'ada@example.com' }),
      makeRes(),
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('rejects an anonymous role_common caller with 401 (Req 10.6)', () => {
    const next = vi.fn() as unknown as NextFunction;

    requireAdmin(makeReq({ role: ROLE_COMMON }), makeRes(), next);

    const err = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(AuthRequiredError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTH_REQUIRED');
  });

  it('rejects a caller with no resolved auth context with 401 (Req 10.8)', () => {
    const next = vi.fn() as unknown as NextFunction;

    requireAdmin(makeReq(undefined), makeRes(), next);

    const err = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeInstanceOf(AuthRequiredError);
    expect(err.statusCode).toBe(401);
  });

  it('never invokes the next handler with a value when rejecting, leaving data untouched (Req 10.6, 10.7, 11.16)', () => {
    // A rejection forwards an Error to next(); it never calls next() cleanly,
    // so the controller/service chain (which would mutate data) is not reached.
    for (const auth of [
      undefined,
      { role: ROLE_COMMON } as AuthContext,
      { role: ROLE_COMMON, userId: 'u1' } as AuthContext,
    ]) {
      const next = vi.fn() as unknown as NextFunction;
      requireAdmin(makeReq(auth), makeRes(), next);
      const arg = (next as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(arg).toBeInstanceOf(Error);
    }
  });

  // Property: for any resolved AuthContext, role_admin always proceeds and any
  // other role is always rejected with a typed authorization error whose status
  // is 401 (no admin authentication present) or 403 (authenticated non-admin).
  it('classifies every auth context correctly (Req 10.4-10.8)', () => {
    const authArb = fc.option(
      fc.record(
        {
          role: fc.constantFrom(ROLE_COMMON, ROLE_ADMIN),
          userId: fc.option(fc.string(), { nil: undefined }),
          email: fc.option(fc.emailAddress(), { nil: undefined }),
          username: fc.option(fc.string(), { nil: undefined }),
        },
        { requiredKeys: ['role'] },
      ),
      { nil: undefined },
    );

    fc.assert(
      fc.property(authArb, (auth) => {
        const next = vi.fn() as unknown as NextFunction;
        requireAdmin(makeReq(auth as AuthContext | undefined), makeRes(), next);
        const arg = (next as unknown as ReturnType<typeof vi.fn>).mock
          .calls[0][0];

        if (auth?.role === ROLE_ADMIN) {
          // Admin proceeds: next() called with no argument.
          expect(arg).toBeUndefined();
          return;
        }

        // Everyone else is rejected with a typed authorization error.
        expect(arg).toBeInstanceOf(Error);
        const identified =
          auth !== undefined &&
          (auth.userId !== undefined ||
            auth.email !== undefined ||
            auth.username !== undefined);

        if (identified) {
          expect(arg).toBeInstanceOf(ForbiddenError);
          expect((arg as ForbiddenError).statusCode).toBe(403);
        } else {
          expect(arg).toBeInstanceOf(AuthRequiredError);
          expect((arg as AuthRequiredError).statusCode).toBe(401);
        }
      }),
    );
  });
});
