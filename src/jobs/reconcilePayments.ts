// Payment Reconciliation Job — one-shot entrypoint (task 5.1).
//
// Mirrors the bootstrap ordering of `src/index.ts`, but instead of starting an
// Express server it runs a single reconciliation batch and exits:
//   1. `getEnv()` first — validates configuration and fails fast when the
//      required `DATABASE_URL` / `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` are
//      absent, before any Payment Record is touched (Req 9.6, 9.7).
//   2. Assemble the Payment service via `createDefaultPaymentService()`.
//   3. Capture the run start time; all age comparisons are relative to it.
//   4. Reconcile one batch, then log the Run Summary (Req 8.1).
//   5. Disconnect Prisma and exit 0 on success (Req 1.2) / non-zero on a
//      batch-level error (Req 1.3, 8.3).
//
// Scheduling is delegated to a separate Railway Cron service (see design §6);
// this script owns no scheduling and starts no HTTP server.

import { getEnv } from '../config/env';
import { disconnectPrisma } from '../repositories/prismaClient';
import { createDefaultPaymentService } from '../services/payment.service';
import { logError, logInfo } from '../utils/logger';

/**
 * Validate configuration, run one reconciliation batch, and log the Run Summary.
 *
 * Configuration is validated first (Req 9.6, 9.7): if a required key is missing,
 * `getEnv()` throws before any Payment Record is read or written, so the run
 * aborts via the top-level `.catch` with a non-zero exit code.
 */
async function main(): Promise<void> {
  // Fail-fast configuration validation (Req 9.6, 9.7).
  const env = getEnv();

  const service = createDefaultPaymentService();
  const runStartTime = new Date();

  logInfo('Payment reconciliation run started', {
    runStartTime: runStartTime.toISOString(),
  });

  const summary = await service.reconcileBatch({
    runStartTime,
    graceWindowMinutes: env.reconciliation.graceWindowMinutes,
    failAfterWindowHours: env.reconciliation.failAfterWindowHours,
    batchSize: env.reconciliation.batchSize,
  });

  // Exactly one Run Summary per run (Req 8.1).
  logInfo('Payment reconciliation run summary', { ...summary });
}

main()
  .then(() => {
    // Batch completed (including a zero-record batch): release the connection
    // pool and exit 0 (Req 1.2).
    void disconnectPrisma().finally(() => {
      process.exit(0);
    });
  })
  .catch((error: unknown) => {
    // A batch-level error is fatal: log it, release the connection pool, and
    // exit non-zero so the Cron run surfaces as failed (Req 1.3, 8.3).
    logError('Payment reconciliation run failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    void disconnectPrisma().finally(() => {
      process.exit(1);
    });
  });
