// Types for the Payment service (Req 1.15: type/interface declarations live
// only in `*.types.ts`).
//
// This module describes:
//   - the minimal persistence records the service reads/writes (Payment
//     Records, Entitlements, Study Materials, User Records),
//   - the repository/collaborator contracts the service depends on (the
//     concrete Prisma repositories, the Razorpay order creator, the signature
//     verifiers, and the JWT token service are wired in by
//     `createDefaultPaymentService`), and
//   - the public surface of the Payment service itself.
//
// Keeping the dependency contract here lets `payment.service.ts` be written and
// property-tested against a small, well-defined boundary — independent of
// Prisma, the Razorpay SDK, and JWT (Req 12.4, 12.6–12.11, 12.14, 12.15, 12.18,
// 12.19).

import type { AccessTokenClaims } from '../types/auth.types';
import type { PaymentStatus } from '../types/domain.types';
import type { PaymentSignatureInput } from './razorpay.service.types';

/**
 * The subset of a persisted Payment Record the Payment service reads and
 * transitions (Req 12.4, 12.6, 12.7, 12.9). `razorpayPaymentId` is recorded
 * only once Payment Signature Verification succeeds; the timestamps serialize
 * ISO 8601 (Req 12.9).
 */
export interface PaymentRecord {
  id: string;
  userId: string;
  studyMaterialIds: string[];
  amount: number;
  currency: string;
  status: PaymentStatus;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The subset of a persisted Study Material the Payment service needs to decide
 * Paid vs Free and to charge the correct amount/Currency (Req 12.4, 12.10). A
 * `null`/`0` `priceAmount` marks a Free Material (Req 11.14).
 */
export interface PaymentMaterialRecord {
  id: string;
  priceAmount: number | null;
  currency: string;
}

/**
 * The subset of a persisted User Record the Payment service resolves from a
 * learner Access Token before initiating a Payment (Req 6.10).
 */
export interface PaymentUserRecord {
  id: string;
  email: string;
}

/**
 * The subset of a persisted Payment Entitlement the Payment service reads when
 * checking the already-entitled precondition (Req 12.11).
 */
export interface PaymentEntitlementRecord {
  id: string;
  userId: string;
  studyMaterialId: string;
}

/**
 * The fields persisted when a Payment is initiated with status `created`
 * (Req 12.4). `currency` is optional so the schema default (`INR`) applies when
 * omitted.
 */
export interface CreatePaymentRecordInput {
  userId: string;
  studyMaterialIds: string[];
  amount: number;
  currency?: string;
  razorpayOrderId: string;
}

/**
 * The fields updated when a Payment transitions to `successful` or `failed`
 * (Req 12.6, 12.7). On success the Razorpay Payment Identifier is recorded.
 */
export interface UpdatePaymentRecordInput {
  status: PaymentStatus;
  razorpayPaymentId?: string;
}

/**
 * The fields persisted when granting a Payment Entitlement after a verified
 * Payment (Req 12.8). Upserted so a duplicate confirmation creates no second
 * Entitlement (Req 12.19).
 */
export interface GrantEntitlementRecordInput {
  userId: string;
  studyMaterialId: string;
  paymentId: string;
}

/**
 * Persistence contract for Payment Records consumed by the Payment service.
 * `findPaymentByRazorpayOrderId` returns `null` (never throws) when the order
 * has no Payment Record so verification can treat it as failed (Req 12.18).
 */
export interface PaymentRepository {
  createPayment(input: CreatePaymentRecordInput): Promise<PaymentRecord>;
  findPaymentByRazorpayOrderId(
    razorpayOrderId: string,
  ): Promise<PaymentRecord | null>;
  updatePaymentStatus(
    id: string,
    input: UpdatePaymentRecordInput,
  ): Promise<PaymentRecord>;
}

/**
 * Persistence contract for Payment Entitlements consumed by the Payment
 * service. `upsertEntitlement` is idempotent on `(userId, studyMaterialId)` so
 * duplicate confirmations create no second Entitlement (Req 12.8, 12.19).
 */
export interface PaymentEntitlementRepository {
  findEntitlement(
    userId: string,
    studyMaterialId: string,
  ): Promise<PaymentEntitlementRecord | null>;
  upsertEntitlement(
    input: GrantEntitlementRecordInput,
  ): Promise<PaymentEntitlementRecord>;
}

/**
 * Persistence contract for Study Material lookups consumed by the Payment
 * service. Returns `null` (never throws) when the material does not exist.
 */
export interface PaymentMaterialRepository {
  findMaterialById(id: string): Promise<PaymentMaterialRecord | null>;
}

/**
 * Persistence contract for User Record lookups consumed by the Payment service.
 * Returns `null` (never throws) when the id does not resolve so the service can
 * map absence to an auth error (Req 6.10).
 */
export interface PaymentUserRepository {
  findUserById(id: string): Promise<PaymentUserRecord | null>;
}

/**
 * The order details returned by the Razorpay order creator. Only the Razorpay
 * Order Identifier is required by the service; other fields Razorpay returns are
 * ignored.
 */
export interface RazorpayOrder {
  id: string;
}

/**
 * The input to the Razorpay order creator: the charge amount and Currency
 * (Req 12.4). `receipt` is an optional internal reference.
 */
export interface CreateRazorpayOrderInput {
  amount: number;
  currency: string;
  receipt?: string;
}

/**
 * Creates a Razorpay order and returns its Razorpay Order Identifier (Req
 * 12.4). Wrapping the Razorpay SDK behind this contract keeps the service logic
 * independent of the SDK and lets tests inject a deterministic creator.
 */
export type RazorpayOrderCreator = (
  input: CreateRazorpayOrderInput,
) => Promise<RazorpayOrder>;

/**
 * The dependency bundle the Payment service is constructed with. The concrete
 * Prisma-backed repositories, the Razorpay order creator, the signature
 * verifiers, and the JWT token service are injected by
 * `createDefaultPaymentService`, keeping the service logic independent of those
 * collaborators for testing.
 */
export interface PaymentServiceDeps {
  payments: PaymentRepository;
  entitlements: PaymentEntitlementRepository;
  materials: PaymentMaterialRepository;
  users: PaymentUserRepository;
  /** Create a Razorpay order for the resolved amount/Currency (Req 12.4). */
  createOrder: RazorpayOrderCreator;
  /** Server-side Payment Signature Verification — the sole entitlement path (Req 12.15, 12.16). */
  verifyPaymentSignature(input: PaymentSignatureInput): boolean;
  /** Verify a Razorpay Webhook signature over the raw body (Req 12.19). */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;
  /** Verify a learner Access Token, returning its claims or `null` (Req 6.10). */
  verifyToken(token: string): AccessTokenClaims | null;
  /** The non-secret Razorpay Public Key Identifier echoed to the client (Req 12.4, 12.17). */
  razorpayKeyId: string;
}

/**
 * The outcome of handling a Razorpay Webhook event (Req 12.19). `handled` is
 * `true` only when a verified `payment.captured` event resolved to a Payment
 * Record that was confirmed; a verified event for an unknown order or an
 * unhandled event type is a safe no-op (`handled: false`).
 */
export interface WebhookHandlingResult {
  handled: boolean;
  event: string | null;
  studyMaterialIds?: string[];
}

/**
 * The parsed, service-relevant fields of a Razorpay Webhook body: the event
 * name and, for a `payment.captured` event, the Razorpay Order and Payment
 * Identifiers of the captured payment. `null` when the body is not
 * JSON-parseable or lacks the expected shape.
 */
export interface ParsedWebhookEvent {
  event: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
}

/**
 * The public surface of the Payment service. Methods either resolve with the
 * result or throw a typed domain error that the errorHandler maps to the
 * unified error envelope:
 *   - AuthRequiredError → 401 (Req 6.10)
 *   - PaymentNotRequiredError → 422 (Req 12.10)
 *   - AlreadyEntitledError → 409 (Req 12.11)
 *   - NotFoundError → 404 (missing material)
 *   - PaymentVerificationFailedError → 400 (Req 12.7, 12.18)
 *   - WebhookVerificationFailedError → 400 (Req 12.19, 12.24)
 *   - InternalError → 500 (persistence failure, Req 12.14)
 */
export interface PaymentService {
  /**
   * Initiate a Payment: resolve the Learner from the Access Token, enforce the
   * Free / already-entitled preconditions, create a Razorpay order, and persist
   * a Payment Record with status `created` (Req 6.10, 12.4, 12.10, 12.11).
   */
  initiatePayment(
    token: string,
    studyMaterialIds: string[],
  ): Promise<PaymentOrderResult>;
  /**
   * Verify a Payment confirmation server-side (the sole entitlement path):
   * resolve the Payment Record, run Payment Signature Verification, and — only
   * on an exact match — mark the record `successful` and grant an Entitlement
   * (Req 12.6, 12.7, 12.8, 12.15, 12.18).
   */
  verifyPayment(input: PaymentSignatureInput): Promise<PaymentVerifyResult>;
  /**
   * Handle a Razorpay Webhook: verify the signature over the raw body first,
   * then idempotently confirm the matching Payment Record and Entitlement on a
   * verified `payment.captured` event (Req 12.19, 12.24).
   */
  handleWebhook(
    rawBody: string | Buffer,
    signature: string,
  ): Promise<WebhookHandlingResult>;
}

/**
 * The Razorpay order details returned to the caller after a Payment is
 * initiated (Req 12.4). Only the non-secret Razorpay Public Key Identifier is
 * included; the Razorpay Key Secret is never exposed (Req 12.17).
 */
export interface PaymentOrderResult {
  paymentId: string;
  razorpayOrderId: string;
  studyMaterialIds: string[];
  amount: number;
  currency: string;
  razorpayKeyId: string;
}

/**
 * The outcome of a successful Payment verification (Req 12.6, 12.8). Verification
 * failures are surfaced as thrown `PaymentVerificationFailedError`s rather than
 * this result, matching the design's `400` response.
 */
export interface PaymentVerifyResult {
  verified: true;
  status: PaymentStatus;
  studyMaterialIds: string[];
  entitled: boolean;
}
