// Cloudflare R2 (S3-compatible) client construction.
//
// R2 speaks the S3 API, so the AWS S3 SDK is pointed at the account-scoped R2
// endpoint using the R2 access-key credentials read from the environment
// (Req 1.13, Req 11.1). All credentials stay server-side; this module is never
// bundled into or referenced by the frontend.
//
// The client is created lazily and cached so a single connection pool is reused
// across requests. Because construction reads configuration through `getEnv()`,
// no network call is made until a command is actually sent, which keeps builds
// and typechecks free of any live-R2 dependency.

import { S3Client } from '@aws-sdk/client-s3';

import { getEnv } from '../config/env';
import { R2_FORCE_PATH_STYLE, R2_REGION } from './storage.constant';

let cachedClient: S3Client | undefined;

/**
 * Build a fresh `S3Client` configured for Cloudflare R2 from the current
 * environment configuration.
 */
export function createR2Client(): S3Client {
  const { r2 } = getEnv();
  return new S3Client({
    region: R2_REGION,
    endpoint: r2.endpoint,
    forcePathStyle: R2_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
  });
}

/**
 * Return the process-wide R2 client, constructing and caching it on first use.
 */
export function getR2Client(): S3Client {
  if (cachedClient === undefined) {
    cachedClient = createR2Client();
  }
  return cachedClient;
}
