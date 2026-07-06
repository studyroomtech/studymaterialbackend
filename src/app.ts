// Express application assembly (task 9.4).
//
// This is the single place where the HTTP surface is composed: JSON body
// parsing, the public routers, the admin router, and — registered LAST — the
// central error handler so every thrown or forwarded error is mapped to the
// unified `{ error: { code, message, fields? } }` envelope (Req 8.4).
//
// Mount points follow the design's route table:
//   - Public routers (`catalog`, `materials`, `downloads`) mount at `/api`, so
//     their relative paths resolve to `/api/catalog`, `/api/materials/...`,
//     and `/api/downloads/...`.
//   - The admin router mounts at `/api/admin`, so its relative paths resolve to
//     `/api/admin/login`, `/api/admin/materials/...`, etc.
//
// Each router attaches its own `authMiddleware` (and, for admin routes,
// `requireAdmin`) at the router level, so authentication/authorization is
// resolved per request without any app-level wiring here.
//
// The paid-materials listing route rides on `materialsRouter`; the payment
// routes (initiate/verify/webhook) mount via `paymentsRouter` (task 19.5).
//
// The Razorpay webhook signature is verified over the EXACT RAW request body,
// so the global `express.json()` parser MUST NOT consume that path's stream.
// The JSON parser is therefore applied to every request EXCEPT the webhook
// path; `paymentsRouter` captures the webhook's raw bytes with `express.raw`.

import cors from 'cors';
import express, {
  Express,
  NextFunction,
  Request,
  Response,
} from 'express';

import { getEnv } from './config/env';
import { errorHandler } from './middleware/errorHandler.middleware';
import { rateLimit } from './middleware/rateLimit.middleware';
import { createAdminRouter } from './routes/admin.routes';
import accountRouter from './routes/account.routes';
import catalogRouter from './routes/catalog.routes';
import downloadsRouter from './routes/downloads.routes';
import filesRouter from './routes/files.routes';
import materialsRouter from './routes/materials.routes';
import paymentsRouter from './routes/payments.routes';

// The Razorpay webhook path whose raw body must reach `express.raw` unparsed.
const WEBHOOK_PATH = '/api/payments/webhook';

/**
 * Assembles the Express application: body parsing, health check, the public and
 * admin routers, and the central error handler registered LAST (Req 8.4).
 */
export function createApp(): Express {
  const app = express();

  // Behind Railway's proxy the socket peer is the proxy, not the client, so we
  // trust the `X-Forwarded-For` chain to recover the real client IP. This lets
  // the rate limiter key requests per client rather than lumping every caller
  // into a single proxy bucket.
  app.set('trust proxy', true);

  // Allow the configured browser origins (the frontend dev server) to call the
  // API cross-origin. The API is stateless and Bearer-token based (no cookies),
  // so credentials are not enabled. Methods and request headers are listed
  // explicitly so the JSON `Content-Type` + `Authorization` preflight is
  // allowed. Registered before every route so preflight `OPTIONS` requests are
  // answered too.
  const corsMiddleware = cors({
    origin: getEnv().corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });
  app.use(corsMiddleware);
  // Explicitly answer preflight `OPTIONS` for every route with the same policy.
  app.options('*', corsMiddleware);

  // Parse JSON request bodies before any router runs, EXCEPT the Razorpay
  // webhook path — its signature is computed over the exact raw bytes, so that
  // route captures the unparsed body via `express.raw` in `paymentsRouter`
  // (Req 12.19). Multipart material uploads are parsed per-route by `multer`
  // inside the admin router.
  const jsonParser = express.json();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === WEBHOOK_PATH) {
      next();
      return;
    }
    jsonParser(req, res, next);
  });

  // Lightweight liveness probe used by the platform health check.
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // Throttle the API surface: at most 30 requests per 10 seconds per client IP
  // (RATE_LIMIT_MAX_REQUESTS / RATE_LIMIT_WINDOW_MS). Over-budget requests are
  // rejected with 429 TOO_MANY_REQUESTS before any router runs. Mounted on
  // `/api` so the `/health` liveness probe stays unthrottled.
  app.use('/api', rateLimit);

  // Public API surface (each router resolves the caller's Role via its own
  // authMiddleware): catalog, material search/read, and the download gate.
  app.use('/api', catalogRouter);
  app.use('/api', materialsRouter);
  app.use('/api', downloadsRouter);
  app.use('/api', paymentsRouter);
  app.use('/api', accountRouter);
  // Local-mode download route (`GET /api/files/*`); unused in hosted mode.
  app.use('/api', filesRouter);

  // Admin API surface — Content Management Actions behind requireAdmin.
  app.use('/api/admin', createAdminRouter());

  // Central error handler — MUST be registered after all routes so both thrown
  // and next(err)-forwarded errors are mapped to the unified envelope (Req 8.4).
  app.use(errorHandler);

  return app;
}
