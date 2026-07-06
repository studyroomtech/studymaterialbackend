// Tests for Razorpay signature verification (Req 12.16, 12.17, 12.19, 12.20).
//
// Covers the pure HMAC computation, the constant-time comparison (including the
// unequal-length guard), and the `verifyPaymentSignature` / `verifyWebhookSignature`
// entry points (with the secret injected explicitly so no environment is
// required). Includes the verification core of the design's Property 26
// (payment signature) and Property 29 (webhook signature): verification
// succeeds if and only if the received signature exactly equals the recomputed
// HMAC-SHA256.

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildPaymentSignaturePayload,
  computeHmacSha256,
  computePaymentSignature,
  constantTimeEquals,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from './razorpay.service';

const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';

/** Reference HMAC-SHA256 hex digest, computed independently of the service. */
function referenceHmac(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

describe('buildPaymentSignaturePayload', () => {
  it('joins order and payment ids with a single "|" separator', () => {
    expect(buildPaymentSignaturePayload('order_1', 'pay_1')).toBe(
      'order_1|pay_1'
    );
  });
});

describe('computeHmacSha256 / computePaymentSignature', () => {
  it('matches an independently computed HMAC-SHA256 over "orderId|paymentId"', () => {
    const expected = referenceHmac('order_1|pay_1', KEY_SECRET);
    expect(computePaymentSignature('order_1', 'pay_1', KEY_SECRET)).toBe(
      expected
    );
    expect(computeHmacSha256('order_1|pay_1', KEY_SECRET)).toBe(expected);
  });

  it('produces a different digest under a different secret', () => {
    expect(computePaymentSignature('order_1', 'pay_1', 'a')).not.toBe(
      computePaymentSignature('order_1', 'pay_1', 'b')
    );
  });
});

describe('constantTimeEquals', () => {
  it('is true for identical strings and false for differing ones', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
  });

  it('returns false for unequal-length inputs without throwing', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('', 'x')).toBe(false);
    expect(constantTimeEquals('abcd', '')).toBe(false);
  });

  it('returns false for non-string inputs', () => {
    // Defensive: a missing signature must not throw.
    expect(
      constantTimeEquals('abc', undefined as unknown as string)
    ).toBe(false);
  });
});

describe('verifyPaymentSignature', () => {
  it('accepts a correctly computed signature', () => {
    const razorpayOrderId = 'order_ABC';
    const razorpayPaymentId = 'pay_XYZ';
    const razorpaySignature = referenceHmac(
      `${razorpayOrderId}|${razorpayPaymentId}`,
      KEY_SECRET
    );
    expect(
      verifyPaymentSignature(
        { razorpayOrderId, razorpayPaymentId, razorpaySignature },
        KEY_SECRET
      )
    ).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const razorpayOrderId = 'order_ABC';
    const razorpayPaymentId = 'pay_XYZ';
    const good = referenceHmac(
      `${razorpayOrderId}|${razorpayPaymentId}`,
      KEY_SECRET
    );
    const tampered = `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`;
    expect(
      verifyPaymentSignature(
        { razorpayOrderId, razorpayPaymentId, razorpaySignature: tampered },
        KEY_SECRET
      )
    ).toBe(false);
  });

  it('rejects a signature valid under a different secret', () => {
    const razorpayOrderId = 'order_ABC';
    const razorpayPaymentId = 'pay_XYZ';
    const signedWithOtherSecret = referenceHmac(
      `${razorpayOrderId}|${razorpayPaymentId}`,
      'other_secret'
    );
    expect(
      verifyPaymentSignature(
        {
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature: signedWithOtherSecret,
        },
        KEY_SECRET
      )
    ).toBe(false);
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts a signature computed over the raw body', () => {
    const rawBody = '{"event":"payment.captured"}';
    const signature = referenceHmac(rawBody, WEBHOOK_SECRET);
    expect(verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)).toBe(
      true
    );
  });

  it('rejects when the raw body is altered', () => {
    const rawBody = '{"event":"payment.captured"}';
    const signature = referenceHmac(rawBody, WEBHOOK_SECRET);
    const altered = '{"event":"payment.failed"}';
    expect(verifyWebhookSignature(altered, signature, WEBHOOK_SECRET)).toBe(
      false
    );
  });

  it('verifies a Buffer raw body identically to its string form', () => {
    const rawBody = '{"event":"payment.captured"}';
    const signature = referenceHmac(rawBody, WEBHOOK_SECRET);
    expect(
      verifyWebhookSignature(Buffer.from(rawBody, 'utf8'), signature, WEBHOOK_SECRET)
    ).toBe(true);
  });
});

// --- Property 26 (verification core): payment signature -------------------

describe('Property 26: payment signature verification', () => {
  // Feature: study-materials-platform, Property 26: Server-side signature
  // verification is the sole determinant of payment outcome — verification
  // succeeds iff the received signature exactly equals
  // HMAC_SHA256(orderId + "|" + paymentId, RAZORPAY_KEY_SECRET).
  // Validates: Requirements 12.16, 12.20
  const idArb = fc.stringMatching(/^[a-zA-Z0-9_]{1,16}$/);
  const secretArb = fc.stringMatching(/^[a-zA-Z0-9]{1,24}$/);

  it('accepts exactly the correctly recomputed signature and rejects any other', () => {
    fc.assert(
      fc.property(
        idArb,
        idArb,
        secretArb,
        fc.string({ maxLength: 80 }),
        (orderId, paymentId, secret, candidate) => {
          const correct = referenceHmac(`${orderId}|${paymentId}`, secret);
          const expected = candidate === correct;
          expect(
            verifyPaymentSignature(
              {
                razorpayOrderId: orderId,
                razorpayPaymentId: paymentId,
                razorpaySignature: candidate,
              },
              secret
            )
          ).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('always accepts the genuinely computed signature', () => {
    fc.assert(
      fc.property(idArb, idArb, secretArb, (orderId, paymentId, secret) => {
        const signature = computePaymentSignature(orderId, paymentId, secret);
        expect(
          verifyPaymentSignature(
            {
              razorpayOrderId: orderId,
              razorpayPaymentId: paymentId,
              razorpaySignature: signature,
            },
            secret
          )
        ).toBe(true);
      }),
      { numRuns: 200 }
    );
  });
});

// --- Property 29 (verification core): webhook signature -------------------

describe('Property 29: webhook signature verification', () => {
  // Feature: study-materials-platform, Property 29: Webhook signature
  // verification gates action — an event is acted on iff its signature verifies
  // (constant-time) against HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET).
  // Validates: Requirements 12.19
  const secretArb = fc.stringMatching(/^[a-zA-Z0-9]{1,24}$/);

  it('verifies iff the candidate equals the HMAC over the raw body', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 120 }),
        secretArb,
        fc.string({ maxLength: 80 }),
        (rawBody, secret, candidate) => {
          const correct = referenceHmac(rawBody, secret);
          const expected = candidate === correct;
          expect(verifyWebhookSignature(rawBody, candidate, secret)).toBe(
            expected
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});
