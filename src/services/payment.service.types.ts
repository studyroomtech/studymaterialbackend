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

import type { FindStalePaymentsInput } from '../repositories/payment.repository.types';
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
  /**
   * Select Stale Payment Records for reconciliation: status `created` with
   * `createdAt <= input.olderThan`, ordered oldest-first, limited to
   * `input.limit` (Req 2.1, 2.2, 2.4, 1.4).
   */
  findStalePayments(input: FindStalePaymentsInput): Promise<PaymentRecord[]>;
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
 * The subset of a Razorpay payment (against an order) the reconciliation logic
 * needs. `status` is the Razorpay payment status string; a Captured Razorpay
 * Payment is one whose `status === 'captured'` (Req 3.2). Other fields Razorpay
 * returns are ignored.
 */
export interface RazorpayOrderPayment {
  id: string;
  status: string;
}

/**
 * Fetch all Razorpay payments recorded against a Razorpay Order Identifier
 * (Req 3.1). Wrapping `razorpay.orders.fetchPayments` behind this contract keeps
 * the reconciliation logic independent of the SDK and lets tests inject a
 * deterministic fake. Rejects (throws) on a Razorpay/transport error so the
 * per-record handler can isolate the failure (Req 7.1).
 */
export type RazorpayOrderPaymentsFetcher = (
  razorpayOrderId: string,
) => Promise<RazorpayOrderPayment[]>;

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
  /** Fetch all Razorpay payments for an order id, for reconciliation (Req 3.1). */
  fetchOrderPayments: RazorpayOrderPaymentsFetcher;
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

/** The terminal outcome the reconciliation assigns to one Payment Record. */
export type ReconcileOutcome =
  | 'successful' // promoted (capture found) — Req 4
  | 'systemCancelled' // no capture, past Fail-After Window → system_cancelled_due_to_old_age — Req 5.1
  | 'created' // no capture, still within Fail-After Window — Req 5.2
  | 'errored'; // Razorpay/DB error, status left unchanged — Req 7.3

/** The result of reconciling a single Payment Record (drives logging/counting). */
export interface ReconcilePaymentResult {
  paymentId: string;
  razorpayOrderId: string;
  outcome: ReconcileOutcome;
}

/**
 * The per-run counts logged as the Run Summary (Req 8.1). Invariant:
 * scanned === successful + systemCancelled + created + errored.
 */
export interface ReconciliationRunSummary {
  scanned: number;
  successful: number;
  /** No capture, past the Fail-After Window → system_cancelled_due_to_old_age (Req 5.1). */
  systemCancelled: number;
  created: number;
  errored: number;
}

/** Timing/limit inputs for a run, resolved from config by the entrypoint. */
export interface ReconciliationParams {
  /** Run start time; all age comparisons are relative to this instant. */
  runStartTime: Date;
  /** Grace Window in minutes (record must be at least this old). */
  graceWindowMinutes: number;
  /** Fail-After Window in hours (mark failed past this age). */
  failAfterWindowHours: number;
  /** Batch Size (max records per run). */
  batchSize: number;
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
  /**
   * Reconcile a single Stale Payment Record against Razorpay (Req 3–7). Queries
   * Razorpay for the order's payments; on a Captured Razorpay Payment promotes
   * the record to `successful`, records that payment's id, and upserts one
   * Entitlement per distinct studyMaterialId (Req 4). With no capture, marks
   * `failed` when age >= Fail-After Window (Req 5.1) else leaves it `created`
   * (Req 5.2). Never downgrades a `successful` record (Req 6.1). A Razorpay or
   * persistence error is caught, logged with the paymentId, leaves the status
   * unchanged, and yields the `errored` outcome (Req 7).
   */
  reconcilePayment(
    record: PaymentRecord,
    params: ReconciliationParams,
  ): Promise<ReconcilePaymentResult>;
  /**
   * Select and reconcile one batch of Stale Payment Records (Req 1, 2, 8).
   * Fetches up to Batch Size records via `findStalePayments`, reconciles each
   * in isolation (one record's failure never affects another, Req 7.4),
   * accumulates and returns the Run Summary. A batch-level error (e.g. the
   * selection query itself fails) rejects so the entrypoint can exit non-zero
   * (Req 1.3).
   */
  reconcileBatch(
    params: ReconciliationParams,
  ): Promise<ReconciliationRunSummary>;
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
