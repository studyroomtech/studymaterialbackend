// Constant values for the Cloudflare R2 storage adapter.
//
// Per the project conventions (Requirements 1.16, 1.17), all constant values
// live in a `*.constant.ts` file. These constants configure the S3-compatible
// client used to talk to Cloudflare R2 (Req 1.13, Req 11.1, Req 11.3).

/**
 * Cloudflare R2 is a single global namespace and does not use AWS regions, but
 * the S3-compatible SDK still requires a region value. Cloudflare's guidance is
 * to use the literal `'auto'`.
 */
export const R2_REGION = 'auto';

/**
 * R2 exposes an account-scoped endpoint (`https://<accountId>.r2.cloudflarestorage.com`)
 * and serves buckets via path-style addressing, so path-style is forced on the
 * client rather than relying on virtual-hosted-style bucket subdomains.
 */
export const R2_FORCE_PATH_STYLE = true;

/**
 * Content-Disposition disposition type used when presigning a download so the
 * browser saves the object as a file rather than rendering it inline.
 */
export const CONTENT_DISPOSITION_ATTACHMENT = 'attachment';

/**
 * Content-Disposition disposition type used when presigning a preview so the
 * browser renders the object inline (in an <iframe>/<object>) rather than
 * saving it as a file.
 */
export const CONTENT_DISPOSITION_INLINE = 'inline';

/**
 * Directory (relative to the backend project root) where object bytes are
 * written in local mode (`NODE_ENV=local`) instead of Cloudflare R2. Should be
 * gitignored.
 */
export const LOCAL_STORAGE_DIR = '.local-storage';

/**
 * Backend route path (mounted under `/api`) that serves locally-stored object
 * bytes for download in local mode. The presigned "URL" points here.
 */
export const LOCAL_FILES_ROUTE = '/files';

/** Query-parameter name carrying the download file name on local file URLs. */
export const LOCAL_FILE_NAME_PARAM = 'filename';

/**
 * Query-parameter name carrying the desired Content-Disposition (`inline` for a
 * preview) on local file URLs. Absent/any-other value serves as an attachment.
 */
export const LOCAL_DISPOSITION_PARAM = 'disposition';

/**
 * Query-parameter name carrying the object's Content-Type on local file URLs so
 * an inline preview is rendered with the correct type (e.g. `application/pdf`).
 */
export const LOCAL_CONTENT_TYPE_PARAM = 'contentType';

/** Content-Type used when serving locally-stored downloads (forces a download). */
export const LOCAL_DOWNLOAD_CONTENT_TYPE = 'application/octet-stream';
