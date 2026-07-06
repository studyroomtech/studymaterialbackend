// Local files controller — serves locally-stored object bytes for download.
//
// Only meaningful in local mode (`NODE_ENV=local`), where object bytes live on
// the filesystem and `storage.service.getPresignedDownloadUrl` returns a URL
// pointing at this route (`GET /api/files/*`). It streams the requested object
// back as an attachment. In hosted mode downloads go straight to a presigned
// R2 URL and never reach here.

import type { NextFunction, Request, Response } from 'express';

import { openObjectStream } from '../storage/localStorage';
import { NotFoundError } from '../utils/errors';
import {
  CONTENT_DISPOSITION_ATTACHMENT,
  CONTENT_DISPOSITION_INLINE,
  LOCAL_CONTENT_TYPE_PARAM,
  LOCAL_DISPOSITION_PARAM,
  LOCAL_DOWNLOAD_CONTENT_TYPE,
  LOCAL_FILE_NAME_PARAM,
} from '../storage/storage.constant';

/**
 * Build a `Content-Disposition: attachment` header value for `fileName`,
 * sanitizing the plain form and adding an RFC 5987 `filename*` for non-ASCII.
 */
function buildContentDisposition(fileName: string, disposition: string): string {
  const asciiFallback = fileName.replace(/["\\\r\n]/g, '_');
  const encoded = encodeURIComponent(fileName);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * `GET /api/files/*` — stream a locally-stored object for download. The Object
 * Storage Key is the wildcard portion of the path; an optional `filename` query
 * parameter sets the download name. A missing object yields a not-found error.
 */
export async function serveLocalFileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // The Object Storage Key is everything after `/files/` (may contain `/`).
    const objectKey = req.params[0] ?? '';
    const stream = await openObjectStream(objectKey);
    if (stream === null) {
      throw new NotFoundError('The requested file was not found.');
    }

    const fileNameParam = req.query[LOCAL_FILE_NAME_PARAM];
    const fileName = typeof fileNameParam === 'string' ? fileNameParam : undefined;

    // A preview request asks for inline rendering with the object's real
    // Content-Type; a plain download stays an octet-stream attachment.
    const dispositionParam = req.query[LOCAL_DISPOSITION_PARAM];
    const isInline = dispositionParam === CONTENT_DISPOSITION_INLINE;
    const contentTypeParam = req.query[LOCAL_CONTENT_TYPE_PARAM];
    const contentType =
      isInline && typeof contentTypeParam === 'string' && contentTypeParam.length > 0
        ? contentTypeParam
        : LOCAL_DOWNLOAD_CONTENT_TYPE;

    res.setHeader('Content-Type', contentType);
    if (fileName !== undefined && fileName.length > 0) {
      res.setHeader(
        'Content-Disposition',
        buildContentDisposition(
          fileName,
          isInline ? CONTENT_DISPOSITION_INLINE : CONTENT_DISPOSITION_ATTACHMENT,
        ),
      );
    }

    stream.on('error', next);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}
