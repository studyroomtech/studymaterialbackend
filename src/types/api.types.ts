// HTTP request/response DTO types for the Study Materials Platform Backend API.
//
// All responses use JSON; errors follow the single error envelope defined in
// the design's Error Handling section (Req 8.1, 8.3, 8.4). These types cover
// the Phase 1 (MVP) endpoints: catalog, search, material view, the Download
// Gate, downloads, admin login, and content management. Payment/paid-material
// request and response DTOs are added in Phase 2.

import type {
  CategoryTypeDto,
  MaterialDto,
  PaymentStatus,
  SectionalTestListingDto,
  TestSeriesListingDto,
} from './domain.types';

/**
 * A single invalid field reported by a validation error, naming the field and
 * the reason it is invalid (Req 8.3).
 */
export interface ApiErrorFieldDto {
  field: string;
  reason: string;
}

/**
 * The error body carried by the unified error envelope. `fields` is present
 * for validation errors that identify each invalid field (Req 8.3, 8.4).
 */
export interface ApiErrorDto {
  code: string;
  message: string;
  fields?: ApiErrorFieldDto[];
}

/**
 * The single error envelope returned for every non-success response
 * (Req 8.4). No stack traces or internal identifiers are ever included.
 */
export interface ApiErrorResponse {
  error: ApiErrorDto;
}

/**
 * `GET /api/catalog` — the Material Catalog structure (Req 3.1, 3.10, 2.5).
 */
export interface CatalogResponse {
  categoryTypes: CategoryTypeDto[];
  materials: MaterialDto[];
}

/**
 * `GET /api/tests` — the Home Page test listings (Req 6.1–6.4). Carries the
 * Test Series list (every Test, including free) and the Sectional Tests list
 * (only Sections whose Price amount is present and positive), each in the
 * deterministic `createdAt asc, id asc` order the service preserves.
 */
export interface TestListingsResponse {
  testSeries: TestSeriesListingDto[];
  sectionalTests: SectionalTestListingDto[];
}

/**
 * Query parameters for `GET /api/materials/search` (Req 4.1, 4.2, 4.4).
 */
export interface SearchMaterialsQuery {
  q?: string;
  categoryId?: string;
}

/**
 * `GET /api/materials/search` response. An empty `materials` array signals
 * "no matching materials" (Req 4.5); `matched` is the count of matches.
 */
export interface SearchMaterialsResponse {
  materials: MaterialDto[];
  matched: number;
}

/**
 * `POST /api/downloads/gate` request — the Download Gate submission
 * (Req 6.2–6.3).
 */
export interface DownloadGateRequest {
  name: string;
  email: string;
}

/**
 * `POST /api/downloads/gate` response — the issued Access Token and its
 * lifetime in seconds (Req 6.5).
 */
export interface DownloadGateResponse {
  accessToken: string;
  expiresInSeconds: number;
}

/**
 * `POST /api/materials/:id/download` response — a short-lived presigned R2
 * GET URL plus the file name (Req 6.8, 9.1).
 */
export interface DownloadResponse {
  downloadUrl: string;
  fileName: string;
  expiresInSeconds: number;
}

/**
 * `POST /api/materials/:id/preview` response — a short-lived URL that renders
 * the Study Material inline for preview, plus the file name and Content-Type
 * (so the Frontend can pick a viewer). No Download Record is created (Req 5.1).
 */
export interface PreviewResponse {
  previewUrl: string;
  fileName: string;
  contentType: string;
  expiresInSeconds: number;
}

/**
 * `POST /api/account/login` request — a name + email learner sign-in (Req 6.2,
 * 6.3). An optional `password` may be supplied; its presence triggers
 * password-protected verification against the resolved account (Req 3, 4).
 */
export interface AccountLoginRequest {
  name: string;
  email: string;
  /**
   * Optional password. When present, the account is authenticated against its
   * stored password hash; when absent, an Unprotected Account signs in as
   * before (Req 3, 4).
   */
  password?: string;
}

/**
 * `POST /api/account/login` response — the issued learner Access Token, its
 * lifetime in seconds (Req 6.5), and the resolved name/email so the Frontend
 * Project can display the signed-in identity.
 */
export interface AccountLoginResponse {
  accessToken: string;
  expiresInSeconds: number;
  name: string;
  email: string;
  /** The Roles held by the signed-in User Record (from `User.roles`). */
  roles: string[];
  /**
   * The account's protection status — present only on a successful sign-in so
   * that no failed sign-in can reveal whether the account is protected
   * (Req 3.3, 7.4).
   */
  passwordProtected: boolean;
}

/**
 * `POST /api/account/password` request — set (first time) or change a
 * Learner's password. `currentPassword` is required only when changing an
 * existing password on a Password-Protected Account (Req 2.6).
 */
export interface SetPasswordRequest {
  newPassword: string;
  currentPassword?: string;
}

/**
 * `POST /api/account/password` response — the account is Password-Protected
 * after a successful set (Req 2.1).
 */
export interface SetPasswordResponse {
  passwordProtected: true;
}

/**
 * `GET /api/account/me` response — the signed-in Learner's profile and the
 * authoritative `passwordProtected` status derived from the DB, so the Frontend
 * can reconcile its cached protection state with the source of truth. Never
 * includes the stored `passwordHash` (Req 6.4).
 */
export interface AccountMeResponse {
  name: string;
  email: string;
  roles: string[];
  passwordProtected: boolean;
}

/**
 * `POST /api/admin/login` request — admin credentials (Req 10.5).
 */
export interface AdminLoginRequest {
  username: string;
  password: string;
}

/**
 * `POST /api/admin/login` response — a role_admin Access Token and lifetime
 * (Req 10.5).
 */
export interface AdminLoginResponse {
  adminToken: string;
  expiresInSeconds: number;
}

/**
 * `POST /api/admin/materials` fields — Study Material upload metadata
 * (multipart; the file is carried separately). Title 1–200, description
 * 0–2000 (Req 11.1–11.2). An optional Price may be supplied: `priceAmount`
 * (a positive integer for a Paid Material, or `null`/`0` for a Free Material)
 * and `currency` (defaulting to INR). The Price bounds/Currency are validated
 * authoritatively by the service (Req 11.13–11.15).
 */
export interface MaterialUploadRequest {
  title: string;
  description?: string;
  priceAmount?: number | null;
  currency?: string | null;
}

/**
 * `PATCH /api/admin/materials/:id` body — editable Study Material metadata
 * (Req 11.5–11.6). An optional Price (`priceAmount` + `currency`) may be
 * supplied and is validated by the service; an omitted `priceAmount` leaves the
 * existing Price unchanged (Req 11.13–11.15).
 */
export interface MaterialEditRequest {
  title?: string;
  description?: string;
  priceAmount?: number | null;
  currency?: string | null;
}

/**
 * `POST /api/admin/materials/:id/tags` body — assign a Tag by Category id
 * (Req 2.3).
 */
export interface AssignTagRequest {
  categoryId: string;
}

/**
 * Request body for creating or renaming a Category Type (Req 11.7–11.8).
 */
export interface CategoryTypeRequest {
  name: string;
}

/**
 * Request body for creating a Category under an existing Category Type
 * (Req 11.9).
 */
export interface CategoryRequest {
  name: string;
  categoryTypeId: string;
}

/**
 * Request body for renaming a Category (Req 11.10).
 */
export interface CategoryRenameRequest {
  name: string;
}

/**
 * A response carrying a single Study Material, returned by upload/edit and the
 * material view endpoint (Req 5.1, 11.1, 11.5).
 */
export interface MaterialResponse {
  material: MaterialDto;
}

// --- Paid Materials & Payments (Phase 2, Req 12) --------------------------

/**
 * A Paid Material as surfaced in the Paid Materials Tab listing (Req 12.1).
 * Carries only the safe browse-time metadata plus the Price; it never includes
 * the Object Storage Key, file bytes, or a presigned URL — content access
 * stays gated by a Payment Entitlement (Req 12.3).
 */
export interface PaidMaterialDto {
  id: string;
  title: string;
  description: string;
  priceAmount: number;
  currency: string;
  isPaid: true;
  /**
   * Whether the requesting Learner already holds a Payment Entitlement for this
   * material — `true` shows View/Download instead of Buy (Req 12.3). Resolved
   * from the caller's Access Token; `false` for an unauthenticated caller.
   */
  isEntitled: boolean;
}

/**
 * `GET /api/materials/paid` response — the list of Paid Materials with their
 * Price and Currency for the Paid Materials Tab (Req 12.1).
 */
export interface PaidMaterialsResponse {
  materials: PaidMaterialDto[];
}

/**
 * `POST /api/materials/:id/payment` response — the Razorpay order details the
 * Frontend Project needs to present checkout (Req 12.4, 12.5). Only the
 * non-secret Razorpay Public Key Identifier (`keyId`) is included; the Razorpay
 * Key Secret is never exposed (Req 12.17).
 */
export interface PaymentInitiateResponse {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  /** The Paid Materials this order covers (the chargeable subset of the cart). */
  studyMaterialIds: string[];
}

/**
 * `POST /api/payments/verify` request — the untrusted Payment confirmation
 * forwarded from Razorpay Checkout for server-side Payment Signature
 * Verification (Req 12.6, 12.15, 12.16).
 */
export interface PaymentVerifyRequest {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * `POST /api/payments/verify` response — the verified Payment outcome. An
 * Entitlement is reflected only when server-side verification succeeded
 * (Req 12.6, 12.8).
 */
export interface PaymentVerifyResponse {
  verified: boolean;
  status: PaymentStatus;
  studyMaterialIds: string[];
  entitled: boolean;
}

/**
 * `POST /api/payments/webhook` response — a minimal acknowledgement for a
 * signature-verified Razorpay Webhook event (Req 12.19). `handled` is `true`
 * only when a verified `payment.captured` event confirmed a matching Payment
 * Record and Entitlement.
 */
export interface PaymentWebhookResponse {
  received: true;
  handled: boolean;
}
