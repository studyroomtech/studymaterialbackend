// Types for the pure scoring service (Req 1.15: all type/interface declarations
// live only in `*.types.ts`).
//
// These describe the input to the pure, all-or-nothing multiple-correct scoring
// logic in `scoring.service.ts` (D4, Req 13). Marks are integer centi-marks
// (1 mark = 100 centi-marks, R3) so a Test Attempt's Score is an exact integer
// sum with no floating-point drift.

/**
 * The scoring input for a single Question.
 *
 * A Question is scored Correct only when the Learner's selected Option set is
 * exactly equal to the Question's Correct Option Set (Req 13.1). The selected
 * set is `null` when the Question has no recorded Response (an unanswered
 * Question, Req 13.4).
 */
export interface QuestionScoringInput {
  /** The ids of the Options flagged correct — the Question's Correct Option Set (Req 13.1). */
  correctOptionIds: readonly string[];
  /**
   * The ids of the Options the Learner selected, or `null` when the Question
   * has no recorded Response (unanswered, Req 13.4).
   */
  selectedOptionIds: readonly string[] | null;
  /** Non-negative centi-marks awarded when the Question is exactly correct (Req 13.2, R3). */
  correctMarkCenti: number;
  /** Non-negative centi-marks deducted when the Question is answered but not exact (Req 13.3, R3). */
  negativeMarkCenti: number;
}
