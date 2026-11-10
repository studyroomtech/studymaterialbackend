import multer, { MulterError } from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  MAX_MATERIAL_FILES_PER_REQUEST,
  MAX_MATERIAL_FILE_SIZE_BYTES,
  MAX_THUMBNAIL_SIZE_BYTES,
  MAX_THUMBNAILS_PER_MATERIAL,
} from '../constants/limits.constant';
import { ValidationError } from '../utils/errors';
import {
  MATERIAL_FILES_FIELD,
  THUMBNAIL_FILES_FIELD,
  THUMBNAIL_UPLOAD_LIMIT_REASONS,
  UPLOAD_LIMIT_REASONS,
  UPLOAD_REJECTED_REASON,
} from './upload.middleware.constant';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MATERIAL_FILE_SIZE_BYTES,
    files: MAX_MATERIAL_FILES_PER_REQUEST,
  },
});

// Create-material requests carry both the PDFs and the optional thumbnails, so
// the total file-part limit covers both fields. The per-thumbnail 5 MB bound is
// enforced by the material service (multer has only one global size limit).
const uploadWithThumbnails = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MATERIAL_FILE_SIZE_BYTES,
    files: MAX_MATERIAL_FILES_PER_REQUEST + MAX_THUMBNAILS_PER_MATERIAL,
  },
});

const uploadThumbnails = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_THUMBNAIL_SIZE_BYTES,
    files: MAX_THUMBNAILS_PER_MATERIAL,
  },
});

function toFilesValidationError(error: MulterError): ValidationError {
  const field =
    error.field === THUMBNAIL_FILES_FIELD
      ? THUMBNAIL_FILES_FIELD
      : MATERIAL_FILES_FIELD;
  const reasons =
    field === THUMBNAIL_FILES_FIELD
      ? THUMBNAIL_UPLOAD_LIMIT_REASONS
      : UPLOAD_LIMIT_REASONS;
  const reason = reasons[error.code] ?? UPLOAD_REJECTED_REASON;
  return new ValidationError(undefined, [{ field, reason }]);
}

/** Wrap a multer parser so its limit errors become 422 validation errors. */
function withValidationErrors(parse: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    parse(req, res, (error: unknown): void => {
      if (error instanceof MulterError) {
        next(toFilesValidationError(error));
        return;
      }
      next(error);
    });
  };
}

/** Parses `files` (PDFs) into `req.files` as an array. */
export const uploadMaterialFiles = withValidationErrors(
  upload.array(MATERIAL_FILES_FIELD, MAX_MATERIAL_FILES_PER_REQUEST),
);

/**
 * Parses `files` and `thumbnails` into `req.files` as
 * `{ files?: File[]; thumbnails?: File[] }` (material create).
 */
export const uploadMaterialFilesWithThumbnails = withValidationErrors(
  uploadWithThumbnails.fields([
    { name: MATERIAL_FILES_FIELD, maxCount: MAX_MATERIAL_FILES_PER_REQUEST },
    { name: THUMBNAIL_FILES_FIELD, maxCount: MAX_THUMBNAILS_PER_MATERIAL },
  ]),
);

/** Parses `thumbnails` into `req.files` as an array (add thumbnails). */
export const uploadThumbnailFiles = withValidationErrors(
  uploadThumbnails.array(THUMBNAIL_FILES_FIELD, MAX_THUMBNAILS_PER_MATERIAL),
);
