// Unit and property tests for auth.middleware.
//
// These verify that the middleware resolves role_common on a missing, invalid,
// or expired token (Req 10.2), attaches the User Record identity for a valid
// learner token (Req 10.3, 6.6), and attaches role_admin for a valid admin
// token (Req 10.4) — and that it never rejects a request on token grounds.
//
// `token.service.verifyToken` is mocked so these tests exercise the middleware
// resolution logic in isolation, without JWT signing/env coupling.

import type { NextFunction, Request, Response } from 'express';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authMiddleware, resolveAuthContext } from './auth.middleware';
import { ROLE_ADMIN, ROLE_COMMON } from '../constants/roles.constant';
import * as tokenService from '../services/token.service';
import type {
  AdminTokenClaims,
  LearnerTokenClaims,
} from '../types/auth.types';

function learnerClaims(
  userId: string,
  email: string,
): LearnerTokenClaims {
  return { sub: userId, role: ROLE_COMMON, email };
}

function adminClaims(adminId: string, username: string): AdminTokenClaims {
  return { sub: adminId, role: ROLE_ADMIN, username };
}

describe('resolveAuthContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves role_common when no Authorization header is present (Req 10.2)', () => {
    const verifySpy = vi.spyOn(tokenService, 'verifyToken');

    expect(resolveAuthContext(undefined)).toEqual({ role: ROLE_COMMON });
    // No token means verification is never even attempted.
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('resolves role_common when the header is not a Bearer credential (Req 10.2)', () => {
    vi.spyOn(tokenService, 'verifyToken');

    expect(resolveAuthContext('Basic abc123')).toEqual({ role: ROLE_COMMON });
    expect(resolveAuthContext('Bearer')).toEqual({ role: ROLE_COMMON });
    expect(resolveAuthContext('Bearer    ')).toEqual({ role: ROLE_COMMON });
  });

  it('resolves role_common when the token is invalid or expired (Req 10.2)', () => {
    // verifyToken returns null for invalid/malformed/expired tokens.
    vi.spyOn(tokenService, 'verifyToken').mockReturnValue(null);

    expect(resolveAuthContext('Bearer some.invalid.token')).toEqual({
      role: ROLE_COMMON,
    });
  });

  it('attaches userId and email for a valid learner token (Req 10.3, 6.6)', () => {
    vi.spyOn(tokenService, 'verifyToken').mockReturnValue(
      learnerClaims('user_123', 'ada@example.com'),
    );

    expect(resolveAuthContext('Bearer valid.learner.token')).toEqual({
      role: ROLE_COMMON,
      userId: 'user_123',
      email: 'ada@example.com',
      roles: [],
    });
  });

  it('attaches role_admin and username for a valid admin token (Req 10.4)', () => {
    vi.spyOn(tokenService, 'verifyToken').mockReturnValue(
      adminClaims('admin_1', 'root'),
    );

    expect(resolveAuthContext('Bearer valid.admin.token')).toEqual({
      role: ROLE_ADMIN,
      username: 'root',
    });
  });

  it('trims surrounding whitespace from the extracted token', () => {
    const verifySpy = vi
      .spyOn(tokenService, 'verifyToken')
      .mockReturnValue(null);

    resolveAuthContext('Bearer   padded.token   ');

    expect(verifySpy).toHaveBeenCalledWith('padded.token');
  });
});

describe('resolveAuthContext — property based', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // **Validates: Requirements 10.2**
  it('always resolves exactly role_common (no identity) whenever the token cannot be verified', () => {
    vi.spyOn(tokenService, 'verifyToken').mockReturnValue(null);

    fc.assert(
      fc.property(fc.string(), (raw) => {
        const ctx = resolveAuthContext(`Bearer ${raw}`);
        // Regardless of the token contents, an unverifiable token yields the
        // default public Role with no leaked identity.
        expect(ctx).toEqual({ role: ROLE_COMMON });
      }),
    );
  });

  // **Validates: Requirements 10.2**
  it('never errors and never attaches identity for arbitrary raw header values', () => {
    vi.spyOn(tokenService, 'verifyToken').mockReturnValue(null);

    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), (header) => {
        const ctx = resolveAuthContext(header);
        expect(ctx.role).toBe(ROLE_COMMON);
        expect(ctx.userId).toBeUndefined();
        expect(ctx.username).toBeUndefined();
      }),
    );
  });
});

describe('authMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeReq(authorization?: string): Request {
    return { headers: { authorization } } as unknown as Request;
  }

  it('attaches the resolved context to req.auth and calls next (Req 10.2)', () => {
    vi.spyOn(tokenService, 'verifyToken').mockReturnValue(null);
    const req = makeReq('Bearer bad.token');
    const next = vi.fn() as unknown as NextFunction;

    authMiddleware(req, {} as Response, next);

    expect(req.auth).toEqual({ role: ROLE_COMMON });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('attaches learner identity to req.auth for a valid learner token (Req 10.3)', () => {
    vi.spyOn(tokenService, 'verifyToken').mockReturnValue(
      learnerClaims('user_9', 'grace@example.com'),
    );
    const req = makeReq('Bearer learner.token');
    const next = vi.fn() as unknown as NextFunction;

    authMiddleware(req, {} as Response, next);

    expect(req.auth).toEqual({
      role: ROLE_COMMON,
      roles: [],
      userId: 'user_9',
      email: 'grace@example.com',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('attaches role_admin to req.auth for a valid admin token and always continues (Req 10.4)', () => {
    vi.spyOn(tokenService, 'verifyToken').mockReturnValue(
      adminClaims('admin_7', 'superuser'),
    );
    const req = makeReq('Bearer admin.token');
    const next = vi.fn() as unknown as NextFunction;

    authMiddleware(req, {} as Response, next);

    expect(req.auth).toEqual({ role: ROLE_ADMIN, username: 'superuser' });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
