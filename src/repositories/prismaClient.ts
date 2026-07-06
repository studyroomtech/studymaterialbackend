// Shared Prisma client for the Backend Project's repository layer.
//
// All repository modules access PostgreSQL through the single, process-wide
// `PrismaClient` returned by `getPrismaClient()` (Req 1.12). Sharing one client
// keeps a single connection pool across the app rather than opening a new pool
// per repository call.
//
// The client is constructed lazily and cached so that importing a repository
// module performs no connection work until a query is actually issued — which
// keeps builds, typechecks, and unit tests free of any live-database
// dependency. The connection string itself is read by Prisma from the
// `DATABASE_URL` Environment Variable declared in `schema.prisma` (Req 1.10).

import { PrismaClient } from '@prisma/client';

let cachedClient: PrismaClient | undefined;

/**
 * Return the process-wide Prisma client, constructing and caching it on first
 * use. All repositories share this instance so a single connection pool backs
 * the whole Backend Project.
 */
export function getPrismaClient(): PrismaClient {
  if (cachedClient === undefined) {
    cachedClient = new PrismaClient();
  }
  return cachedClient;
}

/**
 * Replace the cached client. Intended for tests that need to inject a stub or a
 * client pointed at an isolated schema; passing `undefined` clears the cache so
 * the next `getPrismaClient()` call builds a fresh instance.
 */
export function setPrismaClient(client: PrismaClient | undefined): void {
  cachedClient = client;
}

/**
 * Disconnect and clear the cached client, releasing the underlying connection
 * pool. Safe to call when no client has been created (resolves immediately).
 */
export async function disconnectPrisma(): Promise<void> {
  if (cachedClient !== undefined) {
    await cachedClient.$disconnect();
    cachedClient = undefined;
  }
}
