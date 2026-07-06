// Type declarations for backend environment configuration.
//
// Per the project conventions (Requirements 1.15, 1.17), all interfaces and
// type aliases live in a `*.types.ts` file. These types describe the shape of
// the validated configuration produced by `config/env.ts`.

/**
 * Cloudflare R2 (S3-compatible) object-storage credentials and location.
 */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

/**
 * Razorpay credentials.
 *
 * Phase 2 wires payment behavior, so these values are required and boot fails
 * when any is absent or empty (Requirements 12.12, 12.13, 12.17). The
 * `keySecret` and `webhookSecret` are held only in the Backend Project and are
 * never exposed to the Frontend Project or the browser (Req 12.17).
 */
export interface RazorpayConfig {
  /** Non-secret Razorpay Public Key Identifier used to present checkout. */
  keyId: string;
  /** Secret Razorpay credential; server-side only (Req 12.17). */
  keySecret: string;
  /** Secret used to verify Razorpay Webhook signatures; server-side only. */
  webhookSecret: string;
}

/**
 * The fully-resolved, validated backend configuration.
 */
export interface EnvConfig {
  /** The resolved `NODE_ENV` (e.g. "local", "development", "production"). */
  nodeEnv: string;
  /**
   * `true` when `NODE_ENV=local`: object storage uses the local filesystem
   * instead of Cloudflare R2. The database is always whatever `DATABASE_URL`
   * points at, so a local DB is selected simply by pointing `DATABASE_URL` at
   * localhost.
   */
  isLocal: boolean;
  /**
   * Public base URL of the Backend API, used to build local file-download URLs
   * in local mode (defaults to `http://localhost:<port>`).
   */
  publicBaseUrl: string;
  /** PostgreSQL connection string. Required; boot fails if missing (Req 1.10, 1.11). */
  databaseUrl: string;
  /** HTTP listen port (Req 1.10). */
  port: number;
  /** Secret used to sign/verify learner and admin JWTs. */
  jwtSecret: string;
  /** Admin session lifetime in seconds. */
  adminTokenTtlSeconds: number;
  /** Cloudflare R2 access configuration. */
  r2: R2Config;
  /** Lifetime of download presigned URLs in seconds. */
  presignedUrlTtlSeconds: number;
  /** Browser origins allowed to call the API (CORS). */
  corsOrigins: string[];
  /** Razorpay credentials (required in Phase 2). */
  razorpay: RazorpayConfig;
}
