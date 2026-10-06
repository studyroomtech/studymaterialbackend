import {
  MAX_MATERIAL_FILES_PER_REQUEST,
  MAX_MATERIAL_FILE_SIZE_BYTES,
} from '../constants/limits.constant';

export const MATERIAL_FILES_FIELD = 'files';

const BYTES_PER_MEGABYTE = 1024 * 1024;

const MAX_MATERIAL_FILE_SIZE_MEGABYTES =
  MAX_MATERIAL_FILE_SIZE_BYTES / BYTES_PER_MEGABYTE;

const FILE_TOO_LARGE_REASON = `each file must be ${MAX_MATERIAL_FILE_SIZE_MEGABYTES} MB or smaller.`;

const TOO_MANY_FILES_REASON = `at most ${MAX_MATERIAL_FILES_PER_REQUEST} files may be uploaded at once.`;

export const UPLOAD_LIMIT_REASONS: Readonly<Record<string, string>> = {
  LIMIT_FILE_SIZE: FILE_TOO_LARGE_REASON,
  LIMIT_FILE_COUNT: TOO_MANY_FILES_REASON,
  LIMIT_UNEXPECTED_FILE: TOO_MANY_FILES_REASON,
};

export const UPLOAD_REJECTED_REASON =
  'the uploaded files could not be processed.';
