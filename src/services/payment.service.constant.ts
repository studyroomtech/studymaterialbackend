// Constant values for the Payment service (Req 1.16: all constant values live
// in a `*.constant.ts` file).
//
// The Price bounds, default Currency, and Payment Status values are shared via
// `constants/payment.constant.ts`; this module holds the payment-service-specific
// Razorpay Webhook event name that the service acts on (Req 12.19).

/**
 * The Razorpay Webhook event that confirms a captured payment (Req 12.19). Only
 * a verified event of this type triggers idempotent confirmation of the
 * matching Payment Record and Entitlement; any other event type is a safe
 * no-op.
 */
export const WEBHOOK_EVENT_PAYMENT_CAPTURED = 'payment.captured';
