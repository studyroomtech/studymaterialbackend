// Pure all-or-nothing multiple-correct scoring with negative marking (D4,
// Req 13).
//
// This module contains only pure, side-effect-free functions. It operates over
// Option-id sets and integer centi-marks (1 mark = 100 centi-marks, R3), so a
// Test Attempt's Score (Req 13.5) is an exact integer sum that is deterministic
// across platforms — the same reason money is stored as integer paise. It
// performs no I/O and holds no state, so the scoring rules can be reasoned about
// in isolation from the HTTP/persistence layers.
//
// Rules:
//   - A Question is Correct only when the selected Option set is exactly equal
//     to the Correct Option Set (Req 13.1): award +correctMarkCenti (Req 13.2).
//   - A Question answered with a set that is not exactly equal: deduct
//     -negativeMarkCenti (Req 13.3).
//   - A Question with no recorded Response: add and subtract zero (Req 13.4).
//   - A Test Attempt's Score is the sum across all its Questions (Req 13.5).

import type { QuestionScoringInput } from './scoring.service.types';

/**
 * Whether the selected Option-id set is exactly equal to the Correct Option Set
 * (Req 13.1).
 *
 * Set equality: order and duplicates are irrelevant — the two sets are equal
 * iff they contain the same distinct ids. This is the sole condition under
 * which a Question is treated as correctly answered.
 */
export function isExactlyCorrect(
  selected: readonly string[],
  correct: readonly string[],
): boolean {
  const selectedSet = new Set(selected);
  const correctSet = new Set(correct);
  if (selectedSet.size !== correctSet.size) {
    return false;
  }
  for (const id of selectedSet) {
    if (!correctSet.has(id)) {
      return false;
    }
  }
  return true;
}

/**
 * The marks (in centi-marks) awarded for a single Question (Req 13.2–13.4).
 *
 * - No recorded Response (`selectedOptionIds === null`) → `0` (Req 13.4).
 * - Selected set exactly equals the Correct Option Set → `+correctMarkCenti`
 *   (Req 13.1, 13.2).
 * - Answered but not exactly correct → `-negativeMarkCenti` (Req 13.3).
 */
export function scoreQuestion(input: QuestionScoringInput): number {
  // An unanswered Question neither adds nor subtracts (Req 13.4).
  if (input.selectedOptionIds === null) {
    return 0;
  }
  // Exactly correct → award the Section's Correct Mark (Req 13.1, 13.2).
  if (isExactlyCorrect(input.selectedOptionIds, input.correctOptionIds)) {
    return input.correctMarkCenti;
  }
  // Answered but not exactly correct → deduct the Section's Negative Mark (Req 13.3).
  return -input.negativeMarkCenti;
}

/**
 * The total Score (in centi-marks) for a Test Attempt: the integer sum of
 * `scoreQuestion` across every Question (Req 13.5).
 */
export function scoreAttempt(questions: readonly QuestionScoringInput[]): number {
  let total = 0;
  for (const question of questions) {
    total += scoreQuestion(question);
  }
  return total;
}
