// Tests for the public route wiring (task 9.2).
//
// These verify that `catalog.routes.ts`, `materials.routes.ts`, and
// `downloads.routes.ts` are wired through the authentication-resolution
// middleware and Zod validation, and that the expected endpoints are
// registered at the paths the design specifies (Req 3.1, 4.1, 5.1, 6.1, 6.8).
//
// Two complementary styles are used:
//   1. Structural assertions over the Express router stack confirm each route's
//      method/path and that auth + validate middleware are present.
//   2. Behavioral assertions mount each router on a real Express app (with the
//      shared error handler) and drive it over HTTP to confirm that malformed
//      requests are rejected by `validate` with the unified error envelope
//      before any controller/service runs — so no database access is required.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import catalogRouter from './catalog.routes';
import materialsRouter from './materials.routes';
import downloadsRouter from './downloads.routes';
import { errorHandler } from '../middleware/errorHandler.middleware';

// Minimal shape of the Express router internals we introspect. Express does not
// expose these in its public types, so this local cast describes just what we
// read: each layer is either a route layer (with `route`) or a middleware layer
// (with a handler `name`). Written inline to keep type declarations in
// `*.types.ts` per the project convention (Req 1.15).
function readStack(router: unknown): Array<{
  route?: { path: string; methods: Record<string, boolean>; stack: unknown[] };
  name?: string;
}> {
  return (
    router as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: unknown[];
        };
        name?: string;
      }>;
    }
  ).stack;
}

function readRoutes(router: unknown): Array<{
  path: string;
  methods: string[];
  handlerCount: number;
}> {
  return readStack(router)
    .filter((layer) => layer.route !== undefined)
    .map((layer) => ({
      path: layer.route!.path,
      methods: Object.keys(layer.route!.methods),
      handlerCount: layer.route!.stack.length,
    }));
}

function hasAuthMiddleware(router: unknown): boolean {
  // `router.use(authMiddleware)` registers a non-route layer whose handler is
  // the named `authMiddleware` function.
  return readStack(router).some(
    (layer) => !layer.route && layer.name === 'authMiddleware',
  );
}

describe('public route wiring (structure)', () => {
  it('catalog router wires GET /catalog behind auth (Req 3.1)', () => {
    const routes = readRoutes(catalogRouter);
    expect(hasAuthMiddleware(catalogRouter)).toBe(true);
    expect(routes).toContainEqual(
      expect.objectContaining({ path: '/catalog', methods: ['get'] }),
    );
  });

  it('materials router wires search and get behind auth + validate (Req 4.1, 5.1)', () => {
    const routes = readRoutes(materialsRouter);
    expect(hasAuthMiddleware(materialsRouter)).toBe(true);

    const search = routes.find((r) => r.path === '/materials/search');
    const getById = routes.find((r) => r.path === '/materials/:id');
    expect(search).toMatchObject({ methods: ['get'] });
    expect(getById).toMatchObject({ methods: ['get'] });
    // validate + controller => at least two handlers on each route.
    expect(search?.handlerCount).toBeGreaterThanOrEqual(2);
    expect(getById?.handlerCount).toBeGreaterThanOrEqual(2);
  });

  it('registers /materials/search before /materials/:id so the literal wins', () => {
    const routes = readRoutes(materialsRouter);
    const searchIndex = routes.findIndex((r) => r.path === '/materials/search');
    const idIndex = routes.findIndex((r) => r.path === '/materials/:id');
    expect(searchIndex).toBeGreaterThanOrEqual(0);
    expect(idIndex).toBeGreaterThan(searchIndex);
  });

  it('wires GET /materials/paid behind auth (Req 12.1)', () => {
    const routes = readRoutes(materialsRouter);
    expect(hasAuthMiddleware(materialsRouter)).toBe(true);
    const paid = routes.find((r) => r.path === '/materials/paid');
    expect(paid).toMatchObject({ methods: ['get'] });
  });

  it('registers /materials/paid before /materials/:id so the literal wins', () => {
    const routes = readRoutes(materialsRouter);
    const paidIndex = routes.findIndex((r) => r.path === '/materials/paid');
    const idIndex = routes.findIndex((r) => r.path === '/materials/:id');
    expect(paidIndex).toBeGreaterThanOrEqual(0);
    expect(idIndex).toBeGreaterThan(paidIndex);
  });

  it('downloads router wires gate and download behind auth + validate (Req 6.1, 6.8)', () => {
    const routes = readRoutes(downloadsRouter);
    expect(hasAuthMiddleware(downloadsRouter)).toBe(true);

    const gate = routes.find((r) => r.path === '/downloads/gate');
    const download = routes.find((r) => r.path === '/materials/:id/download');
    expect(gate).toMatchObject({ methods: ['post'] });
    expect(download).toMatchObject({ methods: ['post'] });
    expect(gate?.handlerCount).toBeGreaterThanOrEqual(2);
    expect(download?.handlerCount).toBeGreaterThanOrEqual(2);
  });
});

describe('public route wiring (validation behavior)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use('/api', catalogRouter);
    app.use('/api', materialsRouter);
    app.use('/api', downloadsRouter);
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

  it('rejects a Download Gate submission with an invalid name/email (Req 6.3)', async () => {
    const res = await fetch(`${baseUrl}/api/downloads/gate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'not-an-email' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; fields?: { field: string }[] };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    const fields = (body.error.fields ?? []).map((f) => f.field);
    expect(fields).toContain('name');
    expect(fields).toContain('email');
  });

  it('rejects a search query longer than the allowed bound (Req 4.1)', async () => {
    const tooLong = 'a'.repeat(101);
    const res = await fetch(
      `${baseUrl}/api/materials/search?q=${encodeURIComponent(tooLong)}`,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
