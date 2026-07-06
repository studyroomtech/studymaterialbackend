// Unit tests for the central error-handling middleware.
//
// These verify the unified error envelope mapping (Req 8.1), that no stack
// trace or internal identifier ever reaches the client (Req 8.4), and that
// every 5xx/unexpected error is logged with details and a timestamp (Req 8.5).

import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from './errorHandler.middleware';
import {
  AppError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';
import * as logger from '../utils/logger';

function makeReq(): Request {
  return { method: 'GET', originalUrl: '/api/test' } as unknown as Request;
}

function makeRes(headersSent = false): {
  res: Response;
  statusMock: ReturnType<typeof vi.fn>;
  jsonMock: ReturnType<typeof vi.fn>;
} {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  const res = {
    headersSent,
    status: statusMock,
    json: jsonMock,
  } as unknown as Response;
  return { res, statusMock, jsonMock };
}

describe('errorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a domain AppError to its status and safe envelope (Req 8.1)', () => {
    const { res, statusMock, jsonMock } = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    errorHandler(
      new ValidationError('Invalid input', [
        { field: 'email', reason: 'invalid format' },
      ]),
      makeReq(),
      res,
      next,
    );

    expect(statusMock).toHaveBeenCalledWith(422);
    expect(jsonMock).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        fields: [{ field: 'email', reason: 'invalid format' }],
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('maps a NotFoundError to a 404 envelope without fields (Req 8.1)', () => {
    const { res, statusMock, jsonMock } = makeRes();

    errorHandler(
      new NotFoundError('Study Material not found'),
      makeReq(),
      res,
      vi.fn() as unknown as NextFunction,
    );

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Study Material not found' },
    });
  });

  it('masks an unknown throwable behind a generic 500 envelope and never leaks internals (Req 8.4)', () => {
    const { res, statusMock, jsonMock } = makeRes();
    vi.spyOn(logger, 'logError').mockImplementation(() => undefined);

    const secret = new Error('DB password=hunter2 at /srv/app/db.ts:42');
    errorHandler(secret, makeReq(), res, vi.fn() as unknown as NextFunction);

    expect(statusMock).toHaveBeenCalledWith(500);
    const body = jsonMock.mock.calls[0][0];
    // The actual error message is surfaced to the caller.
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'DB password=hunter2 at /srv/app/db.ts:42',
      },
    });
    // Only `message` is exposed — never the stack trace.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('stack');
  });

  it('logs every unexpected error with error details (Req 8.5)', () => {
    const { res } = makeRes();
    const logSpy = vi
      .spyOn(logger, 'logError')
      .mockImplementation(() => undefined);

    errorHandler(
      new Error('boom'),
      makeReq(),
      res,
      vi.fn() as unknown as NextFunction,
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [message, fields] = logSpy.mock.calls[0];
    expect(message).toBe('Unexpected server error');
    expect(fields).toMatchObject({
      code: 'INTERNAL_ERROR',
      method: 'GET',
      path: '/api/test',
      errorMessage: 'boom',
    });
  });

  it('logs and surfaces the message of a 5xx AppError such as InternalError (Req 8.5)', () => {
    const { res, statusMock, jsonMock } = makeRes();
    const logSpy = vi
      .spyOn(logger, 'logError')
      .mockImplementation(() => undefined);

    errorHandler(
      new InternalError('leaky detail about internals'),
      makeReq(),
      res,
      vi.fn() as unknown as NextFunction,
    );

    expect(statusMock).toHaveBeenCalledWith(500);
    // The actual error message is surfaced to the caller.
    expect(jsonMock).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'leaky detail about internals',
      },
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces a custom 5xx AppError with its status, code, and message', () => {
    const { res, statusMock, jsonMock } = makeRes();
    vi.spyOn(logger, 'logError').mockImplementation(() => undefined);

    errorHandler(
      new AppError('SOME_CODE', 503, 'internal wiring failed'),
      makeReq(),
      res,
      vi.fn() as unknown as NextFunction,
    );

    // The AppError's own status/code/message are preserved.
    expect(statusMock).toHaveBeenCalledWith(503);
    expect(jsonMock).toHaveBeenCalledWith({
      error: {
        code: 'SOME_CODE',
        message: 'internal wiring failed',
      },
    });
  });

  it('delegates to next when the response has already started (headersSent)', () => {
    const { res, statusMock } = makeRes(true);
    const next = vi.fn() as unknown as NextFunction;
    const err = new Error('late');

    errorHandler(err, makeReq(), res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(statusMock).not.toHaveBeenCalled();
  });
});
