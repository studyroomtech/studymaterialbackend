// Types for the Razorpay signature-verification service (Req 1.15: type
// declarations live only in `*.types.ts`).
//
// These describe the untrusted, client-supplied Payment confirmation the
// Backend API verifies server-side before granting any Payment Entitlement
// (Req 12.15, 12.16). The Razorpay Key Secret used to recompute the signature
// is never part of these types — it is read from the environment and held only
// in the Backend Project (Req 12.17).

/**
 * A Payment confirmation returned by Razorpay Checkout to the Frontend Project
 * and forwarded to the Backend API for server-side Payment Signature
 * Verification (Req 12.16). This request body is treated as untrusted input;
 * an Entitlement is granted only when the recomputed HMAC-SHA256 matches
 * `razorpaySignature` exactly (Req 12.15, 12.16).
 */
export interface PaymentSignatureInput {
  /** The Razorpay Order Identifier of the Payment being confirmed. */
  razorpayOrderId: string;
  /** The Razorpay Payment Identifier assigned to the completed payment. */
  razorpayPaymentId: string;
  /** The Razorpay Signature to verify against the recomputed HMAC-SHA256. */
  razorpaySignature: string;
}
