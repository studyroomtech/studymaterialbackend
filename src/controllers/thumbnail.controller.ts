// Thumbnail controller — serves Study Material thumbnail images publicly.
//
// `GET /api/thumbnails/:id` streams the stored image (local filesystem or R2)
// with the content type detected at upload and a long-lived immutable cache
// policy. Thumbnails are public preview images, so no auth or entitlement is
// checked; the route only ever resolves `MaterialThumbnail` rows, never note
// files.
import type { NextFunction, Request, Response } from 'express';

import { findMaterialThumbnail } from '../repositories/material.repository';
import { THUMBNAIL_CACHE_CONTROL } from '../services/material.service.constant';
import { openObjectStream } from '../storage/storage.service';
import { NotFoundError } from '../utils/errors';

export async function serveThumbnailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const thumbnail = await findMaterialThumbnail(req.params.id);
    const stream =
      thumbnail === null ? null : await openObjectStream(thumbnail.objectKey);
    if (thumbnail === null || stream === null) {
      throw new NotFoundError('The requested thumbnail was not found.');
    }
    res.setHeader('Content-Type', thumbnail.contentType);
    res.setHeader('Cache-Control', THUMBNAIL_CACHE_CONTROL);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.on('error', next);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}
