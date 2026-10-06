import multer, { MulterError } from 'multer';
import type { NextFunction, Request, Response } from 'express';

import {
  MAX_MATERIAL_FILES_PER_REQUEST,
  MAX_MATERIAL_FILE_SIZE_BYTES,
} from '../constants/limits.constant';
import { ValidationError } from '../utils/errors';
import {
  MATERIAL_FILES_FIELD,
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

const parseFileParts = upload.array(
  MATERIAL_FILES_FIELD,
  MAX_MATERIAL_FILES_PER_REQUEST,
);

function toFilesValidationError(error: MulterError): ValidationError {
  const reason = UPLOAD_LIMIT_REASONS[error.code] ?? UPLOAD_REJECTED_REASON;
  return new ValidationError(undefined, [
    { field: MATERIAL_FILES_FIELD, reason },
  ]);
}

export function uploadMaterialFiles(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  parseFileParts(req, res, (error: unknown): void => {
    if (error instanceof MulterError) {
      next(toFilesValidationError(error));
      return;
    }
    next(error);
  });
}
