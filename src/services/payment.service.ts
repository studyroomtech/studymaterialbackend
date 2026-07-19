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

import { ROLE_ADMIN, ROLE_COMMON } from "../constants/roles.constant";
import {
  DEFAULT_CURRENCY,
  PAISE_PER_RUPEE,
  PAYMENT_STATUS,
} from "../constants/payment.constant";
import {
  PRODUCT_CART_MAX_ITEMS,
  PRODUCT_CART_MIN_ITEMS,
} from "../constants/limits.constant";
import {
  AuthRequiredError,
  AlreadyEntitledError,
  InternalError,
  NotFoundError,
  PaymentNotRequiredError,
  PaymentVerificationFailedError,
  ValidationError,
  WebhookVerificationFailedError,
} from "../utils/errors";
import { logError, logInfo } from "../utils/logger";
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
import * as testSeriesRepository from "../repositories/testSeries.repository";
import * as userRepository from "../repositories/user.repository";
import { WEBHOOK_EVENT_PAYMENT_CAPTURED } from "./payment.service.constant";
import type { PaymentSignatureInput } from "./razorpay.service.types";
import type {
  ParsedWebhookEvent,
  PaymentOrderResult,
  PaymentRecord,
  PaymentService,
  PaymentServiceDeps,
  PaymentVerifyResult,
  ProductOrderResult,
  ProductRef,
  ReconciliationParams,
  ReconciliationRunSummary,
  ReconcilePaymentResult,
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
  const { payments, entitlements, materials, users, products } = deps;

  /**
   * Whether the resolved token claims belong to a caller holding `role_admin` —
   * either a pure admin Access Token (`role === role_admin`) or a learner token
   * whose `roles` claim was elevated to include `role_admin` (Req 17.1, 17.5).
   */
  function callerHoldsAdmin(claims: { role: string }): boolean {
    if (claims.role === ROLE_ADMIN) {
      return true;
    }
    const roles = (claims as { roles?: unknown }).roles;
    return Array.isArray(roles) && roles.includes(ROLE_ADMIN);
  }

  /**
   * Resolve the Learner's User Record from a learner Access Token, or throw a
   * 401 so the frontend re-shows the Download Gate to collect a valid email
   * (Req 6.10). A caller holding `role_admin` is rejected with 422
   * PAYMENT_NOT_REQUIRED — an admin never needs to purchase (Req 17.5) — BEFORE
   * any product/material resolution or amount computation. A missing/invalid/
   * expired token, or a token whose User Record no longer resolves, fails closed
   * with a 401.
   */
  async function resolveLearner(
    token: string,
  ): Promise<{ id: string; email: string }> {
    const claims = deps.verifyToken(token);
    if (claims === null || typeof claims.sub !== "string") {
      throw new AuthRequiredError(
        "A valid email is required to initiate a Payment.",
      );
    }
    // Admin-rejection guard (Req 17.5): reject an admin caller with 422 before
    // any further work — no order, Payment, or Entitlement is created and the
    // caller's existing records are left unchanged.
    if (callerHoldsAdmin(claims)) {
      throw new PaymentNotRequiredError(
        "An administrator already has access and does not need to purchase this product.",
      );
    }
    if (claims.role !== ROLE_COMMON) {
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
   * Initiate a Payment for a cart of Test / Sectional Test product refs
   * (Req 7.1–7.8, 17.5).
   *
   * Enforces every precondition BEFORE creating a Razorpay order, in this order:
   *   1. resolve the caller — 401 when none resolves (Req 7.3); a `role_admin`
   *      caller is rejected with 422 PAYMENT_NOT_REQUIRED by `resolveLearner`,
   *      before any product resolution or amount computation (Req 17.5);
   *   2. validate the cart shape — 1–50 refs, no duplicates (422
   *      VALIDATION_ERROR, Req 7.6);
   *   3. resolve every product — an unknown id is a 404 (Req 7.7);
   *   4. a free product (absent/zero Price) is rejected with 422
   *      PAYMENT_NOT_REQUIRED (Req 7.5);
   *   5. all products must share one Currency — else 422 VALIDATION_ERROR
   *      (Req 7.6);
   *   6. an already-held product is rejected with 409 ALREADY_ENTITLED (Req 7.4).
   *
   * Only then is ONE Razorpay order created whose amount is the SUM of the
   * products' paise Prices (NO `PAISE_PER_RUPEE` multiplier — Test-series Prices
   * are already paise, R4) and a Payment Record persisted with `testIds`/
   * `sectionIds` (Req 7.1, 7.2). A persistence failure is logged with a
   * timestamp and grants nothing (Req 12.14).
   */
  async function initiateProductPayment(
    token: string,
    productRefs: ProductRef[],
  ): Promise<ProductOrderResult> {
    // Resolve the caller first: 401 when no learner resolves; the admin guard
    // in resolveLearner rejects a role_admin caller with 422 before any product
    // resolution or amount computation (Req 7.3, 17.5).
    const user = await resolveLearner(token);

    // Validate the cart shape: 1–50 refs (Req 7.6).
    if (
      !Array.isArray(productRefs) ||
      productRefs.length < PRODUCT_CART_MIN_ITEMS ||
      productRefs.length > PRODUCT_CART_MAX_ITEMS
    ) {
      throw new ValidationError(
        `A purchase must include between ${PRODUCT_CART_MIN_ITEMS} and ${PRODUCT_CART_MAX_ITEMS} products.`,
        [
          {
            field: "products",
            reason: `A purchase must include between ${PRODUCT_CART_MIN_ITEMS} and ${PRODUCT_CART_MAX_ITEMS} products.`,
          },
        ],
      );
    }

    // No product may appear more than once, keyed by (type, id) (Req 7.6).
    const seen = new Set<string>();
    for (const ref of productRefs) {
      const key = `${ref.type}:${ref.id}`;
      if (seen.has(key)) {
        throw new ValidationError(
          "A product may not appear more than once in a purchase.",
          [
            {
              field: "products",
              reason: "A product may not appear more than once in a purchase.",
            },
          ],
        );
      }
      seen.add(key);
    }

    // Resolve every product; an unknown id fails the whole purchase with a 404
    // (Req 7.7). Collect the paise Price and Currency for each.
    const resolved: {
      ref: ProductRef;
      priceAmount: number | null;
      currency: string;
    }[] = [];
    for (const ref of productRefs) {
      const record =
        ref.type === "test"
          ? await products.findTestById(ref.id)
          : await products.findSectionById(ref.id);
      if (record === null) {
        throw new NotFoundError(
          `The requested ${ref.type === "test" ? "Test" : "Section"} '${ref.id}' was not found.`,
        );
      }
      resolved.push({
        ref,
        priceAmount: record.priceAmount,
        currency: record.currency ?? DEFAULT_CURRENCY,
      });
    }

    // Any free product (absent/zero Price) makes the whole purchase invalid
    // (Req 7.5).
    for (const item of resolved) {
      if (classifyPrice(item.priceAmount) === "free") {
        throw new PaymentNotRequiredError(
          `The ${item.ref.type === "test" ? "Test" : "Section"} '${item.ref.id}' is free and does not require payment.`,
        );
      }
    }

    // All products must share a single Currency (Req 7.6).
    const currency = resolved[0].currency;
    if (resolved.some((item) => item.currency !== currency)) {
      throw new ValidationError(
        "All products in a purchase must share a single Currency.",
        [
          {
            field: "products",
            reason: "All products in a purchase must share a single Currency.",
          },
        ],
      );
    }

    // Reject the whole purchase if the Learner already holds any covered product
    // (Req 7.4) — no double charge, no duplicate Entitlement.
    const [entitledTestIds, entitledSectionIds] = await Promise.all([
      entitlements.listEntitledTestIds(user.id),
      entitlements.listEntitledSectionIds(user.id),
    ]);
    const heldTestIds = new Set(entitledTestIds);
    const heldSectionIds = new Set(entitledSectionIds);
    for (const item of resolved) {
      const alreadyHeld =
        item.ref.type === "test"
          ? heldTestIds.has(item.ref.id)
          : heldSectionIds.has(item.ref.id);
      if (alreadyHeld) {
        throw new AlreadyEntitledError(
          `You already own the ${item.ref.type === "test" ? "Test" : "Section"} '${item.ref.id}'.`,
        );
      }
    }

    // Sum the products' paise Prices directly — Test-series Prices are already
    // in paise, so (unlike the study-material path) there is NO PAISE_PER_RUPEE
    // multiplier (R4). By this point every product is paid, so priceAmount is a
    // positive integer.
    const amountInPaise = resolved.reduce(
      (sum, item) => sum + (item.priceAmount as number),
      0,
    );
    const testIds = resolved
      .filter((item) => item.ref.type === "test")
      .map((item) => item.ref.id);
    const sectionIds = resolved
      .filter((item) => item.ref.type === "section")
      .map((item) => item.ref.id);

    // Persist the Payment Record with status `created` (Req 7.1, 7.2). A
    // persistence failure is logged with a timestamp; no Entitlement is granted
    // (Req 12.14).
    let payment;
    try {
      // Razorpay caps `receipt` at 40 chars, so build a short cart receipt.
      const order = await deps.createOrder({
        amount: amountInPaise,
        currency,
        receipt: `prod_${user.id.slice(-12)}_${Date.now().toString(36)}`,
      });

      payment = await payments.createProductPayment({
        userId: user.id,
        testIds,
        sectionIds,
        amount: amountInPaise,
        currency,
        razorpayOrderId: order.id,
      });
    } catch (error) {
      logError("Failed to persist product Payment Record on initiation", {
        userId: user.id,
        testIds,
        sectionIds,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalError();
    }

    return {
      paymentId: payment.id,
      razorpayOrderId: payment.razorpayOrderId,
      testIds: payment.testIds,
      sectionIds: payment.sectionIds,
      amount: payment.amount,
      currency: payment.currency,
      razorpayKeyId: deps.razorpayKeyId,
    };
  }

  /**
   * Grant one idempotent Entitlement per product covered by a verified /
   * captured / reconciled Payment Record (Req 7.2, 7.8, 12.8). Study Materials
   * keep the existing `upsertEntitlement` grant; Tests and Sections grant via
   * the product-aware `upsertProductEntitlement`. Every grant is upserted, so a
   * duplicate confirmation (client `verify`, the webhook, or reconciliation)
   * creates no second Entitlement (Req 12.19). A `null`/duplicate id is
   * de-duplicated defensively.
   */
  async function grantEntitlementsForPayment(
    record: Pick<
      PaymentRecord,
      "id" | "userId" | "studyMaterialIds" | "testIds" | "sectionIds"
    >,
  ): Promise<void> {
    for (const studyMaterialId of new Set(record.studyMaterialIds)) {
      await entitlements.upsertEntitlement({
        userId: record.userId,
        studyMaterialId,
        paymentId: record.id,
      });
    }
    for (const testId of new Set(record.testIds)) {
      await entitlements.upsertProductEntitlement({
        userId: record.userId,
        product: { type: "test", id: testId },
        paymentId: record.id,
      });
    }
    for (const sectionId of new Set(record.sectionIds)) {
      await entitlements.upsertProductEntitlement({
        userId: record.userId,
        product: { type: "section", id: sectionId },
        paymentId: record.id,
      });
    }
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
      // Grant one Entitlement per covered product (Study Material, Test, or
      // Section); upsert keeps it idempotent so re-verifying (or the webhook)
      // creates no duplicates (Req 7.2, 7.8, 12.8, 12.19).
      await grantEntitlementsForPayment(payment);
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
      await grantEntitlementsForPayment(payment);
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

  /**
   * Reconcile a single Stale Payment Record against Razorpay (Req 3–7).
   *
   * Queries Razorpay for the order's payments; on a Captured Razorpay Payment
   * (`status === 'captured'`) promotes the record to `successful`, records that
   * payment's id, and upserts one Entitlement per distinct studyMaterialId
   * using the existing idempotent grant logic (Req 4). With no capture, marks
   * `failed` when the record's age (relative to `runStartTime`) reaches the
   * Fail-After Window (Req 5.1) else leaves it `created` (Req 5.2). Never
   * downgrades a `successful` record — the same no-downgrade rule as
   * `markFailedQuietly` (Req 6.1). A Razorpay query error or a persistence error
   * is caught and logged with the paymentId, leaves the record's status
   * unchanged, and yields the `errored` outcome (Req 7.1, 7.2, 7.3). One
   * `logInfo` per record records the final status (Req 8.2).
   */
  async function reconcilePayment(
    record: PaymentRecord,
    params: ReconciliationParams,
  ): Promise<ReconcilePaymentResult> {
    const paymentId = record.id;
    const razorpayOrderId = record.razorpayOrderId;

    // No-downgrade guard — identical rule to markFailedQuietly (Req 6.1). A
    // record already `successful` is left untouched, granting nothing further.
    if (record.status === PAYMENT_STATUS.SUCCESSFUL) {
      logInfo("Reconciled Payment Record", {
        paymentId,
        razorpayOrderId,
        status: PAYMENT_STATUS.SUCCESSFUL,
      });
      return { paymentId, razorpayOrderId, outcome: "successful" };
    }

    // Query Razorpay for the true order state (Req 3.1). A transport/Razorpay
    // error is isolated: log it, leave the status unchanged, return `errored`
    // (Req 7.1, 7.3).
    let payments_;
    try {
      payments_ = await deps.fetchOrderPayments(razorpayOrderId);
    } catch (error) {
      logError("Failed to query Razorpay during reconciliation", {
        paymentId,
        razorpayOrderId,
        reason: "razorpay_query_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return { paymentId, razorpayOrderId, outcome: "errored" };
    }

    // A Captured Razorpay Payment is one whose status === 'captured' (Req 3.2/3.3).
    const captured = payments_.filter((p) => p.status === "captured");

    try {
      if (captured.length >= 1) {
        // Select exactly one captured payment as the reconciliation result
        // (Req 3.4, 4.2), promote the record, and grant one Entitlement per
        // distinct studyMaterialId via the idempotent upsert (Req 4.1, 4.3, 6.4).
        const chosen = captured[0];
        await payments.updatePaymentStatus(record.id, {
          status: PAYMENT_STATUS.SUCCESSFUL,
          razorpayPaymentId: chosen.id,
        });
        await grantEntitlementsForPayment(record);
        logInfo("Reconciled Payment Record", {
          paymentId,
          razorpayOrderId,
          status: PAYMENT_STATUS.SUCCESSFUL,
        });
        return { paymentId, razorpayOrderId, outcome: "successful" };
      }

      // No capture: decide `failed` vs leave `created` on the Fail-After Window
      // (Req 5.1, 5.2). Age is measured from the run start time.
      const ageMs = params.runStartTime.getTime() - record.createdAt.getTime();
      const failAfterMs = params.failAfterWindowHours * 60 * 60 * 1000;
      if (ageMs >= failAfterMs) {
        // Past the Fail-After Window with no capture: mark the record
        // system-cancelled (distinct from `failed` for audit clarity) — no
        // paymentId recorded, no Entitlement granted (Req 5.1, 5.3).
        await payments.updatePaymentStatus(record.id, {
          status: PAYMENT_STATUS.SYSTEM_CANCELLED_OLD_AGE,
        });
        logInfo("Reconciled Payment Record", {
          paymentId,
          razorpayOrderId,
          status: PAYMENT_STATUS.SYSTEM_CANCELLED_OLD_AGE,
        });
        return { paymentId, razorpayOrderId, outcome: "systemCancelled" };
      }

      // Still within the Fail-After Window — leave `created` (Req 5.2).
      logInfo("Reconciled Payment Record", {
        paymentId,
        razorpayOrderId,
        status: PAYMENT_STATUS.CREATED,
      });
      return { paymentId, razorpayOrderId, outcome: "created" };
    } catch (error) {
      // Persistence failure: log which operation, leave the status unchanged,
      // return `errored` (Req 7.2, 7.3).
      logError("Failed to persist Payment Record during reconciliation", {
        paymentId,
        razorpayOrderId,
        operation:
          captured.length >= 1 ? "updatePaymentStatus/upsertEntitlement" : "updatePaymentStatus",
        reason: "persistence_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return { paymentId, razorpayOrderId, outcome: "errored" };
    }
  }

  /**
   * Select and reconcile one batch of Stale Payment Records (Req 1, 2, 8).
   *
   * Computes the Grace Window cutoff, selects up to Batch Size Stale Payment
   * Records via `findStalePayments`, then reconciles each record inside its own
   * try/catch so a thrown per-record error can never abort the loop (defense in
   * depth on top of `reconcilePayment`'s internal handling, Req 7.4). Returns
   * the accumulated Run Summary with the invariant
   * `scanned === successful + failed + created + errored` (Req 8.1). A
   * batch-level error (e.g. the selection query itself failing) propagates so
   * the entrypoint can exit non-zero (Req 1.3).
   */
  async function reconcileBatch(
    params: ReconciliationParams,
  ): Promise<ReconciliationRunSummary> {
    const olderThan = new Date(
      params.runStartTime.getTime() - params.graceWindowMinutes * 60 * 1000,
    );

    // A selection failure is a batch-level error (Req 1.3): let it propagate.
    const records = await payments.findStalePayments({
      olderThan,
      limit: params.batchSize,
    });

    const summary: ReconciliationRunSummary = {
      scanned: 0,
      successful: 0,
      systemCancelled: 0,
      created: 0,
      errored: 0,
    };

    for (const record of records) {
      summary.scanned += 1;
      // Defense-in-depth isolation: even an unexpected throw is caught, counted
      // as `errored`, and the loop continues (Req 7.4).
      try {
        const result = await reconcilePayment(record, params);
        switch (result.outcome) {
          case "successful":
            summary.successful += 1;
            break;
          case "systemCancelled":
            summary.systemCancelled += 1;
            break;
          case "created":
            summary.created += 1;
            break;
          case "errored":
            summary.errored += 1;
            break;
        }
      } catch (error) {
        summary.errored += 1;
        logError("Unexpected error reconciling Payment Record", {
          paymentId: record.id,
          razorpayOrderId: record.razorpayOrderId,
          reason: "unexpected_error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  }

  return {
    initiatePayment,
    initiateProductPayment,
    verifyPayment,
    handleWebhook,
    reconcilePayment,
    reconcileBatch,
  };
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
      createProductPayment: paymentRepository.createProductPayment,
      findPaymentByRazorpayOrderId:
        paymentRepository.findPaymentByRazorpayOrderId,
      updatePaymentStatus: paymentRepository.updatePaymentStatus,
      findStalePayments: paymentRepository.findStalePayments,
    },
    entitlements: {
      findEntitlement: entitlementRepository.findEntitlement,
      upsertEntitlement: entitlementRepository.upsertEntitlement,
      upsertProductEntitlement:
        entitlementRepository.upsertProductEntitlement,
      listEntitledTestIds: entitlementRepository.listEntitledTestIds,
      listEntitledSectionIds: entitlementRepository.listEntitledSectionIds,
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
    products: {
      async findTestById(id) {
        const test = await testSeriesRepository.findTestGraphById(id);
        return test === null
          ? null
          : {
              id: test.id,
              priceAmount: test.priceAmount,
              currency: test.currency,
            };
      },
      async findSectionById(id) {
        const section = await testSeriesRepository.findSectionGraphById(id);
        return section === null
          ? null
          : {
              id: section.id,
              priceAmount: section.priceAmount,
              currency: section.currency,
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
    async fetchOrderPayments(razorpayOrderId) {
      // Razorpay returns { entity: 'collection', count, items: [...] }. Guard
      // the loosely-typed result defensively: treat a missing/non-array
      // `items` as no payments, and project each to the { id, status } subset
      // the reconciliation logic needs (Req 3.1).
      const result = await razorpay.orders.fetchPayments(razorpayOrderId);
      const items = Array.isArray(result?.items) ? result.items : [];
      return items.map((p) => ({ id: String(p.id), status: String(p.status) }));
    },
    verifyPaymentSignature: (input) => verifyPaymentSignature(input),
    verifyWebhookSignature: (rawBody, signature) =>
      verifyWebhookSignature(rawBody, signature),
    verifyToken,
    razorpayKeyId: env.razorpay.keyId,
  });
}
