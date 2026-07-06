// Local filesystem object-storage implementation (NODE_ENV=local).
//
// A drop-in replacement for the R2 adapter used during local development so the
// Platform can store and serve Study Material bytes without any cloud
// credentials (which is what fails when R2 keys are empty). Object bytes are
// written under `LOCAL_STORAGE_DIR` keyed by the Object Storage Key; the
// "presigned URL" is a Backend API URL (`/api/files/...`) that streams the
// bytes back for download. This module is selected by `storage.service.ts`
// when `env.isLocal` is true.

import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { getEnv } from '../config/env';
import {
  CONTENT_DISPOSITION_INLINE,
  LOCAL_CONTENT_TYPE_PARAM,
  LOCAL_DISPOSITION_PARAM,
  LOCAL_FILE_NAME_PARAM,
  LOCAL_FILES_ROUTE,
  LOCAL_STORAGE_DIR,
} from './storage.constant';
import type { StorageObjectBody } from './storage.types';

/** Absolute path to the local storage root (under the backend project cwd). */
function storageRoot(): string {
  return path.resolve(process.cwd(), LOCAL_STORAGE_DIR);
}

/**
 * Resolve an Object Storage Key to a safe absolute path inside the local
 * storage root, rejecting any key that would escape it (path traversal).
 */
function resolveObjectPath(objectKey: string): string {
  const root = storageRoot();
  const resolved = path.resolve(root, objectKey);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid object key.');
  }
  return resolved;
}

/**
 * Coerce the accepted body payloads to something `writeFile` handles. Streams
 * are supported by passing them straight through to `writeFile`.
 */
function toWritable(body: StorageObjectBody): Buffer | Uint8Array | string | Readable {
  return body;
}

/**
 * Store `body` on the local filesystem under `objectKey`, creating parent
 * directories as needed. `contentType` is accepted for parity with the R2
 * adapter but not persisted (local downloads are served as attachments).
 */
export async function putObject(
  objectKey: string,
  body: StorageObjectBody,
  _contentType: string,
): Promise<void> {
  const filePath = resolveObjectPath(objectKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, toWritable(body));
}

/**
 * Delete the locally-stored object under `objectKey`. Idempotent: removing a
 * key that does not exist resolves without error (mirrors R2/S3 semantics).
 */
export async function deleteObject(objectKey: string): Promise<void> {
  const filePath = resolveObjectPath(objectKey);
  await rm(filePath, { force: true });
}

/**
 * Return a Backend API URL that streams the locally-stored object for download.
 * The URL points at the `/api/files` route on `publicBaseUrl`; the file name is
 * carried as a query parameter so the route can set `Content-Disposition`.
 * Async for parity with the R2 presigner.
 */
export function getPresignedDownloadUrl(
  objectKey: string,
  fileName?: string,
): Promise<string> {
  const { publicBaseUrl } = getEnv();
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const query =
    fileName !== undefined
      ? `?${LOCAL_FILE_NAME_PARAM}=${encodeURIComponent(fileName)}`
      : '';
  return Promise.resolve(
    `${publicBaseUrl}/api${LOCAL_FILES_ROUTE}/${encodedKey}${query}`,
  );
}

/**
 * Return a Backend API URL that serves the locally-stored object inline for
 * preview. Carries `disposition=inline` and the object's `contentType` so the
 * files route renders it in-browser (e.g. a PDF/image) rather than prompting a
 * download. Async for parity with the R2 presigner.
 */
export function getPresignedPreviewUrl(
  objectKey: string,
  fileName?: string,
  contentType?: string,
): Promise<string> {
  const { publicBaseUrl } = getEnv();
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const params = new URLSearchParams();
  params.set(LOCAL_DISPOSITION_PARAM, CONTENT_DISPOSITION_INLINE);
  if (fileName !== undefined) {
    params.set(LOCAL_FILE_NAME_PARAM, fileName);
  }
  if (contentType !== undefined && contentType.length > 0) {
    params.set(LOCAL_CONTENT_TYPE_PARAM, contentType);
  }
  return Promise.resolve(
    `${publicBaseUrl}/api${LOCAL_FILES_ROUTE}/${encodedKey}?${params.toString()}`,
  );
}

/**
 * Open a read stream for a locally-stored object, or `null` when it does not
 * exist. Used by the local files route to serve download bytes.
 */
export async function openObjectStream(
  objectKey: string,
): Promise<Readable | null> {
  const filePath = resolveObjectPath(objectKey);
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  return createReadStream(filePath);
}
