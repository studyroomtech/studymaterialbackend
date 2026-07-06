// Local files route — serves locally-stored object bytes for download.
//
// Mounted at `/api`, this exposes `GET /api/files/*` where the wildcard is the
// Object Storage Key. It is only used in local mode (`NODE_ENV=local`); in
// hosted mode downloads go directly to a presigned R2 URL and never hit this
// route. The route is public (downloads are already gated by the download
// service before a URL is handed out).

import { Router } from 'express';

import { serveLocalFileHandler } from '../controllers/files.controller';
import { LOCAL_FILES_ROUTE } from '../storage/storage.constant';

const filesRouter = Router();

// `*` captures the full Object Storage Key (which may contain `/`) as params[0].
filesRouter.get(`${LOCAL_FILES_ROUTE}/*`, serveLocalFileHandler);

export { filesRouter };
export default filesRouter;
