// Types for the admin controller (Req 1.15: type/interface declarations live
// only in `*.types.ts`).
//
// These describe the request shapes the admin controller reads. The uploaded
// file is provided on the request by the multipart upload middleware wired into
// the admin material routes (task 9.3); its shape follows the common
// multer-style file object so the controller can build the service's
// `UploadedFile` without depending on the upload library here.

/**
 * A multipart-uploaded file as attached to the Express request by the upload
 * middleware. Mirrors the common multer file shape: the in-memory `buffer`
 * holds the bytes stored in Object Storage, and the remaining fields become the
 * Study Material's file metadata (Req 11.1).
 */
export interface UploadedRequestFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * An Express request that may carry a single multipart-uploaded `file`. The
 * upload middleware populates `file` on a successful upload; it is absent when
 * no file part was sent, in which case the material service rejects the upload
 * with a validation error naming the missing file (Req 11.2).
 */
export interface RequestWithFile {
  file?: UploadedRequestFile;
}
