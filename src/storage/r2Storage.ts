// Cloudflare R2 (hosted) object-storage implementation.
//
// Wraps the S3-compatible R2 client with the three operations the Platform
// needs: storing object bytes, deleting objects, and minting short-lived
// presigned GET URLs that let the browser download bytes directly from R2
// without the backend proxying them (Req 1.13, Req 11.1, Req 11.3).
//
// This module is selected by `storage.service.ts` when NOT running in local
// mode; in local mode the filesystem implementation in `localStorage.ts` is
// used instead.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { getEnv } from '../config/env';
import { getR2Client } from './r2Client';
import {
  CONTENT_DISPOSITION_ATTACHMENT,
  CONTENT_DISPOSITION_INLINE,
} from './storage.constant';
import type { StorageObjectBody } from './storage.types';

/**
 * Build a `Content-Disposition` header value that instructs the browser to save
 * the response as an attachment under `fileName`. Both the plain `filename` and
 * the RFC 5987 `filename*` forms are emitted so non-ASCII names survive; the
 * plain form is sanitized to strip characters that would break the header.
 */
function buildContentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/["\\\r\n]/g, '_');
  const encoded = encodeURIComponent(fileName);
  return `${CONTENT_DISPOSITION_ATTACHMENT}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Store `body` in R2 under `objectKey` with the given `contentType`. Overwrites
 * any existing object at the same key.
 */
export async function putObject(
  objectKey: string,
  body: StorageObjectBody,
  contentType: string,
): Promise<void> {
  const { r2 } = getEnv();
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Delete the object stored under `objectKey`. R2/S3 delete is idempotent, so
 * removing a key that does not exist resolves without error.
 */
export async function deleteObject(objectKey: string): Promise<void> {
  const { r2 } = getEnv();
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: r2.bucket,
      Key: objectKey,
    }),
  );
}

/**
 * Generate a presigned GET URL for `objectKey`, valid for
 * `presignedUrlTtlSeconds`. When `fileName` is supplied, the signed request
 * carries a `Content-Disposition` that prompts the browser to download the
 * object under that name.
 */
export async function getPresignedDownloadUrl(
  objectKey: string,
  fileName?: string,
): Promise<string> {
  const { r2, presignedUrlTtlSeconds } = getEnv();
  const command = new GetObjectCommand({
    Bucket: r2.bucket,
    Key: objectKey,
    ...(fileName !== undefined
      ? { ResponseContentDisposition: buildContentDisposition(fileName) }
      : {}),
  });
  return getSignedUrl(getR2Client(), command, {
    expiresIn: presignedUrlTtlSeconds,
  });
}

/**
 * Generate a presigned GET URL for `objectKey` that renders inline for preview,
 * valid for `presignedUrlTtlSeconds`. Sets an `inline` Content-Disposition
 * (optionally naming the file) and, when known, the object's Content-Type so
 * the browser displays it in-page rather than downloading it.
 */
export async function getPresignedPreviewUrl(
  objectKey: string,
  fileName?: string,
  contentType?: string,
): Promise<string> {
  const { r2, presignedUrlTtlSeconds } = getEnv();
  const disposition =
    fileName !== undefined
      ? `${CONTENT_DISPOSITION_INLINE}; filename="${fileName.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
      : CONTENT_DISPOSITION_INLINE;
  const command = new GetObjectCommand({
    Bucket: r2.bucket,
    Key: objectKey,
    ResponseContentDisposition: disposition,
    ...(contentType !== undefined && contentType.length > 0
      ? { ResponseContentType: contentType }
      : {}),
  });
  return getSignedUrl(getR2Client(), command, {
    expiresIn: presignedUrlTtlSeconds,
  });
}
