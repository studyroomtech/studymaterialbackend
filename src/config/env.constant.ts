// Constant values for backend environment configuration.
//
// Per the project conventions (Requirements 1.16, 1.17), all constant values
// live in a `*.constant.ts` file. This module defines the Environment Variable
// key names and the fallback defaults used by `config/env.ts`.

/**
 * Canonical Environment Variable key names read by the backend at startup.
 */
export const ENV_KEYS = {
  NODE_ENV: 'NODE_ENV',
  PUBLIC_BASE_URL: 'PUBLIC_BASE_URL',
  DATABASE_URL: 'DATABASE_URL',
  PORT: 'PORT',
  JWT_SECRET: 'JWT_SECRET',
  ADMIN_TOKEN_TTL_SECONDS: 'ADMIN_TOKEN_TTL_SECONDS',
  R2_ACCOUNT_ID: 'R2_ACCOUNT_ID',
  R2_ACCESS_KEY_ID: 'R2_ACCESS_KEY_ID',
  R2_SECRET_ACCESS_KEY: 'R2_SECRET_ACCESS_KEY',
  R2_BUCKET: 'R2_BUCKET',
  R2_ENDPOINT: 'R2_ENDPOINT',
  PRESIGNED_URL_TTL_SECONDS: 'PRESIGNED_URL_TTL_SECONDS',
  // Comma-separated browser origins allowed to call the API (CORS).
  CORS_ORIGIN: 'CORS_ORIGIN',
  // Razorpay keys are required in Phase 2; boot fails when any is missing
  // (Req 12.12, 12.13, 12.17).
  RAZORPAY_KEY_ID: 'RAZORPAY_KEY_ID',
  RAZORPAY_KEY_SECRET: 'RAZORPAY_KEY_SECRET',
  RAZORPAY_WEBHOOK_SECRET: 'RAZORPAY_WEBHOOK_SECRET',
  // Payment reconciliation tuning (Phase 3). All optional; invalid values fall
  // back to defaults with a logged notice (Req 9.2, 9.3, 9.4).
  RECONCILE_GRACE_WINDOW_MINUTES: 'RECONCILE_GRACE_WINDOW_MINUTES',
  RECONCILE_FAIL_AFTER_WINDOW_HOURS: 'RECONCILE_FAIL_AFTER_WINDOW_HOURS',
  RECONCILE_BATCH_SIZE: 'RECONCILE_BATCH_SIZE',
} as const;

/** Default HTTP listen port when `PORT` is not provided. */
export const DEFAULT_PORT = 4001;

/**
 * `NODE_ENV` value that selects local development infrastructure: local
 * filesystem object storage instead of Cloudflare R2 (the database is always
 * whatever `DATABASE_URL` points at). Any other value uses hosted R2.
 */
export const LOCAL_ENV = 'local';

/** Default `NODE_ENV` when the variable is not provided. */
export const DEFAULT_NODE_ENV = 'development';

/**
 * Default browser origin allowed to call the API (CORS) when `CORS_ORIGIN` is
 * not provided — the local frontend dev server on port 4000.
 */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:4000'] as const;

/** Default admin session lifetime (1 hour) when not provided. */
export const DEFAULT_ADMIN_TOKEN_TTL_SECONDS = 3600;

/** Default presigned-URL lifetime (15 minutes) when not provided. */
export const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 900;

/**
 * Default Grace Window (minutes) before a `created` payment is considered
 * stale and eligible for reconciliation, when the variable is not provided
 * (Req 9.2).
 */
export const DEFAULT_RECONCILE_GRACE_WINDOW_MINUTES = 10;

/**
 * Default Fail-After Window (hours) after which a `created` payment with no
 * captured Razorpay payment is marked `failed`, when not provided (Req 9.3).
 */
export const DEFAULT_RECONCILE_FAIL_AFTER_WINDOW_HOURS = 24;

/**
 * Default maximum number of stale payments reconciled per run, when not
 * provided (Req 9.4).
 */
export const DEFAULT_RECONCILE_BATCH_SIZE = 100;

/** Inclusive bounds for the Grace Window (minutes): 1 minute to 24 hours (Req 9.2). */
export const RECONCILE_GRACE_WINDOW_BOUNDS = { min: 1, max: 1440 } as const;

/** Inclusive bounds for the Fail-After Window (hours): 1 hour to 7 days (Req 9.3). */
export const RECONCILE_FAIL_AFTER_WINDOW_BOUNDS = { min: 1, max: 168 } as const;

/** Inclusive bounds for the Batch Size: 1 to 1000 records per run (Req 9.4). */
export const RECONCILE_BATCH_SIZE_BOUNDS = { min: 1, max: 1000 } as const;
