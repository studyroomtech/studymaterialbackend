// Fixture data for the database seed.
//
// Holds the free Sequential Sectional Timing demo Test created by
// `prisma/seed.ts`. It exists so the Test Series flow — starting an attempt,
// watching a Section's clock run out, and being carried into the next Section —
// can be exercised on a fresh database without first authoring a Test through
// the admin UI.
//
// The Section Time Limits are deliberately short (2, 3, and 2 minutes) so a
// reviewer can watch a Section expire and the next one activate in one sitting.
// Marks are integer centi-marks (1 mark = 100, R3): +1 for a correct answer,
// -0.25 for a wrong one.

export const DEMO_SECTIONAL_TEST = {
  title: 'Demo Sectional Mock Test',
  // The overall Time Limit is unused under Sectional Timing (each Section is
  // timed independently) but the column is required, so it is set to the sum of
  // the Section limits to stay self-consistent.
  timeLimitSeconds: 420,
  correctMarkCenti: 100,
  negativeMarkCenti: 25,
  sections: [
    {
      title: 'Quantitative Aptitude',
      timeLimitSeconds: 120,
      questions: [
        {
          text: 'What is 15% of 240?',
          options: [
            { text: '36', isCorrect: true },
            { text: '32', isCorrect: false },
            { text: '40', isCorrect: false },
            { text: '24', isCorrect: false },
          ],
        },
        {
          text: 'A train travels 180 km in 3 hours. What is its average speed?',
          options: [
            { text: '50 km/h', isCorrect: false },
            { text: '60 km/h', isCorrect: true },
            { text: '65 km/h', isCorrect: false },
            { text: '75 km/h', isCorrect: false },
          ],
        },
        {
          text: 'If x + 7 = 19, what is the value of 3x?',
          options: [
            { text: '30', isCorrect: false },
            { text: '33', isCorrect: false },
            { text: '36', isCorrect: true },
            { text: '39', isCorrect: false },
          ],
        },
      ],
    },
    {
      title: 'Logical Reasoning',
      timeLimitSeconds: 180,
      questions: [
        {
          text: 'Which number comes next in the sequence: 2, 6, 12, 20, 30, ?',
          options: [
            { text: '40', isCorrect: false },
            { text: '42', isCorrect: true },
            { text: '44', isCorrect: false },
            { text: '46', isCorrect: false },
          ],
        },
        {
          text: 'All roses are flowers. Some flowers fade quickly. Which conclusion definitely follows?',
          options: [
            { text: 'All roses fade quickly', isCorrect: false },
            { text: 'Some roses fade quickly', isCorrect: false },
            { text: 'All flowers are roses', isCorrect: false },
            { text: 'None of these definitely follows', isCorrect: true },
          ],
        },
        {
          text: 'If MONDAY is coded as NPOEBZ, how is FRIDAY coded?',
          options: [
            { text: 'GSJEBZ', isCorrect: true },
            { text: 'GSJDBZ', isCorrect: false },
            { text: 'FSJEBZ', isCorrect: false },
            { text: 'GSIEBZ', isCorrect: false },
          ],
        },
      ],
    },
    {
      title: 'Verbal Ability',
      timeLimitSeconds: 120,
      questions: [
        {
          text: 'Choose the word most nearly opposite in meaning to "ABUNDANT".',
          options: [
            { text: 'Plentiful', isCorrect: false },
            { text: 'Scarce', isCorrect: true },
            { text: 'Ample', isCorrect: false },
            { text: 'Copious', isCorrect: false },
          ],
        },
        {
          text: 'Select the correctly spelled word.',
          options: [
            { text: 'Occurrence', isCorrect: true },
            { text: 'Occurence', isCorrect: false },
            { text: 'Ocurrence', isCorrect: false },
            { text: 'Occurrance', isCorrect: false },
          ],
        },
        {
          text: 'Fill in the blank: The committee ___ divided on the proposal.',
          options: [
            { text: 'were', isCorrect: false },
            { text: 'was', isCorrect: true },
            { text: 'have', isCorrect: false },
            { text: 'are', isCorrect: false },
          ],
        },
      ],
    },
  ],
} as const;
