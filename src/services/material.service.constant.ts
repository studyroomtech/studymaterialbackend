// Constant values for the Study Material service (Req 1.16: constant values
// live only in `*.constant.ts`).

/**
 * Prefix applied to every generated Object Storage Key so a Study Material's
 * file bytes are grouped under a predictable namespace within the R2 bucket
 * (Req 1.13, 11.1).
 */
export const MATERIAL_OBJECT_KEY_PREFIX = 'materials/';

/** Object Storage Key prefix for Study Material thumbnail images. */
export const THUMBNAIL_OBJECT_KEY_PREFIX = 'thumbnails/';

/**
 * Public path (relative to the API origin) that serves a thumbnail by id. The
 * DTO carries `${THUMBNAIL_PUBLIC_PATH}/<id>`; the Frontend prefixes its API
 * base URL.
 */
export const THUMBNAIL_PUBLIC_PATH = '/api/thumbnails';

/**
 * Accepted thumbnail formats, identified by their leading bytes (the client's
 * declared MIME type is not trusted). WebP is `RIFF????WEBP`, so its signature
 * is checked at two offsets.
 */
export const THUMBNAIL_SIGNATURES: readonly {
  contentType: string;
  parts: readonly { offset: number; bytes: readonly number[] }[];
}[] = [
  { contentType: 'image/jpeg', parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  {
    contentType: 'image/png',
    parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  {
    contentType: 'image/webp',
    parts: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
];

/** Multipart field name carrying thumbnail images. */
export const THUMBNAILS_FIELD = 'thumbnails';

/**
 * Cache policy for served thumbnails. A thumbnail's bytes never change for a
 * given id (replacing an image means a new id), so browsers may cache forever.
 */
export const THUMBNAIL_CACHE_CONTROL = 'public, max-age=31536000, immutable';
