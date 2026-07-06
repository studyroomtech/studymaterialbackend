// Public catalog route (Req 3.1, 3.10, 2.5).
//
// Wires `GET /api/catalog` through the authentication-resolution middleware and
// on to the catalog controller. The router is designed to be mounted at `/api`
// by the Express app assembly (task 9.4); it therefore declares its path
// relative to that mount point (`/catalog`).
//
// `auth.middleware` runs ahead of the handler so every caller is resolved to a
// Role (role_common by default) before the controller executes (Req 10.2). The
// catalog endpoint takes no request body, route params, or required query
// parameters, so no `validate` middleware is needed here.

import { Router } from 'express';

import { getCatalog } from '../controllers/catalog.controller';
import { authMiddleware } from '../middleware/auth.middleware';

/**
 * Router exposing the public Material Catalog endpoint. Mount at `/api` so the
 * effective route is `GET /api/catalog` (Req 3.1).
 */
const catalogRouter = Router();

catalogRouter.use(authMiddleware);
catalogRouter.get('/catalog', getCatalog);

export { catalogRouter };
export default catalogRouter;
