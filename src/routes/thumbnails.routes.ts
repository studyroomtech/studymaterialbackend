// Public thumbnail image route — `GET /api/thumbnails/:id`.
//
// Mounted at `/api` BEFORE the rate limiter: a home page renders many
// thumbnails at once and browsers cache each one permanently, so throttling
// these image requests would break first page loads.
import { Router } from 'express';
import { z } from 'zod';

import { serveThumbnailHandler } from '../controllers/thumbnail.controller';
import { validate } from '../middleware/validate.middleware';

const thumbnailParamsSchema = z.object({ id: z.string().min(1) });

const thumbnailsRouter: Router = Router();

thumbnailsRouter.get(
  '/thumbnails/:id',
  validate({ params: thumbnailParamsSchema }),
  serveThumbnailHandler,
);

export { thumbnailsRouter };
export default thumbnailsRouter;
