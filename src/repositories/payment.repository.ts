// Payment Record repository (Req 12.4, 12.6, 12.7, 12.8, 12.9).
//
// Wraps Prisma access to the `Payment` table. A Payment is initiated with
// status `created` when a Razorpay order is created (Req 12.4), looked up by
// its unique Razorpay Order Identifier during Payment Signature Verification
// (Req 12.18), and transitioned to `successful` or `failed` once verification
// resolves (Req 12.6, 12.7). The `createdAt`/`updatedAt` timestamps are managed
// by the schema and serialized ISO 8601 (Req 12.9).

import type { Payment } from '@prisma/client';

import { getPrismaClient } from './prismaClient';
import type {
  CreatePaymentInput,
  UpdatePaymentStatusInput,
} from './payment.repository.types';

/**
 * Persist a newly initiated Payment Record with status `created` (Req 12.4).
 * The status defaults to `created` via the schema. The `currency` is omitted
 * from the write when not supplied so the schema default (`INR`) applies.
 */
export function createPayment(input: CreatePaymentInput): Promise<Payment> {
  return getPrismaClient().payment.create({
    data: {
      userId: input.userId,
      studyMaterialIds: input.studyMaterialIds,
      amount: input.amount,
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      razorpayOrderId: input.razorpayOrderId,
    },
  });
}

/**
 * Find a Payment Record by its unique Razorpay Order Identifier, or `null` when
 * none exists. Backs Payment Signature Verification, which resolves the Payment
 * Record first and treats a missing record as verification failure (Req 12.18).
 */
export function findPaymentByRazorpayOrderId(
  razorpayOrderId: string
): Promise<Payment | null> {
  return getPrismaClient().payment.findUnique({
    where: { razorpayOrderId },
  });
}

/**
 * Transition a Payment Record to a new status, optionally recording the
 * Razorpay Payment Identifier on a successful verification (Req 12.6, 12.7).
 * The `updatedAt` timestamp is refreshed automatically by the schema.
 */
export function updatePaymentStatus(
  id: string,
  input: UpdatePaymentStatusInput
): Promise<Payment> {
  return getPrismaClient().payment.update({
    where: { id },
    data: {
      status: input.status,
      ...(input.razorpayPaymentId !== undefined
        ? { razorpayPaymentId: input.razorpayPaymentId }
        : {}),
    },
  });
}
