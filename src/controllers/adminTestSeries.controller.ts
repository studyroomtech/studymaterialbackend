// Admin Test-series controller — Test / Section / Question authoring and the
// admin authoring view (Req 2.1, 3.1, 4.1, 5.1, 5.2, 5.3).
//
// Shapes the HTTP surface of the admin (role_admin) Test-authoring endpoints.
// Every handler here runs behind `auth.middleware` + `requireAdmin.middleware`
// and Zod body/param validation (wired in the admin Test routes, task 10.1), so
// authorization and input validation are enforced before any handler executes.
//
// The controller holds no business logic (mirroring `payment.controller.ts` /
// `admin.controller.ts`): create/edit Test, add/edit Section (+ Questions),
// add/edit Question, and the authoring view all delegate to the Test authoring
// service (`createDefaultTestService`). Handlers only read the request, delegate,
// and shape the JSON response — the service DTOs already carry the platform
// serialization (ISO 8601 UTC `Z` timestamps, integer paise + Currency, decimal
// marks — Req 16.2, 16.3, 16.5, R3). Typed domain errors thrown by the service
// (ValidationError → 422 with per-field `fields`, NotFoundError → 404) are
// forwarded to the central error handler via `next(error)`.

import type { NextFunction, Request, Response } from 'express';

import { createDefaultTestService } from '../services/testSeries.service';
import type {
  CreateQuestionInput,
  CreateSectionInput,
  CreateTestInput,
  EditQuestionInput,
  EditSectionInput,
  EditTestInput,
} from '../services/testSeries.service.types';
import type {
  AdminQuestionResponse,
  AdminSectionResponse,
  AdminTestGraphResponse,
  AdminTestResponse,
} from './adminTestSeries.controller.types';

/**
 * `POST /api/admin/tests` — create a Test (title 1–200, Timing Mode, positive
 * overall Time Limit; optional Price) and return its authoring DTO (Req 2.1).
 * An invalid field set is rejected by the service with a 422 naming each
 * offending field, persisting nothing (Req 2.5).
 */
export async function createTestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as CreateTestInput;
    const test = await createDefaultTestService().createTest(input);
    const body: AdminTestResponse = { test };
    res.status(201).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `PATCH /api/admin/tests/:id` — edit Test-level fields only, leaving every
 * Section untouched (Req 5.5). Omitted fields are left unchanged; a missing
 * Test yields a 404 with nothing changed (Req 5.4).
 */
export async function editTestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as EditTestInput;
    const test = await createDefaultTestService().editTest(req.params.id, input);
    const body: AdminTestResponse = { test };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/admin/tests/:id/sections` — add a Section together with its
 * Questions/Options, persisted independently and appended after the existing
 * Sections (Req 3.1, 5.1). A missing Test yields a 404 with nothing persisted
 * (Req 5.4).
 */
export async function addSectionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as CreateSectionInput;
    const section = await createDefaultTestService().addSection(
      req.params.id,
      input,
    );
    const body: AdminSectionResponse = { section };
    res.status(201).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `PATCH /api/admin/sections/:id` — edit a persisted Section (optionally
 * replacing its whole Questions/Options subtree) without altering any other
 * Section (Req 5.2, 5.5). A missing Section yields a 404 with nothing changed
 * (Req 5.4).
 */
export async function editSectionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as EditSectionInput;
    const section = await createDefaultTestService().editSection(
      req.params.id,
      input,
    );
    const body: AdminSectionResponse = { section };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/admin/sections/:id/questions` — append a Question (text 1–2000,
 * ≥2 Options each 1–1000, ≥1 correct) to a Section (Req 4.1). A missing Section
 * yields a 404 with nothing persisted (Req 5.4).
 */
export async function addQuestionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as CreateQuestionInput;
    const question = await createDefaultTestService().addQuestion(
      req.params.id,
      input,
    );
    const body: AdminQuestionResponse = { question };
    res.status(201).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `PATCH /api/admin/questions/:id` — edit a persisted Question (optionally
 * replacing its Options; a supplied Option set must still satisfy the ≥2
 * Options / ≥1 correct bounds) (Req 5.2). A missing Question yields a 404.
 */
export async function editQuestionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as EditQuestionInput;
    const question = await createDefaultTestService().editQuestion(
      req.params.id,
      input,
    );
    const body: AdminQuestionResponse = { question };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/admin/tests/:id` — the full admin authoring view: the Test metadata
 * plus its ordered Sections → Questions → Options (Req 5.3). A missing Test
 * yields a 404 (Req 5.4).
 */
export async function getTestForAdminHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const test = await createDefaultTestService().getTestForAdmin(req.params.id);
    const body: AdminTestGraphResponse = { test };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}
