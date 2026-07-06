// Type declarations for the Cloudflare R2 storage adapter.
//
// Per the project conventions (Requirements 1.15, 1.17), all interfaces and
// type aliases live in a `*.types.ts` file. These types describe the inputs to
// the storage service that wraps the S3-compatible R2 client.

import type { Readable } from 'node:stream';

/**
 * The set of body payloads the storage adapter accepts when storing an object.
 *
 * A `Buffer`/`Uint8Array`/`string` covers in-memory uploads (for example a file
 * buffered by the multipart middleware), while a `Readable` stream supports
 * streaming larger payloads to R2 without buffering them fully in memory. All
 * of these are valid `Body` inputs for the S3-compatible `PutObject` command.
 */
export type StorageObjectBody = Buffer | Uint8Array | string | Readable;
