// Tests for the payment route wiring (task 19.5).
//
// These verify that `payments.routes.ts` registers the three Razorpay payment
// endpoints at the design's paths, that the initiate route runs behind the
// authentication-resolution middleware and Zod params validation, that the
// verify route validates its body, and — critically — that the webhook route
// captures the RAW request body via `express.raw` so the signature can be
// verified over the exact bytes Razorpay signed (Req 12.4, 12.5, 12.6, 12.19).
//
// Two complementary styles are used:
//   1. Structural assertions over the Express router stack confirm each route's
//      method/path and the presence of the auth, validate, and raw-body layers.
//   2. A behavioral assertion mounts the router on a real Express app that,
//      like `app.ts`, skips the global JSON parser for the webhook path, and
//      confirms a malformed verify body is rejected by `validate` before any
//      controller/service runs — so no database access is required.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import paymentsRouter from './payments.routes';
import { errorHandler } from '../middleware/errorHandler.middleware';

// Minimal shape of the Express router internals we introspect. Express does not
// expose these in its public types, so this local cast describes just what we
// read: each layer is either a route layer (with `route`) or a middleware layer
// (with a handler `name`). Written inline to keep type declarations in
// `*.types.ts` per the project convention (Req 1.15).
function readStack(router: unknown): Array<{
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ name?: string }>;
  };
  name?: string;
}> {
  return (
    router as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ name?: string }>;
        };
        name?: string;
      }>;
    }
  ).stack;
}

function readRoutes(router: unknown): Array<{
  path: string;
  methods: string[];
  handlerNames: string[];
}> {
  return readStack(router)
    .filter((layer) => layer.route !== undefined)
    .map((layer) => ({
      path: layer.route!.path,
      methods: Object.keys(layer.route!.methods),
      handlerNames: layer.route!.stack.map((h) => h.name ?? ''),
    }));
}

describe('payment route wiring (structure)', () => {
  it('wires POST /materials/:id/payment behind auth + validate (Req 12.4)', () => {
    const routes = readRoutes(paymentsRouter);
    const initiate = routes.find((r) => r.path === '/materials/:id/payment');
    expect(initiate).toMatchObject({ methods: ['post'] });
    expect(initiate?.handlerNames).toContain('authMiddleware');
    // validate + controller => at least three handlers with auth present.
    expect(initiate?.handlerNames.length).toBeGreaterThanOrEqual(3);
  });

  it('wires POST /payments/verify with body validation (Req 12.6)', () => {
    const routes = readRoutes(paymentsRouter);
    const verify = routes.find((r) => r.path === '/payments/verify');
    expect(verify).toMatchObject({ methods: ['post'] });
    // validate + controller => at least two handlers.
    expect(verify?.handlerNames.length).toBeGreaterThanOrEqual(2);
  });

  it('wires POST /payments/webhook with a raw-body parser (Req 12.19)', () => {
    const routes = readRoutes(paymentsRouter);
    const webhook = routes.find((r) => r.path === '/payments/webhook');
    expect(webhook).toMatchObject({ methods: ['post'] });
    // express.raw registers a middleware named `rawParser` ahead of the handler
    // so the webhook signature is verified over the exact raw bytes.
    expect(webhook?.handlerNames).toContain('rawParser');
  });
});

describe('payment route wiring (validation behavior)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app: Express = express();
    // Mirror app.ts: apply the JSON parser to every path EXCEPT the webhook,
    // whose raw body must reach `express.raw` unparsed (Req 12.19).
    const jsonParser = express.json();
    app.use((req, res, next) => {
      if (req.path === '/api/payments/webhook') {
        next();
        return;
      }
      jsonParser(req, res, next);
    });
    app.use('/api', paymentsRouter);
    app.use(errorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('rejects a verify submission missing required fields (Req 12.6)', async () => {
    const res = await fetch(`${baseUrl}/api/payments/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ razorpayOrderId: '' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; fields?: { field: string }[] };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    const fields = (body.error.fields ?? []).map((f) => f.field);
    expect(fields).toContain('razorpayOrderId');
    expect(fields).toContain('razorpayPaymentId');
    expect(fields).toContain('razorpaySignature');
  });
});
