// Unit tests for the Zod request-validation middleware (Req 8.3).
//
// These verify that valid requests pass through with their parsed values
// attached, that invalid requests are rejected before any controller runs with
// a `ValidationError` carrying per-field `{ field, reason }` details, and that
// all invalid parts across body/params/query are reported together.

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { validate } from './validate.middleware';
import { ValidationError } from '../utils/errors';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    originalUrl: '/api/test',
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as unknown as Request;
}

const noopRes = {} as Response;

describe('validate middleware', () => {
  it('calls next with no error and attaches the parsed body on success (Req 8.3)', () => {
    const schema = z.object({
      name: z.string().min(1).max(100),
      email: z.string().email(),
    });
    const req = makeReq({
      body: { name: 'Ada Lovelace', email: 'ada@example.com' },
    });
    const next = vi.fn() as unknown as NextFunction;

    validate({ body: schema })(req, noopRes, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
  });

  it('forwards a ValidationError with per-field details on an invalid body (Req 8.3)', () => {
    const schema = z.object({
      name: z.string().min(1),
      email: z.string().email(),
    });
    const req = makeReq({ body: { name: '', email: 'not-an-email' } });
    const next = vi.fn() as unknown as NextFunction;

    validate({ body: schema })(req, noopRes, next);

    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = (next as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(forwarded).toBeInstanceOf(ValidationError);
    expect(forwarded.statusCode).toBe(422);
    expect(forwarded.code).toBe('VALIDATION_ERROR');

    const invalidFields = forwarded.fields.map(
      (f: { field: string }) => f.field,
    );
    expect(invalidFields).toContain('name');
    expect(invalidFields).toContain('email');
    for (const detail of forwarded.fields) {
      expect(typeof detail.field).toBe('string');
      expect(typeof detail.reason).toBe('string');
      expect(detail.reason.length).toBeGreaterThan(0);
    }
  });

  it('does not mutate the request when validation fails (never reaches persistence) (Req 8.3)', () => {
    const schema = z.object({ id: z.coerce.number() });
    const original = { id: 'not-a-number' };
    const req = makeReq({ body: original });
    const next = vi.fn() as unknown as NextFunction;

    validate({ body: schema })(req, noopRes, next);

    // The controller is never invoked and the body is left untouched.
    expect(req.body).toBe(original);
    const forwarded = (next as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(forwarded).toBeInstanceOf(ValidationError);
  });

  it('collects invalid fields across params, query, and body in one response (Req 8.3)', () => {
    const req = makeReq({
      params: { id: 'x' },
      query: { limit: 'abc' },
      body: { title: '' },
    });
    const next = vi.fn() as unknown as NextFunction;

    validate({
      params: z.object({ id: z.string().uuid() }),
      query: z.object({ limit: z.coerce.number().int() }),
      body: z.object({ title: z.string().min(1) }),
    })(req, noopRes, next);

    const forwarded = (next as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(forwarded).toBeInstanceOf(ValidationError);
    const invalidFields = forwarded.fields.map(
      (f: { field: string }) => f.field,
    );
    expect(invalidFields).toEqual(expect.arrayContaining(['id', 'limit', 'title']));
  });

  it('attaches coerced query values on success', () => {
    const schema = z.object({ limit: z.coerce.number().int() });
    const req = makeReq({ query: { limit: '25' } });
    const next = vi.fn() as unknown as NextFunction;

    validate({ query: schema })(req, noopRes, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ limit: 25 });
  });

  it('reports a whole-object refinement failure under the request-part name', () => {
    const schema = z
      .object({ password: z.string(), confirm: z.string() })
      .refine((v) => v.password === v.confirm, {
        message: 'passwords must match',
      });
    const req = makeReq({ body: { password: 'a', confirm: 'b' } });
    const next = vi.fn() as unknown as NextFunction;

    validate({ body: schema })(req, noopRes, next);

    const forwarded = (next as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(forwarded.fields).toContainEqual({
      field: 'body',
      reason: 'passwords must match',
    });
  });

  it('passes through untouched parts that have no schema', () => {
    const req = makeReq({
      params: { id: 'keep-me' },
      body: { title: 'Valid' },
    });
    const next = vi.fn() as unknown as NextFunction;

    validate({ body: z.object({ title: z.string().min(1) }) })(
      req,
      noopRes,
      next,
    );

    expect(next).toHaveBeenCalledWith();
    // params had no schema and is left as-is.
    expect(req.params).toEqual({ id: 'keep-me' });
  });
});
