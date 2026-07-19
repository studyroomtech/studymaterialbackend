// Types for the Attempt controller (Req 1.15: type/interface declarations live
// only in `*.types.ts`).
//
// These describe the JSON response bodies the Attempt controller shapes around
// the DTOs the attempt service already serializes (ISO 8601 UTC `Z` timestamps,
// integer paise + Currency, decimal marks — R3, Req 16.3, 16.5). Each body
// wraps the relevant DTO under a named key, mirroring the `{ material }` /
// `{ test }` shape used by the other controllers, so the Frontend Project
// consumes a stable envelope for every attempt endpoint.

import type {
  AttemptHistoryItemDto,
  AttemptQuestionsDto,
  AttemptReviewDto,
  AttemptStateDto,
} from '../types/domain.types';
import type { AttemptResultDto } from '../services/attempt.service.types';

/**
 * Response body carrying the server-authoritative attempt state (Req 9.1, 10.1,
 * 10.3, 12.7). Returned by start Test / start Section / pause / resume / submit
 * Response / retake — the client renders this state as-is.
 */
export interface AttemptStateResponse {
  attempt: AttemptStateDto;
}

/**
 * Response body carrying the finalized attempt result (Req 11.4, 12.7): the
 * completed attempt with its computed Score (decimal marks) and completion time.
 */
export interface AttemptResultResponse {
  result: AttemptResultDto;
}

/**
 * Response body for the completed-attempt history list, most recently completed
 * first (Req 14.1). An empty array signals "no completed attempts".
 */
export interface AttemptHistoryResponse {
  attempts: AttemptHistoryItemDto[];
}

/**
 * Response body for one owner-scoped attempt review (Req 14.2): each in-scope
 * Question with its Options, Correct Option Set, and the Learner's Response.
 */
export interface AttemptReviewResponse {
  review: AttemptReviewDto;
}

/**
 * Response body for the in-scope Questions of an open attempt (Req 9.4): the
 * attempt id and its Questions with Option text only (never correctness) plus
 * the Learner's current selection per Question.
 */
export interface AttemptQuestionsResponse {
  questions: AttemptQuestionsDto;
}

/**
 * The submit-Response request body (Req 9.4): the Learner's selected Option set
 * for one Question. Zod validation lives in the routes (task 10.2); the
 * controller reads this shape and forwards it to the service verbatim.
 */
export interface SubmitResponseBody {
  questionId: string;
  selectedOptionIds: string[];
}
