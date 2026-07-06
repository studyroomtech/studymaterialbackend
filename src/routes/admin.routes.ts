// Admin routes — Content Management Actions (Req 10.5, 11, 2.2–2.3).
//
// Wires the admin (role_admin) HTTP surface: admin login, Study Material CRUD
// (title/description/file — no price in Phase 1), Tag assign/remove, and
// Category Type / Category management. Handlers live in
// `controllers/admin.controller.ts`; this module only maps HTTP methods/paths
// to those handlers and interposes middleware.
//
// Middleware chain:
//   - `authMiddleware` runs first on every admin request and resolves the
//     caller's Role from the presented Access Token (role_common by default),
//     attaching it to `req.auth` (Req 10.2–10.4).
//   - `requireAdmin` then guards every Content Management Action so only an
//     authenticated Admin holding role_admin proceeds; unauthenticated callers
//     get 401 and role_common callers get 403, with no data mutated
//     (Req 10.5–10.8, 11.16).
//   - `validate(...)` (Zod) rejects malformed requests with per-field errors
//     before any controller/service runs, so persistence is never reached on a
//     bad request (Req 8.3).
//
// `POST /api/admin/login` is the one exception to `requireAdmin`: it is the
// authentication entry point that issues the role_admin token, so it cannot
// itself require an admin token. It still passes through `authMiddleware` (the
// router-level default) and Zod validation.
//
// Study Material upload is multipart: `multer` (in-memory storage) parses the
// single `file` part and the accompanying text fields, populating `req.file`
// and `req.body` before validation and the controller run. Both upload and edit
// accept an optional Price (`priceAmount` + `currency`): on the multipart
// upload the amount arrives as a text field and is coerced to a number here,
// while on the JSON edit it arrives as a number/`null`. Authoritative bounds
// and Currency validation is performed by `material.service` via
// `price.service.validatePrice`; the Zod layer only shapes/coerces the fields,
// and price-setting stays behind `requireAdmin` like every other Content
// Management Action (Req 11.13, 11.16).
//
// This module exports a configured Router only; mounting it under `/api/admin`
// and attaching the central error handler is the app-assembly step (task 9.4).

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import {
  adminLoginHandler,
  assignTagHandler,
  createCategoryHandler,
  createCategoryTypeHandler,
  deleteCategoryHandler,
  deleteCategoryTypeHandler,
  deleteMaterialHandler,
  editMaterialHandler,
  removeTagHandler,
  renameCategoryHandler,
  renameCategoryTypeHandler,
  uploadMaterialHandler,
} from '../controllers/admin.controller';
import {
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_NAME_MIN_LENGTH,
  CATEGORY_TYPE_NAME_MAX_LENGTH,
  CATEGORY_TYPE_NAME_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '../constants/limits.constant';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/requireAdmin.middleware';
import { validate } from '../middleware/validate.middleware';

// Multipart parser for the single Study Material `file` part (Req 11.1). Bytes
// are held in memory so the material service can hand them to Object Storage;
// the controller reads the parsed file from `req.file`.
const upload = multer({ storage: multer.memoryStorage() });

// --- Zod validation schemas ------------------------------------------------
//
// Bounds come from `limits.constant.ts` so validation shares one source of
// truth with the services and requirements. On failure the validate middleware
// forwards a ValidationError (422) naming each invalid field (Req 8.3).

// A required, non-empty identifier route parameter (`:id`).
const idParamsSchema = z.object({
  id: z.string().min(1),
});

// Optional multipart Price amount: on the multipart upload every field arrives
// as a string, so an absent/empty value stays `undefined` (Free Material
// default) while any other value is parsed to a number — a non-numeric string
// surfaces as `NaN`, which `price.service.validatePrice` rejects with a 422
// naming `priceAmount`. Authoritative bounds/Currency checks live in the
// service, so this only coerces the shape (Req 11.13, 11.15).
const multipartPriceAmountSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value === undefined || value === '' ? undefined : Number(value),
  );

// `POST /api/admin/login` credentials (Req 10.5).
const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Optional multipart Categories field: the Frontend sends the selected/typed
// category names as a JSON-encoded string array (multipart fields are always
// strings). An absent/empty/malformed value yields an empty list; otherwise it
// is parsed to the string names, which the category service normalizes,
// validates, and resolves/auto-creates. Category name bounds are enforced by
// the service (flat-category UX).
const multipartCategoriesSchema = z
  .string()
  .optional()
  .transform((value): string[] => {
    if (value === undefined || value.trim() === '') {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (entry): entry is string => typeof entry === 'string',
      );
    } catch {
      return [];
    }
  });

// `POST /api/admin/materials` multipart fields — title 1–200, optional
// description 0–2000, an optional Price (Req 11.1–11.2, 11.13), and an optional
// flat list of Category names. The file and the Price bounds/Currency are
// validated by the service.
const materialUploadBodySchema = z.object({
  title: z.string().min(TITLE_MIN_LENGTH).max(TITLE_MAX_LENGTH),
  description: z.string().max(DESCRIPTION_MAX_LENGTH).optional(),
  priceAmount: multipartPriceAmountSchema,
  currency: z.string().optional(),
  categories: multipartCategoriesSchema,
  subjects: multipartCategoriesSchema,
  jobs: multipartCategoriesSchema,
});

// `PATCH /api/admin/materials/:id` — editable metadata; omitted fields are left
// unchanged (Req 11.5–11.6). An optional Price (`priceAmount` as a number or
// `null` for a Free Material, plus `currency`) is accepted and validated for
// bounds/Currency by the service (Req 11.13).
const materialEditBodySchema = z.object({
  title: z.string().min(TITLE_MIN_LENGTH).max(TITLE_MAX_LENGTH).optional(),
  description: z.string().max(DESCRIPTION_MAX_LENGTH).optional(),
  priceAmount: z.number().nullable().optional(),
  currency: z.string().optional(),
});

// `POST /api/admin/materials/:id/tags` — assign a Tag by Category id (Req 2.3).
const assignTagBodySchema = z.object({
  categoryId: z.string().min(1),
});

// `DELETE /api/admin/materials/:id/tags/:categoryId` — remove a Tag (Req 2.4).
const removeTagParamsSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
});

// Category Type name — create/rename (Req 11.7–11.8, 11.11).
const categoryTypeBodySchema = z.object({
  name: z
    .string()
    .min(CATEGORY_TYPE_NAME_MIN_LENGTH)
    .max(CATEGORY_TYPE_NAME_MAX_LENGTH),
});

// Category create under an existing Category Type (Req 11.9, 11.11).
const categoryCreateBodySchema = z.object({
  name: z.string().min(CATEGORY_NAME_MIN_LENGTH).max(CATEGORY_NAME_MAX_LENGTH),
  categoryTypeId: z.string().min(1),
});

// Category rename (Req 11.10, 11.11).
const categoryRenameBodySchema = z.object({
  name: z.string().min(CATEGORY_NAME_MIN_LENGTH).max(CATEGORY_NAME_MAX_LENGTH),
});

/**
 * Build the configured admin router. Every route passes through
 * `authMiddleware` (attached at the router level); all Content Management
 * Actions are additionally guarded by `requireAdmin`, while `POST /login`
 * (the authentication entry point) is intentionally not.
 */
export function createAdminRouter(): Router {
  const router = Router();

  // Resolve the caller's Role for every admin request (Req 10.2–10.4).
  router.use(authMiddleware);

  // --- Admin login (authentication entry point) --------------------------
  // Public relative to requireAdmin: it issues the role_admin token and so
  // cannot itself require one (Req 10.5).
  router.post('/login', validate({ body: loginBodySchema }), adminLoginHandler);

  // --- Study Material CRUD ----------------------------------------------
  // Multipart create: multer parses the `file` part and text fields before
  // validation runs (Req 11.1–11.2).
  router.post(
    '/materials',
    requireAdmin,
    upload.single('file'),
    validate({ body: materialUploadBodySchema }),
    uploadMaterialHandler,
  );

  router.patch(
    '/materials/:id',
    requireAdmin,
    validate({ params: idParamsSchema, body: materialEditBodySchema }),
    editMaterialHandler,
  );

  router.delete(
    '/materials/:id',
    requireAdmin,
    validate({ params: idParamsSchema }),
    deleteMaterialHandler,
  );

  // --- Tag assignment ----------------------------------------------------
  router.post(
    '/materials/:id/tags',
    requireAdmin,
    validate({ params: idParamsSchema, body: assignTagBodySchema }),
    assignTagHandler,
  );

  router.delete(
    '/materials/:id/tags/:categoryId',
    requireAdmin,
    validate({ params: removeTagParamsSchema }),
    removeTagHandler,
  );

  // --- Category Type management -----------------------------------------
  router.post(
    '/category-types',
    requireAdmin,
    validate({ body: categoryTypeBodySchema }),
    createCategoryTypeHandler,
  );

  router.patch(
    '/category-types/:id',
    requireAdmin,
    validate({ params: idParamsSchema, body: categoryTypeBodySchema }),
    renameCategoryTypeHandler,
  );

  router.delete(
    '/category-types/:id',
    requireAdmin,
    validate({ params: idParamsSchema }),
    deleteCategoryTypeHandler,
  );

  // --- Category management ----------------------------------------------
  router.post(
    '/categories',
    requireAdmin,
    validate({ body: categoryCreateBodySchema }),
    createCategoryHandler,
  );

  router.patch(
    '/categories/:id',
    requireAdmin,
    validate({ params: idParamsSchema, body: categoryRenameBodySchema }),
    renameCategoryHandler,
  );

  router.delete(
    '/categories/:id',
    requireAdmin,
    validate({ params: idParamsSchema }),
    deleteCategoryHandler,
  );

  return router;
}
