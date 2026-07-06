// Shared domain DTO types for the Study Materials Platform backend.
//
// These describe the shapes exchanged between the service/controller layers and
// the Frontend Project (Req 1.15: all type/interface declarations live in
// `*.types.ts`). They mirror the Material Catalog and material metadata
// responses defined in the design (Req 2.5, 3.1, 5.1).
//
// Payment-specific DTO types (PaymentStatus, PaymentOrderDto,
// PaymentVerifyResultDto) are introduced in Phase 2 (task 16.1) below.

/**
 * The two Role values supported by the Backend API (Req 10.1).
 * `role_common` is the unauthenticated default; `role_admin` is the elevated,
 * authenticated Role permitted to perform Content Management Actions.
 */
export type Role = 'role_common' | 'role_admin';

/**
 * A Category within a Category Type — a named classification value such as
 * "Mathematics" under Subject (Req 2.1).
 */
export interface CategoryDto {
  id: string;
  name: string;
  categoryTypeId: string;
}

/**
 * A Category Type — a classification dimension (for example, Subject or Job)
 * together with the Categories defined within it (Req 2.1, 3.2).
 */
export interface CategoryTypeDto {
  id: string;
  name: string;
  categories: CategoryDto[];
}

/**
 * A Tag as surfaced under a Category Type in a material's
 * `tagsByCategoryType` map: the assignment of a Category to a Study Material
 * (Req 2.3, 2.5).
 */
export interface TagDto {
  categoryId: string;
  name: string;
}

/**
 * The Tags assigned to a Study Material, grouped by Category Type id. Every
 * supported Category Type key is present; a Category Type with no assigned
 * Tags maps to an empty array (Req 2.5).
 */
export type TagsByCategoryType = Record<string, TagDto[]>;

/**
 * A Study Material's metadata as returned by the catalog and material
 * endpoints. File bytes live in Object Storage; the Object Storage Key is
 * never included in responses (Req 1.13, 3.1, 5.1).
 *
 * The optional file-metadata fields are populated by the single-material
 * endpoint (Req 5.1); the catalog listing may omit them. The optional
 * price fields describe a Paid Material's Price; in Phase 1 all materials are
 * served as Free Materials and these remain unset (price handling and the
 * entitlement gate are added in Phase 2, Req 11.13–11.15, 12).
 */
export interface MaterialDto {
  id: string;
  title: string;
  description: string;
  tagsByCategoryType: TagsByCategoryType;
  fileName?: string;
  contentType?: string;
  fileSizeBytes?: number;
  priceAmount?: number | null;
  currency?: string;
  isPaid?: boolean;
}

/**
 * The state of a Payment (Req 12 glossary: Payment Status). The string values
 * mirror `constants/payment.constant.ts` and form part of the persisted
 * Payment Record and API contract.
 */
export type PaymentStatus = 'created' | 'successful' | 'failed';

/**
 * The Razorpay order details returned to the Frontend Project after the
 * Backend API initiates a Payment (Req 12.4, 12.5). Only the non-secret
 * Razorpay Public Key Identifier is included; the Razorpay Key Secret is never
 * exposed to the client (Req 12.17).
 */
export interface PaymentOrderDto {
  /** The Backend API's Payment Record identifier. */
  paymentId: string;
  /** The Razorpay Order Identifier assigned to the created order. */
  razorpayOrderId: string;
  /** The Paid Material this order is for. */
  studyMaterialId: string;
  /** The charge amount, matching the Paid Material's Price amount. */
  amount: number;
  /** The Currency of the charge (defaults to INR). */
  currency: string;
  /** The non-secret Razorpay Public Key Identifier for presenting checkout. */
  razorpayKeyId: string;
}

/**
 * The outcome of server-side Payment Signature Verification (Req 12.6, 12.15,
 * 12.18). A Payment Entitlement is granted only when `verified` is `true`.
 */
export interface PaymentVerifyResultDto {
  /** Whether Payment Signature Verification succeeded. */
  verified: boolean;
  /** The resulting Payment Status after verification. */
  status: PaymentStatus;
  /** The Paid Material the Payment applies to. */
  studyMaterialId: string;
  /** Whether the Learner now holds a Payment Entitlement for the material. */
  entitled: boolean;
}
