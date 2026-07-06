// Razorpay signature verification (Req 12.16, 12.17, 12.19, 12.20).
//
// This service performs the server-side cryptographic checks that are the sole
// determinant of a Payment's outcome — an Entitlement is granted only after one
// of these verifications succeeds, never on a client-reported claim of success
// (Req 12.15, 12.21). Two verifications are provided:
//
//   - Payment Signature Verification: recompute
//     `HMAC_SHA256(razorpayOrderId + "|" + razorpayPaymentId, RAZORPAY_KEY_SECRET)`
//     and compare it to the received Razorpay Signature using a constant-time
//     comparison; success requires an exact match (Req 12.16, 12.20).
//   - Webhook Signature Verification: recompute
//     `HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)` over the raw request body
//     and compare it to the `X-Razorpay-Signature` header, constant-time; used
//     before acting on an optional Razorpay Webhook event (Req 12.19).
//
// The HMAC computation and constant-time comparison are exposed as pure helpers
// (taking the secret explicitly) so they can be reasoned about and tested
// without any environment/I/O. The `verify*` entry points default the secret to
// the value read from `config/env.ts`, keeping `RAZORPAY_KEY_SECRET` and
// `RAZORPAY_WEBHOOK_SECRET` server-side only and never exposing them to the
// Frontend Project or the browser (Req 12.17).

import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '../config/env';
import type { PaymentSignatureInput } from './razorpay.service.types';

/** The single separator joining the order and payment ids before hashing (Req 12.16). */
const SIGNATURE_SEPARATOR = '|';

/** The hash algorithm Razorpay uses for signature computation (Req 12.16). */
const HMAC_ALGORITHM = 'sha256';

/** The digest encoding of the recomputed signature (hexadecimal, as Razorpay emits). */
const SIGNATURE_ENCODING = 'hex';

/**
 * Build the exact string over which the Payment Signature is computed: the
 * Razorpay Order Identifier and Razorpay Payment Identifier joined by a single
 * "|" separator (Req 12.16, 12.20).
 */
export function buildPaymentSignaturePayload(
  razorpayOrderId: string,
  razorpayPaymentId: string
): string {
  return `${razorpayOrderId}${SIGNATURE_SEPARATOR}${razorpayPaymentId}`;
}

/**
 * Compute an HMAC-SHA256 over `data` using `secret`, returning the lowercase
 * hex digest. Pure: the same inputs always produce the same digest.
 */
export function computeHmacSha256(
  data: string | Buffer,
  secret: string
): string {
  return createHmac(HMAC_ALGORITHM, secret).update(data).digest(SIGNATURE_ENCODING);
}

/**
 * Constant-time equality of two signature strings. Guards against the
 * `timingSafeEqual` precondition that both buffers share the same length: when
 * the lengths differ (or either value is not a string) the values cannot match,
 * so `false` is returned without invoking `timingSafeEqual`. When the lengths
 * match, the comparison runs in constant time regardless of where the first
 * differing byte occurs (Req 12.16).
 */
export function constantTimeEquals(
  expected: string,
  received: string
): boolean {
  if (typeof expected !== 'string' || typeof received !== 'string') {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');
  // `timingSafeEqual` throws when the buffers differ in length, so short-circuit
  // unequal-length inputs (they can never be an exact match anyway).
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Compute the expected Payment Signature for a `(orderId, paymentId)` pair
 * using the Razorpay Key Secret (Req 12.16, 12.20). Pure helper; the secret is
 * supplied by the caller.
 */
export function computePaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  keySecret: string
): string {
  return computeHmacSha256(
    buildPaymentSignaturePayload(razorpayOrderId, razorpayPaymentId),
    keySecret
  );
}

/**
 * Verify a Razorpay Payment confirmation. Recomputes
 * `HMAC_SHA256(orderId + "|" + paymentId, RAZORPAY_KEY_SECRET)` and compares it
 * to the received `razorpaySignature` using a constant-time comparison,
 * returning `true` only on an exact match (Req 12.16, 12.20). The Razorpay Key
 * Secret defaults to the value read from `config/env.ts` and is never exposed to
 * the Frontend Project (Req 12.17); tests may inject a secret explicitly.
 */
export function verifyPaymentSignature(
  input: PaymentSignatureInput,
  keySecret: string = getEnv().razorpay.keySecret
): boolean {
  const expected = computePaymentSignature(
    input.razorpayOrderId,
    input.razorpayPaymentId,
    keySecret
  );
  return constantTimeEquals(expected, input.razorpaySignature);
}

/**
 * Verify a Razorpay Webhook event. Recomputes
 * `HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)` over the exact raw request
 * body (a string or Buffer — never a re-serialized object) and compares it to
 * the `X-Razorpay-Signature` header using a constant-time comparison, returning
 * `true` only on an exact match (Req 12.19). The Razorpay Webhook Secret
 * defaults to the value read from `config/env.ts` and stays server-side
 * (Req 12.17); tests may inject a secret explicitly.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
  webhookSecret: string = getEnv().razorpay.webhookSecret
): boolean {
  const expected = computeHmacSha256(rawBody, webhookSecret);
  return constantTimeEquals(expected, signature);
}
