// Learner Test Series routes — Home Page listings and the attempt lifecycle
// (Req 6.1, 8.5, 9.1, 10.1, 10.3, 11.4, 12.7, 14.1, 14.2, 15.1).
//
// Wires the learner-facing Test Series endpoints, delegating all business logic
// to the catalog controller (the `GET /tests` listings) and the attempt
// controller (start/pause/resume/respond/submit/retake and history/review).
// The router is designed to be mounted at `/api` by the Express app assembly
// (task 10.4), so paths are declared relative to that mount point, matching the
// design's route table:
//
//   - `GET  /api/tests`                  — Test Series + Sectional listings (Req 6.1).
//   - `POST /api/tests/:id/attempts`     — start/resume a whole-Test attempt (Req 9.1).
//   - `POST /api/sections/:id/attempts`  — start/resume a Section-scoped attempt (Req 8.5).
//   - `POST /api/attempts/:id/next-section` — close the active Section early and
//                                          activate the next (Sequential Sectional Timing).
//   - `POST /api/attempts/:id/pause`     — pause an in_progress attempt (Req 10.1).
//   - `POST /api/attempts/:id/resume`    — resume a paused attempt (Req 10.3).
//   - `POST /api/attempts/:id/responses` — record a Response (Req 11.4, 12.7).
//   - `POST /api/attempts/:id/submit`    — finalize + score the attempt (Req 11.4, 12.7).
//   - `POST /api/tests/:id/retake`       — start a fresh attempt, preserving history (Req 15.1).
//   - `GET  /api/attempts`               — the caller's completed-attempt history (Req 14.1).
//   - `GET  /api/attempts/performance`   — the caller's performance across every
//                                          completed attempt (totals, per-Test
//                                          trend, per-Section strong/weak areas).
//   - `GET  /api/attempts/:id/questions` — the in-scope Questions for an open attempt (Req 9.4).
//   - `GET  /api/attempts/:id/state`     — the reconciled state of an open attempt.
//   - `GET  /api/attempts/:id`           — one owner-scoped completed attempt review (Req 14.2).
//
// Every route runs behind `authMiddleware` so the caller's Role is resolved
// before the handler executes; the attempt controller then extracts the Bearer
// token itself and surfaces a missing/invalid credential as a 401 (Req 8.5).
// Per the design's route table, `GET /api/tests` is served behind `auth` like
// the rest. The submit-Response body is additionally validated by Zod against
// `{ questionId, selectedOptionIds }` so a malformed Response is rejected with
// a 422 before the controller runs (Req 9.4).

import { Router } from 'express';
import { z } from 'zod';

import {
  advanceSectionHandler,
  getAttemptQuestionsHandler,
  getAttemptReviewHandler,
  getAttemptStateHandler,
  getPerformanceHandler,
  listAttemptHistoryHandler,
  pauseAttemptHandler,
  resumeAttemptHandler,
  retakeTestHandler,
  startSectionAttemptHandler,
  startTestAttemptHandler,
  submitAttemptHandler,
  submitResponseHandler,
} from '../controllers/attempt.controller';
import { getTestListingsHandler } from '../controllers/testSeriesCatalog.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';

/**
 * Body schema for `POST /api/attempts/:id/responses` — the Learner's selected
 * Option set for one Question. `questionId` must be a non-empty string and
 * `selectedOptionIds` an array of non-empty strings (possibly empty, signalling
 * "no option selected"). A malformed body is rejected with a 422 before the
 * controller/service runs (Req 9.4).
 */
const submitResponseBodySchema = z.object({
  questionId: z.string().min(1),
  selectedOptionIds: z.array(z.string().min(1)),
});

/**
 * Router exposing the learner Test Series listings and attempt-lifecycle
 * endpoints. Mount at `/api` so the effective routes match the design's route
 * table (e.g. `GET /api/tests`, `POST /api/attempts/:id/responses`).
 */
const testSeriesRouter: Router = Router();

testSeriesRouter.use(authMiddleware);

testSeriesRouter.get('/tests', getTestListingsHandler);

testSeriesRouter.post('/tests/:id/attempts', startTestAttemptHandler);
testSeriesRouter.post('/sections/:id/attempts', startSectionAttemptHandler);

testSeriesRouter.post('/attempts/:id/next-section', advanceSectionHandler);
testSeriesRouter.post('/attempts/:id/pause', pauseAttemptHandler);
testSeriesRouter.post('/attempts/:id/resume', resumeAttemptHandler);
testSeriesRouter.post(
  '/attempts/:id/responses',
  validate({ body: submitResponseBodySchema }),
  submitResponseHandler,
);
testSeriesRouter.post('/attempts/:id/submit', submitAttemptHandler);

testSeriesRouter.post('/tests/:id/retake', retakeTestHandler);

testSeriesRouter.get('/attempts', listAttemptHistoryHandler);
// Declared before `/attempts/:id` so "performance" is not matched as an attempt
// id — Express resolves routes in registration order.
testSeriesRouter.get('/attempts/performance', getPerformanceHandler);
testSeriesRouter.get('/attempts/:id/questions', getAttemptQuestionsHandler);
testSeriesRouter.get('/attempts/:id/state', getAttemptStateHandler);
testSeriesRouter.get('/attempts/:id', getAttemptReviewHandler);

export { testSeriesRouter };
export default testSeriesRouter;
