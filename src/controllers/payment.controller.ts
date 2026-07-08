// Payment controller — Paid Materials listing and the Razorpay payment flow
// (Req 12.1, 12.4, 12.5, 12.6, 12.7, 12.19).
//
// Shapes the HTTP surface of the paid-content endpoints, holding no business
// logic of its own — order creation, server-side signature verification,
// Payment Record transitions, and Entitlement grants all live in
// `payment.service.ts`, and Price classification lives in the pure
// `price.service.ts`:
//
//   - `GET /api/materials/paid` — list the Paid Materials for the Paid
//     Materials Tab, returning each material's Price and Currency but never any
//     file bytes, Object Storage Key, or presigned URL; content access stays
//     gated by a Payment Entitlement (Req 12.1, 12.3). Public (role_common).
//   - `POST /api/materials/:id/payment` — initiate a Payment: resolve the
//     Learner from the Bearer Access Token, enforce the Free / already-entitled
//     preconditions, create a Razorpay order, and persist a Payment Record,
//     returning the order details plus the public Razorpay key id (Req 12.4,
//     12.5). A missing/invalid learner token surfaces as a 401 (Req 6.10).
//   - `POST /api/payments/verify` — confirm a Payment via server-side Payment
//     Signature Verification, the sole path to a Payment Entitlement (Req 12.6,
//     12.7, 12.15).
//   - `POST /api/payments/webhook` — handle an optional Razorpay Webhook,
//     verifying the `X-Razorpay-Signature` over the RAW request body before
//     acting (Req 12.19). The route wiring (task 19.5) MUST supply the raw body
//     (for example via `express.raw`) so the signature is computed over the
//     exact bytes Razorpay signed; this handler reads that raw body verbatim.
//
// Like `download.controller.ts`, the learner-facing handlers extract the raw
// JWT from an `Authorization: Bearer <token>` header and let the service map an
// absent/invalid credential to the appropriate auth error.

import type { NextFunction, Request, Response } from 'express';

import { listMaterials } from '../repositories/material.repository';
import { listEntitledMaterialIds } from '../repositories/entitlement.repository';
import { createDefaultPaymentService } from '../services/payment.service';
import { classifyPrice } from '../services/price.service';
import { DEFAULT_CURRENCY } from '../constants/payment.constant';
import type { MaterialWithTags } from '../repositories/material.repository.types';
import type {
  PaidMaterialDto,
  PaidMaterialsResponse,
  PaymentInitiateResponse,
  PaymentVerifyRequest,
  PaymentVerifyResponse,
  PaymentWebhookResponse,
} from '../types/api.types';

const BEARER_PREFIX = 'Bearer ';
const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';

/**
 * Extract the raw JWT from an `Authorization: Bearer <token>` header, returning
 * an empty string when the header is absent or is not a non-empty Bearer
 * credential (mirrors `download.controller.ts`). The payment service treats an
 * empty/invalid token as an auth failure and returns a 401 so the frontend can
 * re-run the Download Gate to collect a valid email (Req 6.10).
 */
function extractBearerToken(header: string | undefined): string {
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    return '';
  }
  return header.slice(BEARER_PREFIX.length).trim();
}

/**
 * Read the `X-Razorpay-Signature` header as a single string, coalescing an
 * absent or repeated (array) header to an empty string so the service treats it
 * as an unverifiable signature and rejects the webhook (Req 12.19).
 */
function extractWebhookSignature(value: string | string[] | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

/**
 * Map a persisted Paid Study Material to its browse-time listing DTO,
 * exposing only the safe metadata plus the Price and Currency (Req 12.1). The
 * Object Storage Key and file bytes are never included. `priceAmount` is a
 * positive integer here because the caller has already filtered to Paid
 * Materials via `classifyPrice`.
 */
function toPaidMaterialDto(
  material: MaterialWithTags,
  entitledIds: ReadonlySet<string>,
): PaidMaterialDto {
  return {
    id: material.id,
    title: material.title,
    description: material.description,
    priceAmount: material.priceAmount as number,
    currency: material.currency ?? DEFAULT_CURRENCY,
    isPaid: true,
    isEntitled: entitledIds.has(material.id),
  };
}

/**
 * `GET /api/materials/paid` — list the Paid Materials for the Paid Materials
 * Tab with their Price and Currency (Req 12.1). Only materials that classify as
 * Paid (a positive Price amount) are included; Free Materials are omitted. The
 * response carries no file bytes or presigned URLs — content access remains
 * gated by a Payment Entitlement (Req 12.3).
 */
export async function listPaidMaterialsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const materials = await listMaterials();
    // Resolve the caller's existing entitlements (from their Access Token) so
    // already-purchased materials render View/Download instead of Buy (Req 12.3).
    const userId = req.auth.userId;
    const entitledIds = new Set<string>(
      userId !== undefined ? await listEntitledMaterialIds(userId) : [],
    );
    const paid = materials
      .filter((material) => classifyPrice(material.priceAmount) === 'paid')
      .map((material) => toPaidMaterialDto(material, entitledIds));
    const body: PaidMaterialsResponse = { materials: paid };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/materials/:id/payment` — initiate a Payment for a Paid Material
 * (Req 12.4, 12.5). Resolves the Learner from the Bearer Access Token and
 * delegates precondition enforcement, Razorpay order creation, and Payment
 * Record persistence to the payment service; returns the order details plus the
 * public Razorpay key id for presenting checkout. A missing/invalid token
 * surfaces as a 401 (Req 6.10); a Free Material as 422 (Req 12.10); an
 * already-entitled Learner as 409 (Req 12.11).
 */
export async function initiatePaymentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const order = await createDefaultPaymentService().initiatePayment(token, [
      req.params.id,
    ]);
    const body: PaymentInitiateResponse = {
      razorpayOrderId: order.razorpayOrderId,
      amount: order.amount,
      currency: order.currency,
      keyId: order.razorpayKeyId,
      studyMaterialIds: order.studyMaterialIds,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/payments/initiate` — initiate a Payment for a cart of Paid
 * Materials (Req 12.4, 12.5). The body carries the `studyMaterialIds`; the
 * service resolves the Learner, skips Free/already-entitled items, sums the
 * chargeable prices into a single Razorpay order, and persists one Payment
 * Record covering them. Returns the order details plus the public Razorpay key.
 */
export async function initiateCartPaymentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const { studyMaterialIds } = req.body as { studyMaterialIds: string[] };
    const order = await createDefaultPaymentService().initiatePayment(
      token,
      studyMaterialIds,
    );
    const body: PaymentInitiateResponse = {
      razorpayOrderId: order.razorpayOrderId,
      amount: order.amount,
      currency: order.currency,
      keyId: order.razorpayKeyId,
      studyMaterialIds: order.studyMaterialIds,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/payments/verify` — confirm a Payment via server-side Payment
 * Signature Verification (Req 12.6, 12.7, 12.15). The request body is untrusted
 * client input; the service grants an Entitlement only on an exact signature
 * match, otherwise it throws a `PaymentVerificationFailedError` (mapped to a
 * 400) and grants nothing (Req 12.7, 12.18).
 */
export async function verifyPaymentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } =
      req.body as PaymentVerifyRequest;
    const result = await createDefaultPaymentService().verifyPayment({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    });
    const body: PaymentVerifyResponse = {
      verified: result.verified,
      status: result.status,
      studyMaterialIds: result.studyMaterialIds,
      entitled: result.entitled,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/payments/webhook` — handle an optional Razorpay Webhook event
 * (Req 12.19). The service verifies the `X-Razorpay-Signature` over the exact
 * RAW request body FIRST and rejects an unverified event with a 400, changing
 * no stored data. The route wiring (task 19.5) MUST provide the raw body (for
 * example via `express.raw`) so `req.body` here is the exact bytes Razorpay
 * signed; the handler forwards it verbatim.
 */
export async function razorpayWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawBody: string | Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});
    const signature = extractWebhookSignature(
      req.headers[RAZORPAY_SIGNATURE_HEADER],
    );
    const result = await createDefaultPaymentService().handleWebhook(
      rawBody,
      signature,
    );
    const body: PaymentWebhookResponse = {
      received: true,
      handled: result.handled,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}
