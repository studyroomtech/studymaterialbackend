// Payment service — order initiation, verification, and webhook handling
// (Req 6.10, 12.4, 12.6–12.11, 12.14, 12.15, 12.18, 12.19, 12.21–12.24).
//
// This service coordinates the three backend steps of the Razorpay payment
// flow, keeping server-side signature verification as the sole path to a
// Payment Entitlement (Req 12.15, 12.21):
//
//   1. `initiatePayment(token, materialId)` — resolves the Learner's User
//      Record from a learner Access Token (else 401, Req 6.10), rejects a Free
//      Material (422 PAYMENT_NOT_REQUIRED, Req 12.10) and an already-entitled
//      Learner (409 ALREADY_ENTITLED, Req 12.11) BEFORE creating any Razorpay
//      order, then creates the order and persists a Payment Record with status
//      `created` and an ISO 8601 `createdAt`, returning the order details with
//      the public keyId (Req 12.4, 12.9).
//
//   2. `verifyPayment(confirmation)` — looks up the Payment Record by its
//      Razorpay Order Identifier (a missing record is a verification failure
//      with no Entitlement, Req 12.18), runs server-side Payment Signature
//      Verification, and only on an exact match transitions the record to
//      `successful`, records the Razorpay Payment Identifier, and upserts a
//      Payment Entitlement (Req 12.6, 12.8). An invalid signature transitions
//      the record to `failed` and grants nothing (Req 12.7). A persistence
//      failure is logged with a timestamp and grants no Entitlement (Req 12.14).
//
//   3. `handleWebhook(rawBody, signature)` — verifies the webhook signature
//      over the exact raw body FIRST and rejects an unverified event without
//      changing any data (Req 12.19, 12.24); on a verified `payment.captured`
//      event it idempotently marks the matching Payment Record `successful` and
//      ensures the Entitlement exists (Req 12.19).
//
// Persistence, order creation, signature verification, and token verification
// are reached only through the injected `PaymentServiceDeps`, so the service
// logic stays independent of Prisma, the Razorpay SDK, and JWT and can be
// property-tested over small in-memory fakes. Failures surface as typed domain
// errors the errorHandler maps to the unified envelope without leaking
// internals (Req 8.4).

import RazorpaySdk from "razorpay";

import { ROLE_COMMON } from "../constants/roles.constant";
import {
  DEFAULT_CURRENCY,
  PAISE_PER_RUPEE,
  PAYMENT_STATUS,
} from "../constants/payment.constant";
import {
  AuthRequiredError,
  AlreadyEntitledError,
  InternalError,
  NotFoundError,
  PaymentNotRequiredError,
  PaymentVerificationFailedError,
  WebhookVerificationFailedError,
} from "../utils/errors";
import { logError } from "../utils/logger";
import { getEnv } from "../config/env";
import { classifyPrice } from "./price.service";
import {
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpay.service";
import { verifyToken } from "./token.service";
import * as paymentRepository from "../repositories/payment.repository";
import * as entitlementRepository from "../repositories/entitlement.repository";
import * as materialRepository from "../repositories/material.repository";
import * as userRepository from "../repositories/user.repository";
import { WEBHOOK_EVENT_PAYMENT_CAPTURED } from "./payment.service.constant";
import type { PaymentSignatureInput } from "./razorpay.service.types";
import type {
  ParsedWebhookEvent,
  PaymentOrderResult,
  PaymentService,
  PaymentServiceDeps,
  PaymentVerifyResult,
  WebhookHandlingResult,
} from "./payment.service.types";

// --- Pure helpers (no I/O) ------------------------------------------------

/**
 * Parse the service-relevant fields out of a raw Razorpay Webhook body without
 * performing any I/O (Req 12.19). Returns the event name plus, for a
 * `payment.captured` event, the Razorpay Order and Payment Identifiers found at
 * `payload.payment.entity.{order_id,id}`. Returns `null` when the body is not
 * JSON-parseable or lacks a string `event`, so the caller treats it as an
 * unactionable (but signature-verified) no-op.
 */
export function parseWebhookEvent(
  rawBody: string | Buffer,
): ParsedWebhookEvent | null {
  let parsed: unknown;
  try {
    const text =
      typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const body = parsed as {
    event?: unknown;
    payload?: {
      payment?: { entity?: { id?: unknown; order_id?: unknown } };
    };
  };

  if (typeof body.event !== "string") {
    return null;
  }

  const entity = body.payload?.payment?.entity;
  const razorpayOrderId =
    entity !== undefined && typeof entity.order_id === "string"
      ? entity.order_id
      : null;
  const razorpayPaymentId =
    entity !== undefined && typeof entity.id === "string" ? entity.id : null;

  return { event: body.event, razorpayOrderId, razorpayPaymentId };
}

// --- Service factory ------------------------------------------------------

/**
 * Construct the Payment service over the injected collaborators. The
 * controller/wiring layer supplies the concrete Prisma repositories, Razorpay
 * order creator, signature verifiers, and token service (see
 * `createDefaultPaymentService`).
 */
export function createPaymentService(deps: PaymentServiceDeps): PaymentService {
  const { payments, entitlements, materials, users } = deps;

  /**
   * Resolve the Learner's User Record from a learner Access Token, or throw a
   * 401 so the frontend re-shows the Download Gate to collect a valid email
   * (Req 6.10). An admin token, a missing/invalid/expired token, or a token
   * whose User Record no longer resolves all fail closed.
   */
  async function resolveLearner(
    token: string,
  ): Promise<{ id: string; email: string }> {
    const claims = deps.verifyToken(token);
    if (
      claims === null ||
      claims.role !== ROLE_COMMON ||
      typeof claims.sub !== "string"
    ) {
      throw new AuthRequiredError(
        "A valid email is required to initiate a Payment.",
      );
    }
    const user = await users.findUserById(claims.sub);
    if (user === null) {
      throw new AuthRequiredError(
        "A valid email is required to initiate a Payment.",
      );
    }
    return user;
  }

  /**
   * Initiate a Payment for a Paid Material (Req 6.10, 12.4, 12.10, 12.11).
   *
   * Enforces every precondition BEFORE creating a Razorpay order: the Learner
   * must resolve from the Access Token (else 401, Req 6.10); the material must
   * exist (else 404); a Free Material is rejected with 422 PAYMENT_NOT_REQUIRED
   * (Req 12.10); an already-entitled Learner is rejected with 409
   * ALREADY_ENTITLED (Req 12.11). Only then is a Razorpay order created and a
   * Payment Record persisted with status `created` and an ISO 8601 `createdAt`
   * (Req 12.4, 12.9). A persistence failure is logged with a timestamp and no
   * Entitlement is granted (Req 12.14).
   */
  async function initiatePayment(
    token: string,
    studyMaterialIds: string[],
  ): Promise<PaymentOrderResult> {
    const user = await resolveLearner(token);

    // De-duplicate the requested materials, preserving order.
    const requestedIds = Array.from(new Set(studyMaterialIds));
    if (requestedIds.length === 0) {
      throw new PaymentNotRequiredError();
    }

    // Resolve every requested material, summing the chargeable ones. A material
    // that doesn't exist → 404; a Free Material is skipped (nothing to charge);
    // an already-entitled material is skipped (no double charge, Req 12.11).
    let currency = DEFAULT_CURRENCY;
    let totalRupees = 0;
    const chargeableIds: string[] = [];

    for (const id of requestedIds) {
      const material = await materials.findMaterialById(id);
      if (material === null) {
        throw new NotFoundError(
          `The requested Study Material '${id}' was not found.`,
        );
      }
      if (classifyPrice(material.priceAmount) === 'free') {
        continue;
      }
      const existing = await entitlements.findEntitlement(user.id, id);
      if (existing !== null) {
        continue;
      }
      currency = material.currency ?? DEFAULT_CURRENCY;
      totalRupees += material.priceAmount as number;
      chargeableIds.push(id);
    }

    // Nothing chargeable remains: either every item is Free (no payment
    // required) or the Learner is already entitled to all of them (Req 12.10,
    // 12.11).
    if (chargeableIds.length === 0) {
      throw new AlreadyEntitledError();
    }

    // Prices are whole rupees; Razorpay charges in paise, so convert at this
    // boundary — the paise total is what we send to Razorpay, persist, and hand
    // to the checkout so all three agree (Req 12.4).
    const amountInPaise = totalRupees * PAISE_PER_RUPEE;

    // Persist the Payment Record with status `created` (Req 12.4, 12.9). A
    // persistence failure is logged with a timestamp; no Entitlement is granted
    // (Req 12.14).
    let payment;
    try {
      // Razorpay caps `receipt` at 40 chars, so build a short cart receipt.
      const order = await deps.createOrder({
        amount: amountInPaise,
        currency,
        receipt: `cart_${user.id.slice(-12)}_${Date.now().toString(36)}`,
      });

      payment = await payments.createPayment({
        userId: user.id,
        studyMaterialIds: chargeableIds,
        amount: amountInPaise,
        currency,
        razorpayOrderId: order.id,
      });
    } catch (error) {
      logError('Failed to persist Payment Record on initiation', {
        userId: user.id,
        studyMaterialIds: chargeableIds,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalError();
    }

    return {
      paymentId: payment.id,
      razorpayOrderId: payment.razorpayOrderId,
      studyMaterialIds: payment.studyMaterialIds,
      amount: payment.amount,
      currency: payment.currency,
      razorpayKeyId: deps.razorpayKeyId,
    };
  }

  /**
   * Best-effort transition of a Payment Record to `failed` (Req 12.7). A
   * persistence failure is logged with a timestamp (Req 12.14) but never
   * surfaces as anything other than the verification failure the caller is
   * already reporting — no Entitlement is granted either way.
   *
   * An already-`successful` Payment Record is never downgraded: once a genuine
   * verification (via `verify` or the webhook) has granted an Entitlement, a
   * later confirmation carrying a bad signature must not flip the record back to
   * `failed`, so the earlier success — and the Entitlement it granted — stays
   * intact (Req 12.8, 12.19).
   */
  async function markFailedQuietly(payment: {
    id: string;
    status: string;
  }): Promise<void> {
    if (payment.status === PAYMENT_STATUS.SUCCESSFUL) {
      return;
    }
    try {
      await payments.updatePaymentStatus(payment.id, {
        status: PAYMENT_STATUS.FAILED,
      });
    } catch (error) {
      logError("Failed to persist Payment Record failure transition", {
        paymentId: payment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Verify a Payment confirmation server-side — the sole determinant of the
   * Payment outcome and Entitlement (Req 12.15, 12.21).
   *
   * Resolves the Payment Record by its Razorpay Order Identifier first; a
   * missing record is treated as verification failure with no Entitlement
   * (Req 12.18). Payment Signature Verification then recomputes and
   * constant-time-compares the signature (Req 12.16): on an exact match the
   * record transitions to `successful`, the Razorpay Payment Identifier is
   * recorded, and a Payment Entitlement is upserted (Req 12.6, 12.8); a
   * mismatch transitions the record to `failed` and grants nothing (Req 12.7,
   * 12.22). A persistence failure while granting is logged with a timestamp and
   * grants no Entitlement (Req 12.14).
   */
  async function verifyPayment(
    input: PaymentSignatureInput,
  ): Promise<PaymentVerifyResult> {
    const payment = await payments.findPaymentByRazorpayOrderId(
      input.razorpayOrderId,
    );
    // No matching Payment Record → verification failed, no Entitlement (Req 12.18).
    if (payment === null) {
      throw new PaymentVerificationFailedError();
    }

    const verified = deps.verifyPaymentSignature(input);
    if (!verified) {
      // Invalid signature → mark failed, grant nothing (Req 12.7, 12.22).
      await markFailedQuietly(payment);
      throw new PaymentVerificationFailedError();
    }

    // Verified → mark successful, record paymentId, grant Entitlement
    // (Req 12.6, 12.8). Idempotent: re-verifying a successful Payment upserts
    // the same Entitlement and re-marks the same status (Req 12.19).
    try {
      await payments.updatePaymentStatus(payment.id, {
        status: PAYMENT_STATUS.SUCCESSFUL,
        razorpayPaymentId: input.razorpayPaymentId,
      });
      // Grant one Entitlement per covered material; upsert keeps it idempotent
      // so re-verifying (or the webhook) creates no duplicates (Req 12.8, 12.19).
      for (const studyMaterialId of payment.studyMaterialIds) {
        await entitlements.upsertEntitlement({
          userId: payment.userId,
          studyMaterialId,
          paymentId: payment.id,
        });
      }
    } catch (error) {
      // Req 12.14: log the persistence failure with a timestamp and grant no
      // Entitlement.
      logError("Failed to persist verified Payment / Entitlement", {
        paymentId: payment.id,
        userId: payment.userId,
        studyMaterialIds: payment.studyMaterialIds,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalError();
    }

    return {
      verified: true,
      status: PAYMENT_STATUS.SUCCESSFUL,
      studyMaterialIds: payment.studyMaterialIds,
      entitled: true,
    };
  }

  /**
   * Handle a Razorpay Webhook event (Req 12.19, 12.24).
   *
   * The webhook signature is verified over the exact raw body FIRST; an
   * unverified event is rejected with a 400 and changes no stored data
   * (Req 12.19, 12.24). On a verified `payment.captured` event whose order
   * resolves to a Payment Record, the record is idempotently marked `successful`
   * and the Entitlement is ensured (Req 12.19). A verified event that is not a
   * `payment.captured`, that lacks an order id, or whose order has no Payment
   * Record is a safe no-op.
   */
  async function handleWebhook(
    rawBody: string | Buffer,
    signature: string,
  ): Promise<WebhookHandlingResult> {
    // Signature verification gates all action (Req 12.19, 12.24).
    if (!deps.verifyWebhookSignature(rawBody, signature)) {
      throw new WebhookVerificationFailedError();
    }

    const parsed = parseWebhookEvent(rawBody);
    if (parsed === null) {
      return { handled: false, event: null };
    }

    // Only a captured-payment event with a resolvable order triggers a grant.
    if (
      parsed.event !== WEBHOOK_EVENT_PAYMENT_CAPTURED ||
      parsed.razorpayOrderId === null
    ) {
      return { handled: false, event: parsed.event };
    }

    const payment = await payments.findPaymentByRazorpayOrderId(
      parsed.razorpayOrderId,
    );
    if (payment === null) {
      return { handled: false, event: parsed.event };
    }

    // Idempotently confirm the Payment Record and Entitlement (Req 12.19).
    try {
      await payments.updatePaymentStatus(payment.id, {
        status: PAYMENT_STATUS.SUCCESSFUL,
        ...(parsed.razorpayPaymentId !== null
          ? { razorpayPaymentId: parsed.razorpayPaymentId }
          : {}),
      });
      for (const studyMaterialId of payment.studyMaterialIds) {
        await entitlements.upsertEntitlement({
          userId: payment.userId,
          studyMaterialId,
          paymentId: payment.id,
        });
      }
    } catch (error) {
      logError("Failed to persist webhook-confirmed Payment / Entitlement", {
        paymentId: payment.id,
        userId: payment.userId,
        studyMaterialIds: payment.studyMaterialIds,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalError();
    }

    return {
      handled: true,
      event: parsed.event,
      studyMaterialIds: payment.studyMaterialIds,
    };
  }

  return { initiatePayment, verifyPayment, handleWebhook };
}

// --- Default wiring -------------------------------------------------------

/**
 * Construct the Payment service wired to the real Prisma-backed repositories,
 * the Razorpay SDK order creator, the server-side signature verifiers, and the
 * JWT token service, reading the public Razorpay key id from the environment.
 * Used by the controller layer in production (mirrors
 * `createDefaultDownloadService`). Thin adapters bridge the repository function
 * names to the service's dependency contracts.
 */
export function createDefaultPaymentService(): PaymentService {
  const env = getEnv();
  // Instantiate the Razorpay SDK once with the server-side credentials; the
  // Key Secret never leaves the Backend Project (Req 12.17).
  const razorpay = new RazorpaySdk({
    key_id: env.razorpay.keyId,
    key_secret: env.razorpay.keySecret,
  });

  return createPaymentService({
    payments: {
      createPayment: paymentRepository.createPayment,
      findPaymentByRazorpayOrderId:
        paymentRepository.findPaymentByRazorpayOrderId,
      updatePaymentStatus: paymentRepository.updatePaymentStatus,
    },
    entitlements: {
      findEntitlement: entitlementRepository.findEntitlement,
      upsertEntitlement: entitlementRepository.upsertEntitlement,
    },
    materials: {
      async findMaterialById(id) {
        const material = await materialRepository.findMaterialById(id);
        return material === null
          ? null
          : {
              id: material.id,
              priceAmount: material.priceAmount,
              currency: material.currency,
            };
      },
    },
    users: {
      async findUserById(id) {
        const user = await userRepository.findUserById(id);
        return user === null ? null : { id: user.id, email: user.email };
      },
    },
    async createOrder(input) {
      const order = await razorpay.orders.create({
        amount: input.amount,
        currency: input.currency,
        ...(input.receipt !== undefined ? { receipt: input.receipt } : {}),
      });
      return { id: String(order.id) };
    },
    verifyPaymentSignature: (input) => verifyPaymentSignature(input),
    verifyWebhookSignature: (rawBody, signature) =>
      verifyWebhookSignature(rawBody, signature),
    verifyToken,
    razorpayKeyId: env.razorpay.keyId,
  });
}
