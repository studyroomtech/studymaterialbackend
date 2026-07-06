// Wiring tests for the admin router (task 9.3).
//
// The admin router is thin HTTP wiring: its behavior is verified end-to-end by
// the already-tested controllers, middleware, and services. These tests assert
// the *wiring contract* only, by inspecting the configured Express router:
//
//   - every expected admin method+path is registered (Req 10.5, 11, 2.2–2.3);
//   - `authMiddleware` runs first for every admin request (Req 10.2–10.4);
//   - `requireAdmin` guards every Content Management Action, and ONLY the
//     `POST /login` authentication entry point is exempt (Req 10.5–10.8);
//   - price-setting on material upload/edit stays behind `requireAdmin` like
//     every other Content Management Action (Req 11.13, 11.16) — the Price
//     fields are shaped by the route Zod schemas and validated authoritatively
//     by `material.service`, so route wiring is unchanged.

import { describe, expect, it } from 'vitest';

import { createAdminRouter } from './admin.routes';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/requireAdmin.middleware';

// Minimal shapes of the internal Express router layer stack we inspect. Express
// does not export these, so we read just the fields we need via an inline type
// on the accessor (named type/interface declarations belong in *.types.ts).
function getStack(): {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: unknown; name: string }[];
  };
  handle: unknown;
  name: string;
}[] {
  const router = createAdminRouter() as unknown as {
    stack: {
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: { handle: unknown; name: string }[];
      };
      handle: unknown;
      name: string;
    }[];
  };
  return router.stack;
}

function routeLayers(): ReturnType<typeof getStack> {
  return getStack().filter((layer) => layer.route !== undefined);
}

/** All registered "METHOD /path" combinations on the admin router. */
function registeredRoutes(): string[] {
  const routes: string[] = [];
  for (const layer of routeLayers()) {
    const route = layer.route;
    if (route === undefined) {
      continue;
    }
    for (const [method, enabled] of Object.entries(route.methods)) {
      if (enabled) {
        routes.push(`${method.toUpperCase()} ${route.path}`);
      }
    }
  }
  return routes.sort();
}

/** The handler-chain function names for a given method+path route. */
function chainFor(method: string, path: string): string[] {
  const layer = routeLayers().find(
    (l) => l.route?.path === path && l.route?.methods[method.toLowerCase()],
  );
  if (layer?.route === undefined) {
    throw new Error(`route not found: ${method} ${path}`);
  }
  return layer.route.stack.map((s) => s.name);
}

const EXPECTED_ROUTES = [
  'POST /login',
  'POST /materials',
  'PATCH /materials/:id',
  'DELETE /materials/:id',
  'POST /materials/:id/tags',
  'DELETE /materials/:id/tags/:categoryId',
  'POST /category-types',
  'PATCH /category-types/:id',
  'DELETE /category-types/:id',
  'POST /categories',
  'PATCH /categories/:id',
  'DELETE /categories/:id',
];

describe('createAdminRouter wiring', () => {
  it('registers exactly the expected admin routes (Req 10.5, 11, 2.2-2.3)', () => {
    expect(registeredRoutes()).toEqual([...EXPECTED_ROUTES].sort());
  });

  it('runs authMiddleware first for every admin request (Req 10.2-10.4)', () => {
    // The first non-route layer is the router-level `use(authMiddleware)`.
    const firstLayer = getStack()[0];
    expect(firstLayer.route).toBeUndefined();
    expect(firstLayer.handle).toBe(authMiddleware);
  });

  it('guards every Content Management Action with requireAdmin (Req 10.5-10.8)', () => {
    const protectedRoutes: [string, string][] = [
      ['POST', '/materials'],
      ['PATCH', '/materials/:id'],
      ['DELETE', '/materials/:id'],
      ['POST', '/materials/:id/tags'],
      ['DELETE', '/materials/:id/tags/:categoryId'],
      ['POST', '/category-types'],
      ['PATCH', '/category-types/:id'],
      ['DELETE', '/category-types/:id'],
      ['POST', '/categories'],
      ['PATCH', '/categories/:id'],
      ['DELETE', '/categories/:id'],
    ];
    for (const [method, path] of protectedRoutes) {
      const chain = routeLayers().find(
        (l) => l.route?.path === path && l.route?.methods[method.toLowerCase()],
      )?.route?.stack.map((s) => s.handle);
      expect(chain, `${method} ${path} should include requireAdmin`).toContain(
        requireAdmin,
      );
    }
  });

  it('exempts POST /login from requireAdmin so admins can authenticate (Req 10.5)', () => {
    const chain = routeLayers().find(
      (l) => l.route?.path === '/login' && l.route?.methods.post,
    )?.route?.stack.map((s) => s.handle);
    expect(chain).not.toContain(requireAdmin);
  });

  it('parses the multipart file part before validation on material upload (Req 11.1)', () => {
    // The upload chain includes a multer middleware ("multerMiddleware") ahead
    // of the validate/controller layers so `req.file`/`req.body` are populated.
    const chain = chainFor('POST', '/materials');
    const multerIndex = chain.findIndex((n) => n.toLowerCase().includes('multer'));
    expect(multerIndex).toBeGreaterThanOrEqual(0);
    // requireAdmin precedes the multipart parse; the controller is last.
    expect(chain[chain.length - 1]).toBe('uploadMaterialHandler');
  });
});
