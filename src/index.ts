// Backend startup entry point (task 9.4).
//
// Responsibilities, in order:
//   1. Validate environment configuration up front. `getEnv()` reads and
//      validates all Environment Variables and fails fast — logging the missing
//      key and aborting boot — when the required `DATABASE_URL` is absent or
//      empty (Req 1.11). Calling it before assembling/serving the app means the
//      process never begins listening with an invalid configuration.
//   2. Assemble the Express app (`createApp`).
//   3. Bind the HTTP server to the configured `PORT` (Req 1.10), which is fully
//      environment-driven so the same build deploys to Railway unchanged.
//   4. Release the database connection pool on shutdown so the process exits
//      cleanly (SIGINT/SIGTERM).
//
// Note: `prisma migrate deploy` is run as a separate release step (see the
// `release` script in package.json / railway.json), not from this process, so
// migrations are applied once per deploy rather than on every boot.

import { createApp } from './app';
import { getEnv } from './config/env';
import { disconnectPrisma } from './repositories/prismaClient';
import { logError, logInfo } from './utils/logger';

/**
 * Validate configuration, assemble the app, and start listening on `PORT`.
 *
 * Configuration is validated first (Req 1.11): if `DATABASE_URL` is missing,
 * `getEnv()` throws before the server binds, so the process aborts rather than
 * serving traffic with an invalid configuration.
 */
function start(): void {
  // Fail-fast configuration validation (Req 1.10, 1.11).
  const env = getEnv();

  const app = createApp();

  const server = app.listen(env.port, () => {
    logInfo('Backend server started', { port: env.port });
  });

  // Release the database connection pool and stop accepting connections on a
  // termination signal so the process exits cleanly.
  const shutdown = (signal: string): void => {
    logInfo('Shutting down backend server', { signal });
    server.close(() => {
      void disconnectPrisma().finally(() => {
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  start();
} catch (error) {
  // A configuration/startup failure is fatal: record it and exit non-zero so
  // the platform surfaces a failed deploy rather than a silent, broken process.
  logError('Backend failed to start', {
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}
