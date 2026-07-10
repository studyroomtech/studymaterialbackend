// Backend environment configuration loading and fail-fast validation.
//
// Reads all infrastructure-dependent configuration from Environment Variables
// so the Platform deploys to Railway without code changes (Req 1.10). Boot is
// aborted with a log entry when the required `DATABASE_URL` is absent or empty
// (Req 1.11).
//
// Phase 2 scope: Razorpay credentials (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
// RAZORPAY_WEBHOOK_SECRET) are now REQUIRED. Their absence/emptiness aborts
// boot with a log entry identifying the missing key (Req 12.13).
//
// Note: `utils/logger.ts` does not exist yet (it is introduced in task 3.3),
// so the missing-configuration log entry is emitted via `console.error` with an
// ISO 8601 timestamp here.

import { logInfo } from '../utils/logger';
import {
  DEFAULT_ADMIN_TOKEN_TTL_SECONDS,
  DEFAULT_CORS_ORIGINS,
  DEFAULT_NODE_ENV,
  DEFAULT_PORT,
  DEFAULT_PRESIGNED_URL_TTL_SECONDS,
  DEFAULT_RECONCILE_BATCH_SIZE,
  DEFAULT_RECONCILE_FAIL_AFTER_WINDOW_HOURS,
  DEFAULT_RECONCILE_GRACE_WINDOW_MINUTES,
  ENV_KEYS,
  LOCAL_ENV,
  RECONCILE_BATCH_SIZE_BOUNDS,
  RECONCILE_FAIL_AFTER_WINDOW_BOUNDS,
  RECONCILE_GRACE_WINDOW_BOUNDS,
} from './env.constant';
import { EnvConfig } from './env.types';

/**
 * Reads a variable, returning `undefined` when it is absent or blank
 * (whitespace-only values are treated as empty).
 */
function readOptional(
  source: NodeJS.ProcessEnv,
  key: string
): string | undefined {
  const raw = source[key];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Logs the missing configuration key (Req 1.11) and throws to abort boot.
 */
function failMissing(key: string): never {
  const message = `Missing required environment variable: ${key}`;
  // ISO 8601 timestamp so the failure is traceable in deployment logs.
  console.error(`[${new Date().toISOString()}] [config/env] ${message}`);
  throw new Error(message);
}

/**
 * Parses a positive-integer variable, falling back to `fallback` when the value
 * is absent, blank, or not a positive integer.
 */
function readPositiveInt(
  source: NodeJS.ProcessEnv,
  key: string,
  fallback: number
): number {
  const value = readOptional(source, key);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Parses an integer variable constrained to the inclusive range `[min, max]`.
 *
 * When the value is absent, blank, not an integer, or outside the bounds, logs
 * a default-applied notice via `logInfo` (with the offending `key` and the
 * `appliedDefault`) and returns `fallback`. This keeps reconciliation tuning
 * non-fatal: invalid values never abort boot, they fall back to defaults with a
 * logged trace (Req 9.2, 9.3, 9.4).
 */
function readBoundedIntWithDefault(
  source: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = readOptional(source, key);
  const parsed = value === undefined ? NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    logInfo('Applied default for reconciliation configuration key', {
      key,
      appliedDefault: fallback,
    });
    return fallback;
  }
  return parsed;
}

/**
 * Parses the comma-separated `CORS_ORIGIN` value into a list of allowed
 * origins, trimming blanks. Falls back to the default local frontend origin
 * when unset or empty.
 */
function parseCorsOrigins(value: string | undefined): string[] {
  if (value === undefined) {
    return [...DEFAULT_CORS_ORIGINS];
  }
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : [...DEFAULT_CORS_ORIGINS];
}

/**
 * Loads and validates the backend configuration from the given source
 * (defaults to `process.env`).
 *
 * Fail-fast: throws (after logging) when `DATABASE_URL` is absent or empty
 * (Req 1.11), and when any required Razorpay credential (`RAZORPAY_KEY_ID`,
 * `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) is absent or empty
 * (Req 12.12, 12.13, 12.17).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  const databaseUrl = readOptional(source, ENV_KEYS.DATABASE_URL);
  if (databaseUrl === undefined) {
    failMissing(ENV_KEYS.DATABASE_URL);
  }

  // Phase 2: Razorpay credentials are required. Missing/empty values abort
  // boot with a log entry identifying the offending key (Req 12.13).
  const razorpayKeyId = readOptional(source, ENV_KEYS.RAZORPAY_KEY_ID);
  if (razorpayKeyId === undefined) {
    failMissing(ENV_KEYS.RAZORPAY_KEY_ID);
  }
  const razorpayKeySecret = readOptional(source, ENV_KEYS.RAZORPAY_KEY_SECRET);
  if (razorpayKeySecret === undefined) {
    failMissing(ENV_KEYS.RAZORPAY_KEY_SECRET);
  }
  const razorpayWebhookSecret = readOptional(
    source,
    ENV_KEYS.RAZORPAY_WEBHOOK_SECRET
  );
  if (razorpayWebhookSecret === undefined) {
    failMissing(ENV_KEYS.RAZORPAY_WEBHOOK_SECRET);
  }

  const nodeEnv = readOptional(source, ENV_KEYS.NODE_ENV) ?? DEFAULT_NODE_ENV;
  const isLocal = nodeEnv === LOCAL_ENV;
  const port = readPositiveInt(source, ENV_KEYS.PORT, DEFAULT_PORT);
  const publicBaseUrl =
    readOptional(source, ENV_KEYS.PUBLIC_BASE_URL) ??
    `http://localhost:${port}`;

  return {
    nodeEnv,
    isLocal,
    publicBaseUrl,
    databaseUrl,
    port,
    jwtSecret: readOptional(source, ENV_KEYS.JWT_SECRET) ?? '',
    adminTokenTtlSeconds: readPositiveInt(
      source,
      ENV_KEYS.ADMIN_TOKEN_TTL_SECONDS,
      DEFAULT_ADMIN_TOKEN_TTL_SECONDS
    ),
    r2: {
      accountId: readOptional(source, ENV_KEYS.R2_ACCOUNT_ID) ?? '',
      accessKeyId: readOptional(source, ENV_KEYS.R2_ACCESS_KEY_ID) ?? '',
      secretAccessKey: readOptional(source, ENV_KEYS.R2_SECRET_ACCESS_KEY) ?? '',
      bucket: readOptional(source, ENV_KEYS.R2_BUCKET) ?? '',
      endpoint: readOptional(source, ENV_KEYS.R2_ENDPOINT) ?? '',
    },
    presignedUrlTtlSeconds: readPositiveInt(
      source,
      ENV_KEYS.PRESIGNED_URL_TTL_SECONDS,
      DEFAULT_PRESIGNED_URL_TTL_SECONDS
    ),
    // Comma-separated allowed CORS origins; falls back to the local frontend
    // dev origin when unset so the two dev servers can talk cross-origin.
    corsOrigins: parseCorsOrigins(readOptional(source, ENV_KEYS.CORS_ORIGIN)),
    // Phase 2: required. Guaranteed non-empty by the fail-fast checks above.
    razorpay: {
      keyId: razorpayKeyId,
      keySecret: razorpayKeySecret,
      webhookSecret: razorpayWebhookSecret,
    },
    // Reconciliation tuning (Req 9). Optional; invalid values fall back to
    // defaults with a logged notice rather than aborting boot (Req 9.2–9.4).
    reconciliation: {
      graceWindowMinutes: readBoundedIntWithDefault(
        source,
        ENV_KEYS.RECONCILE_GRACE_WINDOW_MINUTES,
        DEFAULT_RECONCILE_GRACE_WINDOW_MINUTES,
        RECONCILE_GRACE_WINDOW_BOUNDS.min,
        RECONCILE_GRACE_WINDOW_BOUNDS.max
      ),
      failAfterWindowHours: readBoundedIntWithDefault(
        source,
        ENV_KEYS.RECONCILE_FAIL_AFTER_WINDOW_HOURS,
        DEFAULT_RECONCILE_FAIL_AFTER_WINDOW_HOURS,
        RECONCILE_FAIL_AFTER_WINDOW_BOUNDS.min,
        RECONCILE_FAIL_AFTER_WINDOW_BOUNDS.max
      ),
      batchSize: readBoundedIntWithDefault(
        source,
        ENV_KEYS.RECONCILE_BATCH_SIZE,
        DEFAULT_RECONCILE_BATCH_SIZE,
        RECONCILE_BATCH_SIZE_BOUNDS.min,
        RECONCILE_BATCH_SIZE_BOUNDS.max
      ),
    },
  };
}

let cached: EnvConfig | undefined;

/**
 * Returns the process-wide configuration, loading and caching it on first use.
 */
export function getEnv(): EnvConfig {
  if (cached === undefined) {
    cached = loadEnv();
  }
  return cached;
}
