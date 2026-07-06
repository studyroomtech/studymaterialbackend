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
