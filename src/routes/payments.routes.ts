// Payment routes — initiate, verify, and Razorpay webhook (Req 12.4–12.7, 12.19).
//
// Wires the three Razorpay payment endpoints, delegating all business logic to
// the payment controller (task 19.3). The router is designed to be mounted at
// `/api` by the Express app assembly (task 9.4), so paths are declared relative
// to that mount point — matching the initiate path `/materials/:id/payment`.
//
//   - `POST /api/materials/:id/payment` — initiate a Payment for a Paid
//     Material. Runs behind `authMiddleware` (so the caller's Role is resolved)
//     and Zod params validation before the controller resolves the Learner from
//     the Bearer Access Token, enforces the Free / already-entitled
//     preconditions, creates a Razorpay order, and persists a Payment Record
//     (Req 12.4, 12.5). A missing/invalid learner token surfaces as a 401.
//   - `POST /api/payments/verify` — confirm a Payment via server-side Payment
//     Signature Verification, the sole path to a Payment Entitlement (Req 12.6,
//     12.7). The untrusted confirmation body is validated before the controller
//     runs.
//   - `POST /api/payments/webhook` — handle an optional Razorpay Webhook event
//     (Req 12.19). The webhook signature is computed over the EXACT RAW request
//     body, so this route uses `express.raw` to capture the unparsed bytes as a
//     `Buffer` on `req.body`. The global `express.json()` parser in `app.ts` is
//     configured to SKIP this path, so the raw stream is never consumed before
//     this handler reads it. Every other route still receives parsed JSON.

import express, { Router } from 'express';
import { z } from 'zod';

import {
  initiateCartPaymentHandler,
  initiatePaymentHandler,
  initiateProductPaymentHandler,
  razorpayWebhookHandler,
  verifyPaymentHandler,
} from '../controllers/payment.controller';
import {
  PRODUCT_CART_MAX_ITEMS,
  PRODUCT_CART_MIN_ITEMS,
} from '../constants/limits.constant';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';

/**
 * Params schema for `POST /api/materials/:id/payment` — a non-empty material
 * id must be present before the controller runs (Req 12.4).
 */
const paymentParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * Body schema for `POST /api/payments/initiate` — a non-empty list of Paid
 * Material ids to check out as a cart (Req 12.4).
 */
const cartInitiateBodySchema = z.object({
  studyMaterialIds: z.array(z.string().min(1)).min(1),
});

/**
 * Body schema for `POST /api/payments/initiate-products` — a cart of 1–50
 * Test/Sectional-Test product references to check out. Each ref names a product
 * `type` (`test` | `section`) and a non-empty `id`; the service enforces the
 * remaining cart rules (no duplicates, all Paid, not already entitled)
 * (Req 7.1, 7.6).
 */
const productInitiateBodySchema = z.object({
  products: z
    .array(
      z.object({
        type: z.enum(['test', 'section']),
        id: z.string().min(1),
      }),
    )
    .min(PRODUCT_CART_MIN_ITEMS)
    .max(PRODUCT_CART_MAX_ITEMS),
});

/**
 * Body schema for `POST /api/payments/verify` — the untrusted Razorpay Checkout
 * confirmation. Each field must be a non-empty string before the controller
 * performs server-side Payment Signature Verification (Req 12.6, 12.15, 12.16).
 */
const verifyBodySchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

/**
 * Router exposing the payment initiate, verify, and webhook endpoints. Mount at
 * `/api` so the effective routes are `POST /api/materials/:id/payment`,
 * `POST /api/payments/verify`, and `POST /api/payments/webhook`.
 *
 * The webhook route applies `express.raw` locally so `req.body` is the exact
 * raw bytes Razorpay signed; the app assembly excludes this path from the
 * global JSON parser so those bytes are never consumed beforehand (Req 12.19).
 */
const paymentsRouter: Router = Router();

paymentsRouter.post(
  '/materials/:id/payment',
  authMiddleware,
  validate({ params: paymentParamsSchema }),
  initiatePaymentHandler,
);

paymentsRouter.post(
  '/payments/initiate',
  authMiddleware,
  validate({ body: cartInitiateBodySchema }),
  initiateCartPaymentHandler,
);

paymentsRouter.post(
  '/payments/initiate-products',
  authMiddleware,
  validate({ body: productInitiateBodySchema }),
  initiateProductPaymentHandler,
);

paymentsRouter.post(
  '/payments/verify',
  validate({ body: verifyBodySchema }),
  verifyPaymentHandler,
);

paymentsRouter.post(
  '/payments/webhook',
  express.raw({ type: '*/*' }),
  razorpayWebhookHandler,
);

export { paymentsRouter };
export default paymentsRouter;
