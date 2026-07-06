// Object-storage service — dispatches to local or hosted storage.
//
// The Platform stores Study Material file bytes in object storage and serves
// downloads via short-lived URLs (Req 1.13, Req 11.1, Req 11.3). The concrete
// backend is selected by configuration:
//
//   - `NODE_ENV=local` (`env.isLocal`) → local filesystem (`localStorage.ts`),
//     so development needs no cloud credentials.
//   - otherwise → hosted Cloudflare R2 (`r2Storage.ts`).
//
// Callers (material/download services) import these three functions and are
// agnostic to which backend is active.

import { getEnv } from '../config/env';
import * as localStorage from './localStorage';
import * as r2Storage from './r2Storage';
import type { StorageObjectBody } from './storage.types';

/** Whether local filesystem storage is active (`NODE_ENV=local`). */
function useLocalStorage(): boolean {
  return getEnv().isLocal;
}

/**
 * Store `body` under `objectKey` with the given `contentType`, in the local
 * filesystem or hosted R2 depending on configuration.
 */
export async function putObject(
  objectKey: string,
  body: StorageObjectBody,
  contentType: string,
): Promise<void> {
  return useLocalStorage()
    ? localStorage.putObject(objectKey, body, contentType)
    : r2Storage.putObject(objectKey, body, contentType);
}

/** Delete the object stored under `objectKey` (idempotent). */
export async function deleteObject(objectKey: string): Promise<void> {
  return useLocalStorage()
    ? localStorage.deleteObject(objectKey)
    : r2Storage.deleteObject(objectKey);
}

/**
 * Return a short-lived download URL for `objectKey` — a presigned R2 URL when
 * hosted, or a Backend API `/api/files` URL when local. When `fileName` is
 * supplied the download is prompted under that name.
 */
export async function getPresignedDownloadUrl(
  objectKey: string,
  fileName?: string,
): Promise<string> {
  return useLocalStorage()
    ? localStorage.getPresignedDownloadUrl(objectKey, fileName)
    : r2Storage.getPresignedDownloadUrl(objectKey, fileName);
}

/**
 * Return a short-lived URL that serves `objectKey` inline for preview — a
 * presigned R2 URL (inline disposition + content type) when hosted, or a
 * Backend API `/api/files` URL carrying `disposition=inline` when local.
 */
export async function getPresignedPreviewUrl(
  objectKey: string,
  fileName?: string,
  contentType?: string,
): Promise<string> {
  return useLocalStorage()
    ? localStorage.getPresignedPreviewUrl(objectKey, fileName, contentType)
    : r2Storage.getPresignedPreviewUrl(objectKey, fileName, contentType);
}
