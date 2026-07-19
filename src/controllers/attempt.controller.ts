// Attempt controller — the learner attempt lifecycle (Req 8–15, 17).
//
// Shapes the HTTP surface of the attempt endpoints, holding no business logic
// of its own — start/resume, pause/resume, Response recording, submit + score,
// retake, and the history/review reads all live in `attempt.service.ts`, which
// composes the pure `timing`, `scoring`, and `access` cores and is
// server-authoritative for every timing/scoring/access decision:
//
//   - `POST /api/tests/:id/attempts`    — start or resume a whole-Test attempt (Req 9.1).
//   - `POST /api/sections/:id/attempts` — start or resume a Section-scoped attempt (Req 8.2).
//   - `POST /api/attempts/:id/pause`    — pause an in_progress attempt (Req 10.1).
//   - `POST /api/attempts/:id/resume`   — resume a paused attempt (Req 10.3).
//   - `POST /api/attempts/:id/responses`— record a Response (Req 9.4, 11.4, 12.7).
//   - `POST /api/attempts/:id/submit`   — finalize + score the attempt (Req 11.4, 12.7).
//   - `POST /api/tests/:id/retake`      — start a fresh attempt, preserving history (Req 15.1).
//   - `GET  /api/attempts`              — the caller's completed-attempt history (Req 14.1).
//   - `GET  /api/attempts/:id`          — one owner-scoped attempt review (Req 14.2).
//
// Like `download.controller.ts` / `payment.controller.ts`, the handlers extract
// the raw JWT from an `Authorization: Bearer <token>` header and pass it as the
// service's first argument; the service resolves the Learner (and derives the
// admin flag) and maps an absent/invalid credential to a 401. All timestamps
// serialize ISO 8601 UTC `Z` and marks as decimal marks — the service already
// shapes those (Req 16.3, 16.5). Thrown `AppError`s are forwarded via
// `next(error)` for the central error handler to map to the unified envelope.

import type { NextFunction, Request, Response } from 'express';

import { createDefaultAttemptService } from '../services/attempt.service';
import type {
  AttemptHistoryResponse,
  AttemptQuestionsResponse,
  AttemptResultResponse,
  AttemptReviewResponse,
  AttemptStateResponse,
  SubmitResponseBody,
} from './attempt.controller.types';

const BEARER_PREFIX = 'Bearer ';

/**
 * Extract the raw JWT from an `Authorization: Bearer <token>` header, returning
 * an empty string when the header is absent or is not a non-empty Bearer
 * credential (mirrors `download.controller.ts`). The attempt service treats an
 * empty/invalid token as an auth failure and returns a 401 (Req 8.5).
 */
function extractBearerToken(header: string | undefined): string {
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    return '';
  }
  return header.slice(BEARER_PREFIX.length).trim();
}

/**
 * `POST /api/tests/:id/attempts` — start or resume a whole-Test attempt
 * (Req 9.1, 9.5). Returns the caller's existing in_progress/paused attempt when
 * one exists; otherwise gates on access (a Payment is required unless the Test
 * is free or the caller is an admin) and creates a fresh attempt.
 */
export async function startTestAttemptHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const attempt = await createDefaultAttemptService().startTest(
      token,
      req.params.id,
    );
    const body: AttemptStateResponse = { attempt };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/sections/:id/attempts` — start or resume a Section-scoped attempt
 * for a Section Entitlement (Req 8.2, 9.5). Gates on the Section's access and
 * times the attempt by that Section's Time Limit.
 */
export async function startSectionAttemptHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const attempt = await createDefaultAttemptService().startSection(
      token,
      req.params.id,
    );
    const body: AttemptStateResponse = { attempt };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/attempts/:id/pause` — pause an in_progress attempt (Req 10.1,
 * 10.6). Banks the current active interval; a non-in_progress attempt is
 * rejected by the service with a 422.
 */
export async function pauseAttemptHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const attempt = await createDefaultAttemptService().pause(
      token,
      req.params.id,
    );
    const body: AttemptStateResponse = { attempt };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/attempts/:id/resume` — resume a paused attempt (Req 10.3, 10.5,
 * 10.7). Any scope already at its Time Limit is closed rather than reopened; a
 * non-paused attempt is rejected by the service with a 422.
 */
export async function resumeAttemptHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const attempt = await createDefaultAttemptService().resume(
      token,
      req.params.id,
    );
    const body: AttemptStateResponse = { attempt };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/attempts/:id/responses` — record the Learner's selected Option set
 * for one Question (Req 9.4, 11.4, 12.7). The `{ questionId, selectedOptionIds }`
 * body is validated by Zod in the routes (task 10.2); the service reconciles
 * timing first and rejects a paused/completed/expired or out-of-scope Response
 * with a 422.
 */
export async function submitResponseHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const { questionId, selectedOptionIds } = req.body as SubmitResponseBody;
    const attempt = await createDefaultAttemptService().submitResponse(
      token,
      req.params.id,
      { questionId, selectedOptionIds },
    );
    const body: AttemptStateResponse = { attempt };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/attempts/:id/submit` — finalize an attempt: mark it completed and
 * compute + persist its Score in one transaction (Req 11.4, 12.7). Returns the
 * completed attempt's result (Score as decimal marks, completion time).
 */
export async function submitAttemptHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const result = await createDefaultAttemptService().submitAttempt(
      token,
      req.params.id,
    );
    const body: AttemptResultResponse = { result };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/tests/:id/retake` — start a fresh attempt for an entitled/free/admin
 * Test, preserving prior attempts (Req 15.1–15.3). Returns an existing in-flight
 * attempt when one exists (Req 15.6); otherwise creates a new attempt without a
 * new Payment.
 */
export async function retakeTestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const attempt = await createDefaultAttemptService().retakeTest(
      token,
      req.params.id,
    );
    const body: AttemptStateResponse = { attempt };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/attempts` — the caller's completed-attempt history, most recently
 * completed first (Req 14.1). An empty array signals "no completed attempts".
 */
export async function listAttemptHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const attempts = await createDefaultAttemptService().listHistory(token);
    const body: AttemptHistoryResponse = { attempts };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/attempts/:id` — one owner-scoped completed attempt with its full
 * review graph (Req 14.2, 14.4): each in-scope Question, its Options, the
 * Correct Option Set, and the Learner's recorded Response. A missing or unowned
 * attempt surfaces uniformly as a 404.
 */
export async function getAttemptReviewHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const review = await createDefaultAttemptService().getAttemptReview(
      token,
      req.params.id,
    );
    const body: AttemptReviewResponse = { review };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/attempts/:id/questions` — the in-scope Questions for the caller's
 * open attempt (Req 9.4): each Question's text and Options (id + text only,
 * never correctness) plus the Learner's current selection. Owner-scoped — a
 * missing or unowned attempt surfaces uniformly as a 404.
 */
export async function getAttemptQuestionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const questions = await createDefaultAttemptService().getAttemptQuestions(
      token,
      req.params.id,
    );
    const body: AttemptQuestionsResponse = { questions };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}
