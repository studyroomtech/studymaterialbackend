// Admin Test-series routes — Test / Section / Question authoring (Req 1.5, 1.6,
// 2.5, 3.5, 4.4).
//
// Wires the admin (role_admin) Test-authoring HTTP surface onto the admin Test
// controller handlers (`controllers/adminTestSeries.controller.ts`). This
// module only maps HTTP methods/paths to those handlers and interposes
// middleware; it holds no business logic.
//
// Middleware chain (mirroring `admin.routes.ts`):
//   - `authMiddleware` runs first on every request and resolves the caller's
//     Role from the presented Access Token (role_common by default), attaching
//     it to `req.auth`.
//   - `requireAdmin` then guards every route so only an authenticated Admin
//     holding role_admin proceeds; an unauthenticated caller gets
//     `AUTH_REQUIRED` (401) and a role_common caller gets `FORBIDDEN` (403),
//     with no Test/Section/Question modified (Req 1.5, 1.6).
//   - `validate(...)` (Zod) rejects a malformed body/params with per-field
//     errors (422) before any controller/service runs, so persistence is never
//     reached on a bad request (Req 2.5, 3.5, 4.4). Authoritative bounds are
//     re-checked by the Test authoring service; the Zod layer shapes the input
//     and shares the same bounds constants (`limits.constant.ts`).
//
// The router declares paths relative to the `/api` mount point (matching the
// design's Route table: `POST /api/admin/tests`, `PATCH /api/admin/sections/:id`,
// …); mounting it under `/api` alongside the existing routers is the
// app-assembly step (task 10.4).

import { Router } from 'express';
import { z } from 'zod';

import {
  addQuestionHandler,
  addSectionHandler,
  createTestHandler,
  editQuestionHandler,
  editSectionHandler,
  editTestHandler,
  getTestForAdminHandler,
} from '../controllers/adminTestSeries.controller';
import {
  MIN_CORRECT_OPTIONS_PER_QUESTION,
  MIN_OPTIONS_PER_QUESTION,
  OPTION_TEXT_MAX_LENGTH,
  OPTION_TEXT_MIN_LENGTH,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_TEXT_MIN_LENGTH,
  TEST_TITLE_MAX_LENGTH,
  TEST_TITLE_MIN_LENGTH,
} from '../constants/limits.constant';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/requireAdmin.middleware';
import { validate } from '../middleware/validate.middleware';

// --- Zod validation schemas ------------------------------------------------
//
// Bounds come from `limits.constant.ts` so validation shares one source of
// truth with the Test authoring service and the requirements. On failure the
// validate middleware forwards a ValidationError (422) naming each invalid
// field, and no persistence occurs (Req 2.5, 3.5, 4.4).

// A required, non-empty identifier route parameter (`:id`).
const idParamsSchema = z.object({
  id: z.string().min(1),
});

// The Timing Mode is exactly one of Overall Timing or Sectional Timing (Req 2.2).
const timingModeSchema = z.enum(['overall', 'sectional']);

// An optional Price amount: absent/null denotes a free product; when present it
// must be a positive integer in the smallest currency unit (paise) (Req 2.3,
// 3.2). Authoritative Currency/bounds checks live in the service.
const priceAmountSchema = z.number().int().positive().nullable().optional();
const currencySchema = z.string().min(1).nullable().optional();

// A single authoring Option — display text 1–1000 and a correct/incorrect flag
// (Req 4.1).
const optionInputSchema = z.object({
  text: z.string().min(OPTION_TEXT_MIN_LENGTH).max(OPTION_TEXT_MAX_LENGTH),
  isCorrect: z.boolean(),
});

// A Question's Options: two or more Options with at least one flagged correct
// (Req 4.1, 4.2, 4.4).
const optionsSchema = z
  .array(optionInputSchema)
  .min(MIN_OPTIONS_PER_QUESTION)
  .refine(
    (options) =>
      options.filter((option) => option.isCorrect).length >=
      MIN_CORRECT_OPTIONS_PER_QUESTION,
    { message: 'A Question must have at least one correct Option.' },
  );

// A Question supplied while authoring a Section — text 1–2000 plus its Options
// (Req 4.1).
const questionInputSchema = z.object({
  text: z.string().min(QUESTION_TEXT_MIN_LENGTH).max(QUESTION_TEXT_MAX_LENGTH),
  options: optionsSchema,
});

// `POST /api/admin/tests` — create a Test: title 1–200, a Timing Mode, a
// positive whole-second overall Time Limit, and an optional Price (Req 2.1–2.5).
const createTestBodySchema = z.object({
  title: z.string().min(TEST_TITLE_MIN_LENGTH).max(TEST_TITLE_MAX_LENGTH),
  timingMode: timingModeSchema,
  timeLimitSeconds: z.number().int().positive(),
  priceAmount: priceAmountSchema,
  currency: currencySchema,
});

// `PATCH /api/admin/tests/:id` — edit Test-level fields only; every field is
// optional and omitted fields are left unchanged (Req 5.5).
const editTestBodySchema = z.object({
  title: z
    .string()
    .min(TEST_TITLE_MIN_LENGTH)
    .max(TEST_TITLE_MAX_LENGTH)
    .optional(),
  timingMode: timingModeSchema.optional(),
  timeLimitSeconds: z.number().int().positive().optional(),
  priceAmount: priceAmountSchema,
  currency: currencySchema,
});

// `POST /api/admin/tests/:id/sections` — add a Section with an optional inline
// set of Questions: positive Time Limit, non-negative Correct/Negative marks,
// and an optional Price (Req 3.1–3.5).
const createSectionBodySchema = z.object({
  title: z.string().min(TEST_TITLE_MIN_LENGTH).max(TEST_TITLE_MAX_LENGTH),
  timeLimitSeconds: z.number().int().positive(),
  correctMark: z.number().nonnegative(),
  negativeMark: z.number().nonnegative(),
  priceAmount: priceAmountSchema,
  currency: currencySchema,
  questions: z.array(questionInputSchema).optional(),
});

// `PATCH /api/admin/sections/:id` — edit a persisted Section; every field is
// optional and, when supplied, `questions` fully replaces the Section's
// Questions (Req 5.2, 5.5).
const editSectionBodySchema = z.object({
  title: z
    .string()
    .min(TEST_TITLE_MIN_LENGTH)
    .max(TEST_TITLE_MAX_LENGTH)
    .optional(),
  timeLimitSeconds: z.number().int().positive().optional(),
  correctMark: z.number().nonnegative().optional(),
  negativeMark: z.number().nonnegative().optional(),
  priceAmount: priceAmountSchema,
  currency: currencySchema,
  questions: z.array(questionInputSchema).optional(),
});

// `POST /api/admin/sections/:id/questions` — append a Question (text 1–2000, ≥2
// Options each 1–1000, ≥1 correct) to a Section (Req 4.1, 4.4).
const createQuestionBodySchema = questionInputSchema;

// `PATCH /api/admin/questions/:id` — edit a persisted Question; every field is
// optional and, when supplied, `options` fully replaces the Question's Options
// (still ≥2 Options / ≥1 correct) (Req 5.2).
const editQuestionBodySchema = z.object({
  text: z
    .string()
    .min(QUESTION_TEXT_MIN_LENGTH)
    .max(QUESTION_TEXT_MAX_LENGTH)
    .optional(),
  options: optionsSchema.optional(),
});

/**
 * Build the configured admin Test-series router. Every route passes through
 * `authMiddleware` then `requireAdmin` (attached at the router level, since —
 * unlike `admin.routes.ts` — there is no login entry point to exempt), and each
 * route additionally validates its params/body with Zod before the controller
 * runs. Mount at `/api` so the effective routes are `POST /api/admin/tests`,
 * `PATCH /api/admin/tests/:id`, `POST /api/admin/tests/:id/sections`,
 * `PATCH /api/admin/sections/:id`, `POST /api/admin/sections/:id/questions`,
 * `PATCH /api/admin/questions/:id`, and `GET /api/admin/tests/:id`.
 */
export function createAdminTestSeriesRouter(): Router {
  const router = Router();

  // Resolve the caller's Role, then require role_admin for every Test-authoring
  // action (Req 1.5, 1.6).
  router.use(authMiddleware);
  router.use(requireAdmin);

  // --- Test authoring ----------------------------------------------------
  router.post(
    '/admin/tests',
    validate({ body: createTestBodySchema }),
    createTestHandler,
  );

  router.patch(
    '/admin/tests/:id',
    validate({ params: idParamsSchema, body: editTestBodySchema }),
    editTestHandler,
  );

  router.get(
    '/admin/tests/:id',
    validate({ params: idParamsSchema }),
    getTestForAdminHandler,
  );

  // --- Section authoring -------------------------------------------------
  router.post(
    '/admin/tests/:id/sections',
    validate({ params: idParamsSchema, body: createSectionBodySchema }),
    addSectionHandler,
  );

  router.patch(
    '/admin/sections/:id',
    validate({ params: idParamsSchema, body: editSectionBodySchema }),
    editSectionHandler,
  );

  // --- Question authoring ------------------------------------------------
  router.post(
    '/admin/sections/:id/questions',
    validate({ params: idParamsSchema, body: createQuestionBodySchema }),
    addQuestionHandler,
  );

  router.patch(
    '/admin/questions/:id',
    validate({ params: idParamsSchema, body: editQuestionBodySchema }),
    editQuestionHandler,
  );

  return router;
}
