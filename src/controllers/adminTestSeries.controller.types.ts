// Types for the admin Test-series controller (Req 1.15: type/interface
// declarations live only in `*.types.ts`).
//
// These describe the JSON response bodies the admin Test-series controller
// shapes around the DTOs the Test authoring service already serializes
// (ISO 8601 UTC `Z` timestamps, integer paise + Currency, decimal marks — R3,
// Req 16.3, 16.5). Each body wraps the affected entity's DTO under a named key,
// mirroring the `{ material }` shape used by the admin material endpoints.

import type {
  AdminTestDto,
  QuestionDto,
  SectionDto,
  TestDto,
} from '../services/testSeries.service.types';

/** Response body for creating/editing a Test (Req 2.1, 5.5). */
export interface AdminTestResponse {
  test: TestDto;
}

/** Response body for the full authoring view of a Test (Req 5.3). */
export interface AdminTestGraphResponse {
  test: AdminTestDto;
}

/** Response body for adding/editing a Section (+ its Questions) (Req 3.1, 5.1, 5.2). */
export interface AdminSectionResponse {
  section: SectionDto;
}

/** Response body for adding/editing a Question (Req 4.1, 5.2). */
export interface AdminQuestionResponse {
  question: QuestionDto;
}
