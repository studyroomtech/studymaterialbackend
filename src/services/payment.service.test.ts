// Tests for the Payment service (Req 6.10, 12.4, 12.6–12.11, 12.14, 12.15,
// 12.18, 12.19, 12.24).
//
// Covers order initiation preconditions, server-side signature verification as
// the sole entitlement path, and idempotent webhook handling, exercised over
// small in-memory fakes (no Prisma, Razorpay SDK, or JWT). Includes
// example/unit checks and the design's numbered properties:
//   - Property 25: Payment initiation preconditions (Req 6.10, 12.4, 12.10, 12.11)
//   - Property 26: Server-side signature verification is the sole determinant
//     of payment outcome and entitlement (Req 12.6, 12.7, 12.15, 12.16, 12.18)
//   - Property 27: Payment Record timestamps are valid ISO 8601 (Req 12.9)
//   - Property 29: Webhook signature gates action; entitlement confirmation is
//     idempotent (Req 12.19)

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createPaymentService, parseWebhookEvent } from './payment.service';
import { computePaymentSignature, computeHmacSha256 } from './razorpay.service';
import { PAYMENT_STATUS } from '../constants/payment.constant';
import { WEBHOOK_EVENT_PAYMENT_CAPTURED } from './payment.service.constant';
import { AppError } from '../utils/errors';
import type { AccessTokenClaims } from '../types/auth.types';
import type { PaymentStatus } from '../types/domain.types';
import type {
  PaymentEntitlementRecord,
  PaymentMaterialRecord,
  PaymentRecord,
  PaymentServiceDeps,
  PaymentUserRecord,
} from './payment.service.types';

const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';
const KEY_ID = 'rzp_test_key_id';

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${idSeq}`;
}

function learnerToken(userId: string, email = `${userId}@example.com`): string {
  return JSON.stringify({ sub: userId, role: 'role_common', email });
}

// --- In-memory setup ------------------------------------------------------
//
// Fakes are built as closures over plain arrays so no local type/interface
// declaration is needed here (the convention lint forbids `type`/`interface`
// outside `*.types.ts`).

function setup(seed?: {
  users?: PaymentUserRecord[];
  materials?: PaymentMaterialRecord[];
  entitlements?: PaymentEntitlementRecord[];
  payments?: PaymentRecord[];
  keySecret?: string;
  webhookSecret?: string;
  orderIdFactory?: () => string;
  failCreatePayment?: boolean;
  failUpdateStatus?: boolean;
  failUpsertEntitlement?: boolean;
}) {
  const store = {
    users: [...(seed?.users ?? [])],
    materials: [...(seed?.materials ?? [])],
    entitlements: [...(seed?.entitlements ?? [])] as PaymentEntitlementRecord[],
    payments: [...(seed?.payments ?? [])] as PaymentRecord[],
  };
  const createdOrders: { amount: number; currency: string }[] = [];
  const keySecret = seed?.keySecret ?? KEY_SECRET;
  const webhookSecret = seed?.webhookSecret ?? WEBHOOK_SECRET;

  function makePayment(input: {
    userId: string;
    studyMaterialId: string;
    amount: number;
    currency?: string;
    razorpayOrderId: string;
  }): PaymentRecord {
    const now = new Date();
    return {
      id: nextId('pay'),
      userId: input.userId,
      studyMaterialId: input.studyMaterialId,
      amount: input.amount,
      currency: input.currency ?? 'INR',
      status: PAYMENT_STATUS.CREATED as PaymentStatus,
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  const deps: PaymentServiceDeps = {
    payments: {
      async createPayment(input) {
        if (seed?.failCreatePayment === true) {
          throw new Error('simulated create failure');
        }
        const record = makePayment(input);
        store.payments.push(record);
        return record;
      },
      async findPaymentByRazorpayOrderId(orderId) {
        return (
          store.payments.find((p) => p.razorpayOrderId === orderId) ?? null
        );
      },
      async updatePaymentStatus(id, input) {
        if (seed?.failUpdateStatus === true) {
          throw new Error('simulated update failure');
        }
        const record = store.payments.find((p) => p.id === id);
        if (record === undefined) {
          throw new Error('payment not found');
        }
        record.status = input.status;
        if (input.razorpayPaymentId !== undefined) {
          record.razorpayPaymentId = input.razorpayPaymentId;
        }
        record.updatedAt = new Date();
        return record;
      },
    },
    entitlements: {
      async findEntitlement(userId, studyMaterialId) {
        return (
          store.entitlements.find(
            (e) => e.userId === userId && e.studyMaterialId === studyMaterialId,
          ) ?? null
        );
      },
      async upsertEntitlement(input) {
        if (seed?.failUpsertEntitlement === true) {
          throw new Error('simulated entitlement failure');
        }
        const existing = store.entitlements.find(
          (e) =>
            e.userId === input.userId &&
            e.studyMaterialId === input.studyMaterialId,
        );
        if (existing !== undefined) {
          return existing;
        }
        const record: PaymentEntitlementRecord = {
          id: nextId('ent'),
          userId: input.userId,
          studyMaterialId: input.studyMaterialId,
        };
        store.entitlements.push(record);
        return record;
      },
    },
    materials: {
      async findMaterialById(id) {
        return store.materials.find((m) => m.id === id) ?? null;
      },
    },
    users: {
      async findUserById(id) {
        return store.users.find((u) => u.id === id) ?? null;
      },
    },
    async createOrder(input) {
      createdOrders.push({ amount: input.amount, currency: input.currency });
      const id = seed?.orderIdFactory?.() ?? nextId('order');
      return { id };
    },
    verifyPaymentSignature(input) {
      const expected = computePaymentSignature(
        input.razorpayOrderId,
        input.razorpayPaymentId,
        keySecret,
      );
      return expected === input.razorpaySignature;
    },
    verifyWebhookSignature(rawBody, signature) {
      const expected = computeHmacSha256(rawBody, webhookSecret);
      return expected === signature;
    },
    verifyToken(token) {
      try {
        const parsed = JSON.parse(token) as AccessTokenClaims;
        if (typeof parsed.sub !== 'string' || parsed.role === undefined) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
    razorpayKeyId: KEY_ID,
  };

  const service = createPaymentService(deps);
  return { store, service, createdOrders, keySecret, webhookSecret };
}

/** Assert a promise rejects with an AppError carrying a given status code. */
async function expectStatus(p: Promise<unknown>, statusCode: number) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await p.catch((err: AppError) => {
    expect(err.statusCode).toBe(statusCode);
  });
}

const paidMaterial = (
  id = 'mat_paid',
  amount = 5000,
): PaymentMaterialRecord => ({ id, priceAmount: amount, currency: 'INR' });
const freeMaterial = (id = 'mat_free'): PaymentMaterialRecord => ({
  id,
  priceAmount: null,
  currency: 'INR',
});

// --- initiatePayment ------------------------------------------------------

describe('initiatePayment', () => {
  function seeded(extra?: Parameters<typeof setup>[0]) {
    return setup({
      users: [{ id: 'user_1', email: 'ada@example.com' }],
      materials: [paidMaterial('mat_1', 5000), freeMaterial('mat_free')],
      ...extra,
    });
  }

  it('creates an order and a Payment Record with status created', async () => {
    const { service, store, createdOrders } = seeded();
    const result = await service.initiatePayment(
      learnerToken('user_1'),
      'mat_1',
    );
    expect(result.razorpayKeyId).toBe(KEY_ID);
    expect(result.amount).toBe(5000);
    expect(result.currency).toBe('INR');
    expect(result.studyMaterialId).toBe('mat_1');
    expect(createdOrders).toHaveLength(1);
    expect(store.payments).toHaveLength(1);
    expect(store.payments[0].status).toBe(PAYMENT_STATUS.CREATED);
    expect(store.payments[0].razorpayOrderId).toBe(result.razorpayOrderId);
  });

  it('rejects an unresolved learner with 401 and creates no order (Req 6.10)', async () => {
    const { service, store, createdOrders } = seeded();
    await expectStatus(service.initiatePayment('garbage', 'mat_1'), 401);
    await expectStatus(
      service.initiatePayment(learnerToken('ghost'), 'mat_1'),
      401,
    );
    expect(createdOrders).toHaveLength(0);
    expect(store.payments).toHaveLength(0);
  });

  it('rejects an admin token with 401 (no learner User Record)', async () => {
    const { service } = seeded();
    const adminToken = JSON.stringify({
      sub: 'admin_1',
      role: 'role_admin',
      username: 'root',
    });
    await expectStatus(service.initiatePayment(adminToken, 'mat_1'), 401);
  });

  it('returns 404 for a missing material and creates no order', async () => {
    const { service, createdOrders } = seeded();
    await expectStatus(
      service.initiatePayment(learnerToken('user_1'), 'missing'),
      404,
    );
    expect(createdOrders).toHaveLength(0);
  });

  it('rejects a Free Material with 422 and creates no order (Req 12.10)', async () => {
    const { service, store, createdOrders } = seeded();
    await expectStatus(
      service.initiatePayment(learnerToken('user_1'), 'mat_free'),
      422,
    );
    expect(createdOrders).toHaveLength(0);
    expect(store.payments).toHaveLength(0);
  });

  it('rejects an already-entitled learner with 409 and no duplicate order (Req 12.11)', async () => {
    const { service, store, createdOrders } = seeded({
      entitlements: [
        { id: 'ent_1', userId: 'user_1', studyMaterialId: 'mat_1' },
      ],
    });
    await expectStatus(
      service.initiatePayment(learnerToken('user_1'), 'mat_1'),
      409,
    );
    expect(createdOrders).toHaveLength(0);
    expect(store.payments).toHaveLength(0);
  });

  it('logs and surfaces a 500 when the Payment Record cannot be persisted (Req 12.14)', async () => {
    const { service, store } = seeded({ failCreatePayment: true });
    await expectStatus(
      service.initiatePayment(learnerToken('user_1'), 'mat_1'),
      500,
    );
    expect(store.entitlements).toHaveLength(0);
  });
});

// --- verifyPayment --------------------------------------------------------

describe('verifyPayment', () => {
  function seededWithPayment(status: PaymentStatus = PAYMENT_STATUS.CREATED) {
    const orderId = 'order_abc';
    const payment: PaymentRecord = {
      id: 'pay_1',
      userId: 'user_1',
      studyMaterialId: 'mat_1',
      amount: 5000,
      currency: 'INR',
      status,
      razorpayOrderId: orderId,
      razorpayPaymentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ctx = setup({ payments: [payment] });
    return { ...ctx, orderId, payment };
  }

  it('grants entitlement and marks successful on a valid signature (Req 12.6, 12.8)', async () => {
    const { service, store, orderId, keySecret } = seededWithPayment();
    const paymentId = 'rp_pay_123';
    const signature = computePaymentSignature(orderId, paymentId, keySecret);

    const result = await service.verifyPayment({
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    });

    expect(result.entitled).toBe(true);
    expect(result.status).toBe(PAYMENT_STATUS.SUCCESSFUL);
    expect(store.payments[0].status).toBe(PAYMENT_STATUS.SUCCESSFUL);
    expect(store.payments[0].razorpayPaymentId).toBe(paymentId);
    expect(store.entitlements).toHaveLength(1);
    expect(store.entitlements[0]).toMatchObject({
      userId: 'user_1',
      studyMaterialId: 'mat_1',
    });
  });

  it('marks failed and grants nothing on an invalid signature (Req 12.7)', async () => {
    const { service, store, orderId } = seededWithPayment();
    await expectStatus(
      service.verifyPayment({
        razorpayOrderId: orderId,
        razorpayPaymentId: 'rp_pay_123',
        razorpaySignature: 'not-the-right-signature',
      }),
      400,
    );
    expect(store.payments[0].status).toBe(PAYMENT_STATUS.FAILED);
    expect(store.entitlements).toHaveLength(0);
  });

  it('fails with 400 and grants nothing when no Payment Record matches (Req 12.18)', async () => {
    const { service, store } = setup({});
    await expectStatus(
      service.verifyPayment({
        razorpayOrderId: 'unknown_order',
        razorpayPaymentId: 'rp_pay_123',
        razorpaySignature: 'anything',
      }),
      400,
    );
    expect(store.entitlements).toHaveLength(0);
  });

  it('does not trust a client success claim without a valid signature (Req 12.15)', async () => {
    const { service, store, orderId } = seededWithPayment();
    // Client asserts success by sending a plausible-looking but wrong signature.
    await expectStatus(
      service.verifyPayment({
        razorpayOrderId: orderId,
        razorpayPaymentId: 'rp_pay_123',
        razorpaySignature: 'client-claims-success',
      }),
      400,
    );
    expect(store.entitlements).toHaveLength(0);
  });

  it('logs and surfaces 500 without entitlement when the grant cannot persist (Req 12.14)', async () => {
    const orderId = 'order_x';
    const { service, store, keySecret } = setup({
      payments: [
        {
          id: 'pay_x',
          userId: 'user_1',
          studyMaterialId: 'mat_1',
          amount: 5000,
          currency: 'INR',
          status: PAYMENT_STATUS.CREATED as PaymentStatus,
          razorpayOrderId: orderId,
          razorpayPaymentId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      failUpsertEntitlement: true,
    });
    const signature = computePaymentSignature(orderId, 'rp_pay', keySecret);
    await expectStatus(
      service.verifyPayment({
        razorpayOrderId: orderId,
        razorpayPaymentId: 'rp_pay',
        razorpaySignature: signature,
      }),
      500,
    );
    expect(store.entitlements).toHaveLength(0);
  });

  it('is idempotent: re-verifying yields exactly one Entitlement', async () => {
    const { service, store, orderId, keySecret } = seededWithPayment();
    const paymentId = 'rp_pay_123';
    const signature = computePaymentSignature(orderId, paymentId, keySecret);
    const confirmation = {
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    };
    await service.verifyPayment(confirmation);
    await service.verifyPayment(confirmation);
    expect(store.entitlements).toHaveLength(1);
    expect(
      store.payments.filter((p) => p.status === PAYMENT_STATUS.SUCCESSFUL),
    ).toHaveLength(1);
  });
});

// --- handleWebhook --------------------------------------------------------

function webhookBody(
  event: string,
  orderId: string | null,
  paymentId: string | null,
): string {
  return JSON.stringify({
    event,
    payload: {
      payment: {
        entity: {
          ...(paymentId !== null ? { id: paymentId } : {}),
          ...(orderId !== null ? { order_id: orderId } : {}),
        },
      },
    },
  });
}

describe('handleWebhook', () => {
  function seededWithPayment() {
    const orderId = 'order_wh';
    const payment: PaymentRecord = {
      id: 'pay_wh',
      userId: 'user_1',
      studyMaterialId: 'mat_1',
      amount: 5000,
      currency: 'INR',
      status: PAYMENT_STATUS.CREATED as PaymentStatus,
      razorpayOrderId: orderId,
      razorpayPaymentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return { ...setup({ payments: [payment] }), orderId };
  }

  it('rejects an unverified webhook with 400 and changes nothing (Req 12.19, 12.24)', async () => {
    const { service, store, orderId } = seededWithPayment();
    const body = webhookBody(WEBHOOK_EVENT_PAYMENT_CAPTURED, orderId, 'rp_1');
    await expectStatus(service.handleWebhook(body, 'wrong-signature'), 400);
    expect(store.payments[0].status).toBe(PAYMENT_STATUS.CREATED);
    expect(store.entitlements).toHaveLength(0);
  });

  it('confirms payment + entitlement on a verified payment.captured (Req 12.19)', async () => {
    const { service, store, orderId, webhookSecret } = seededWithPayment();
    const body = webhookBody(WEBHOOK_EVENT_PAYMENT_CAPTURED, orderId, 'rp_1');
    const signature = computeHmacSha256(body, webhookSecret);

    const result = await service.handleWebhook(body, signature);
    expect(result.handled).toBe(true);
    expect(store.payments[0].status).toBe(PAYMENT_STATUS.SUCCESSFUL);
    expect(store.entitlements).toHaveLength(1);
  });

  it('is a no-op for a verified event with an unknown order', async () => {
    const { service, store, webhookSecret } = seededWithPayment();
    const body = webhookBody(WEBHOOK_EVENT_PAYMENT_CAPTURED, 'unknown', 'rp_1');
    const signature = computeHmacSha256(body, webhookSecret);
    const result = await service.handleWebhook(body, signature);
    expect(result.handled).toBe(false);
    expect(store.entitlements).toHaveLength(0);
  });

  it('is a no-op for a verified non-captured event', async () => {
    const { service, store, orderId, webhookSecret } = seededWithPayment();
    const body = webhookBody('payment.failed', orderId, 'rp_1');
    const signature = computeHmacSha256(body, webhookSecret);
    const result = await service.handleWebhook(body, signature);
    expect(result.handled).toBe(false);
    expect(store.payments[0].status).toBe(PAYMENT_STATUS.CREATED);
  });
});

// --- parseWebhookEvent (pure) --------------------------------------------

describe('parseWebhookEvent', () => {
  it('extracts event, order id, and payment id', () => {
    const body = webhookBody('payment.captured', 'order_1', 'pay_1');
    expect(parseWebhookEvent(body)).toEqual({
      event: 'payment.captured',
      razorpayOrderId: 'order_1',
      razorpayPaymentId: 'pay_1',
    });
  });

  it('returns null for non-JSON or a body without a string event', () => {
    expect(parseWebhookEvent('not json')).toBeNull();
    expect(parseWebhookEvent(JSON.stringify({ payload: {} }))).toBeNull();
  });
});

// --- Property 25: Payment initiation preconditions ------------------------

describe('Property 25: Payment initiation preconditions', () => {
  // Validates: Requirements 6.10, 12.4, 12.10, 12.11
  it('creates exactly one order+record iff resolvable, paid, and not entitled', () => {
    fc.assert(
      fc.asyncProperty(
        fc.boolean(), // learner resolves
        fc.boolean(), // material is paid
        fc.boolean(), // already entitled
        fc.integer({ min: 1, max: 1000000 }), // paid amount
        async (resolves, isPaid, entitled, amount) => {
          const users: PaymentUserRecord[] = resolves
            ? [{ id: 'user_1', email: 'ada@example.com' }]
            : [];
          const material: PaymentMaterialRecord = isPaid
            ? { id: 'mat_1', priceAmount: amount, currency: 'INR' }
            : { id: 'mat_1', priceAmount: null, currency: 'INR' };
          const entitlements: PaymentEntitlementRecord[] =
            entitled && resolves
              ? [{ id: 'ent_1', userId: 'user_1', studyMaterialId: 'mat_1' }]
              : [];
          const { service, store, createdOrders } = setup({
            users,
            materials: [material],
            entitlements,
          });

          const shouldSucceed = resolves && isPaid && !entitled;
          const promise = service.initiatePayment(
            learnerToken('user_1'),
            'mat_1',
          );

          if (shouldSucceed) {
            const result = await promise;
            expect(createdOrders).toHaveLength(1);
            expect(store.payments).toHaveLength(1);
            expect(store.payments[0].status).toBe(PAYMENT_STATUS.CREATED);
            expect(result.amount).toBe(amount);
            return;
          }

          await promise.then(
            () => {
              throw new Error('expected rejection');
            },
            (err) => {
              expect(err).toBeInstanceOf(AppError);
              // No order and no Payment Record on any rejected precondition.
              expect(createdOrders).toHaveLength(0);
              expect(store.payments).toHaveLength(0);
              // Expected status: 401 unresolved > 422 free > 409 entitled.
              const expectedStatus = !resolves
                ? 401
                : !isPaid
                  ? 422
                  : 409;
              expect((err as AppError).statusCode).toBe(expectedStatus);
            },
          );
        },
      ),
    );
  });
});

// --- Property 26: Signature verification is the sole determinant ----------

describe('Property 26: server-side signature verification is the sole determinant', () => {
  // Validates: Requirements 12.6, 12.7, 12.15, 12.16, 12.18
  it('grants entitlement iff the record exists and the signature matches exactly', () => {
    const idArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);
    fc.assert(
      fc.asyncProperty(
        fc.boolean(), // a Payment Record exists for the order
        fc.boolean(), // the presented signature is the correct one
        idArb, // order id
        idArb, // payment id
        fc.stringMatching(/^[a-z0-9]{6,20}$/), // a wrong signature candidate
        async (recordExists, correctSig, orderId, paymentId, wrongSig) => {
          const payments: PaymentRecord[] = recordExists
            ? [
                {
                  id: 'pay_1',
                  userId: 'user_1',
                  studyMaterialId: 'mat_1',
                  amount: 5000,
                  currency: 'INR',
                  status: PAYMENT_STATUS.CREATED as PaymentStatus,
                  razorpayOrderId: orderId,
                  razorpayPaymentId: null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
              ]
            : [];
          const { service, store, keySecret } = setup({ payments });

          const validSig = computePaymentSignature(
            orderId,
            paymentId,
            keySecret,
          );
          // Ensure the "wrong" signature is genuinely different from the valid one.
          const signature = correctSig
            ? validSig
            : wrongSig === validSig
              ? `${wrongSig}x`
              : wrongSig;

          const shouldGrant = recordExists && correctSig;
          const promise = service.verifyPayment({
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: signature,
          });

          if (shouldGrant) {
            const result = await promise;
            expect(result.entitled).toBe(true);
            expect(store.entitlements).toHaveLength(1);
            expect(store.payments[0].status).toBe(PAYMENT_STATUS.SUCCESSFUL);
            return;
          }

          await promise.then(
            () => {
              throw new Error('expected verification failure');
            },
            (err) => {
              expect(err).toBeInstanceOf(AppError);
              expect((err as AppError).statusCode).toBe(400);
              // Never grants an Entitlement on failure (Req 12.7, 12.18).
              expect(store.entitlements).toHaveLength(0);
              // When a record exists it is marked failed (Req 12.7).
              if (recordExists) {
                expect(store.payments[0].status).toBe(PAYMENT_STATUS.FAILED);
              }
            },
          );
        },
      ),
    );
  });
});

// --- Property 27: Payment Record timestamps are valid ISO 8601 ------------

describe('Property 27: Payment Record timestamps are valid ISO 8601', () => {
  // Validates: Requirements 12.9
  it('created and updated Payment Records carry valid ISO 8601 timestamps', () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000000 }),
        async (amount) => {
          const { service, store, keySecret } = setup({
            users: [{ id: 'user_1', email: 'ada@example.com' }],
            materials: [{ id: 'mat_1', priceAmount: amount, currency: 'INR' }],
          });
          // Create (status=created) then update (status=successful) the record.
          const order = await service.initiatePayment(
            learnerToken('user_1'),
            'mat_1',
          );
          const paymentId = 'rp_pay';
          const signature = computePaymentSignature(
            order.razorpayOrderId,
            paymentId,
            keySecret,
          );
          await service.verifyPayment({
            razorpayOrderId: order.razorpayOrderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: signature,
          });

          const record = store.payments[0];
          expect(ISO_8601_PATTERN.test(record.createdAt.toISOString())).toBe(
            true,
          );
          expect(ISO_8601_PATTERN.test(record.updatedAt.toISOString())).toBe(
            true,
          );
        },
      ),
    );
  });
});

// --- Property 29: Webhook gating + idempotent confirmation ----------------

describe('Property 29: webhook signature gates action and confirmation is idempotent', () => {
  // Validates: Requirements 12.19
  it('acts iff the signature verifies; any number of confirmations yields one entitlement', () => {
    fc.assert(
      fc.asyncProperty(
        // A sequence of confirmations: each is either the verify endpoint or a
        // webhook, and each webhook either carries a valid or invalid signature.
        fc.array(
          fc.record({
            channel: fc.constantFrom('verify', 'webhook'),
            validSig: fc.boolean(),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        async (confirmations) => {
          const orderId = 'order_prop';
          const paymentId = 'rp_pay_prop';
          const { service, store, keySecret, webhookSecret } = setup({
            payments: [
              {
                id: 'pay_prop',
                userId: 'user_1',
                studyMaterialId: 'mat_1',
                amount: 5000,
                currency: 'INR',
                status: PAYMENT_STATUS.CREATED as PaymentStatus,
                razorpayOrderId: orderId,
                razorpayPaymentId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          });

          const paymentSig = computePaymentSignature(
            orderId,
            paymentId,
            keySecret,
          );
          const body = webhookBody(
            WEBHOOK_EVENT_PAYMENT_CAPTURED,
            orderId,
            paymentId,
          );
          const webhookSig = computeHmacSha256(body, webhookSecret);

          let anyValid = false;
          for (const c of confirmations) {
            if (c.channel === 'verify') {
              const sig = c.validSig ? paymentSig : 'bad-signature';
              if (c.validSig) anyValid = true;
              await service
                .verifyPayment({
                  razorpayOrderId: orderId,
                  razorpayPaymentId: paymentId,
                  razorpaySignature: sig,
                })
                .catch(() => undefined);
            } else {
              const sig = c.validSig ? webhookSig : 'bad-signature';
              if (c.validSig) anyValid = true;
              await service.handleWebhook(body, sig).catch(() => undefined);
            }
          }

          if (anyValid) {
            // Exactly one Entitlement and one successful Payment Record.
            expect(store.entitlements).toHaveLength(1);
            expect(
              store.payments.filter(
                (p) => p.status === PAYMENT_STATUS.SUCCESSFUL,
              ),
            ).toHaveLength(1);
          } else {
            // No verified confirmation → no Entitlement; record never successful.
            expect(store.entitlements).toHaveLength(0);
            expect(store.payments[0].status).not.toBe(
              PAYMENT_STATUS.SUCCESSFUL,
            );
          }
        },
      ),
    );
  });
});
