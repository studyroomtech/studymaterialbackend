// Sequential Sectional Timing — attempt lifecycle behaviour.
//
// Under Sectional Timing exactly one Section is active at a time. A whole-Test
// attempt starts only its first Section (by `orderIndex`); every later Section
// waits at `not_started`. When the active Section reaches its Time Limit, or the
// Learner ends it early via `advanceSection`, it closes permanently and the next
// queued Section is activated. The attempt itself is finalized only once no
// Section remains.
//
// These tests drive `createAttemptService` over an in-memory repository harness
// and an injected clock, so every transition is exercised deterministically
// without Prisma. They cover the bug this feature fixes: a Section timing out
// used to have nowhere to advance to, so the whole attempt was submitted.

import { beforeEach, describe, expect, it } from 'vitest';

import type { AttemptService } from './attempt.service.types';
import type { AttemptStateDto } from '../types/domain.types';
import {
  advanceTo,
  attemptRows,
  buildService,
  sectionAttemptRows,
  sectionStatuses,
  setSectionalTest,
} from './attempt.service.sectional.harness';

const LEARNER_TOKEN = 'learner-token';

describe('Sequential Sectional Timing', () => {
  let service: AttemptService;

  beforeEach(() => {
    setSectionalTest({});
    service = buildService();
  });

  describe('starting a Sectional whole-Test attempt', () => {
    it('starts only the first Section and queues the rest', async () => {
      const state = await service.startTest(LEARNER_TOKEN, 'test-1');

      expect(sectionStatuses()).toEqual({
        'section-a': 'in_progress',
        'section-b': 'not_started',
        'section-c': 'not_started',
      });
      expect(state.currentSectionId).toBe('section-a');
      expect(state.status).toBe('in_progress');
    });

    it('reports the active Section clock as the attempt remaining time', async () => {
      const state = await service.startTest(LEARNER_TOKEN, 'test-1');

      // Section A is limited to 60s; the queued Sections report their full,
      // untouched limits rather than counting down alongside it.
      expect(state.remainingSeconds).toBe(60);
      expect(state.sections.map((s) => s.remainingSeconds)).toEqual([
        60, 120, 180,
      ]);
    });

    it('surfaces each Section title and order for the Section rail', async () => {
      const state = await service.startTest(LEARNER_TOKEN, 'test-1');

      expect(state.sections).toEqual([
        expect.objectContaining({ sectionId: 'section-a', title: 'Section A', orderIndex: 0 }),
        expect.objectContaining({ sectionId: 'section-b', title: 'Section B', orderIndex: 1 }),
        expect.objectContaining({ sectionId: 'section-c', title: 'Section C', orderIndex: 2 }),
      ]);
    });

    it('creates Section Attempts in orderIndex order regardless of stored order', async () => {
      // The first Section is decided by `orderIndex`, not by the order the
      // repository happens to hand the Sections back in.
      setSectionalTest({ reverseSectionStorageOrder: true });
      service = buildService();

      const state = await service.startTest(LEARNER_TOKEN, 'test-1');

      expect(state.currentSectionId).toBe('section-a');
      expect(sectionStatuses()['section-a']).toBe('in_progress');
    });
  });

  describe('a Section reaching its Time Limit', () => {
    it('closes the expired Section and activates the next one', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      advanceTo(60);
      const state = await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');

      expect(sectionStatuses()).toEqual({
        'section-a': 'completed',
        'section-b': 'in_progress',
        'section-c': 'not_started',
      });
      expect(state.currentSectionId).toBe('section-b');
      expect(state.status).toBe('in_progress');
    });

    it('does not finalize the attempt while Sections remain', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      advanceTo(60);
      const state = await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');

      expect(state.status).not.toBe('completed');
      expect(state.scoreMarks).toBeUndefined();
      expect(attemptRows()[0].completedAt).toBeNull();
    });

    it('gives the newly activated Section its full Time Limit', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      // The Learner leaves long after Section A expired. Because timing is
      // reconciled lazily, Section B must start now rather than retroactively
      // at Section A's expiry — otherwise it would already be burnt down.
      advanceTo(1000);
      const state = await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');

      expect(state.currentSectionId).toBe('section-b');
      expect(state.remainingSeconds).toBe(120);
    });

    it('advances one Section per reconcile rather than cascading', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      advanceTo(1000);
      await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');

      expect(sectionStatuses()['section-c']).toBe('not_started');
    });

    it('finalizes and scores the attempt after the last Section expires', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      advanceTo(60); // Section A closes, Section B opens.
      await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');
      advanceTo(180); // Section B closes, Section C opens.
      await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');
      advanceTo(360); // Section C closes — nothing is left to activate.
      const state = await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');

      expect(state.status).toBe('completed');
      expect(state.currentSectionId).toBeNull();
      expect(sectionStatuses()).toEqual({
        'section-a': 'completed',
        'section-b': 'completed',
        'section-c': 'completed',
      });
    });
  });

  describe('submitting a Section early', () => {
    it('closes the active Section and activates the next', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      advanceTo(10);
      const state = await service.advanceSection(LEARNER_TOKEN, 'attempt-1');

      expect(state.currentSectionId).toBe('section-b');
      expect(sectionStatuses()['section-a']).toBe('completed');
    });

    it('forfeits the unused time rather than carrying it forward', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      advanceTo(10);
      const state = await service.advanceSection(LEARNER_TOKEN, 'attempt-1');

      // 50s of Section A went unused; Section B still gets exactly its own 120s.
      expect(state.remainingSeconds).toBe(120);
      expect(sectionAttemptRows()[0].accumulatedActiveSeconds).toBe(10);
    });

    it('never reopens a Section that was closed early', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');
      advanceTo(10);
      await service.advanceSection(LEARNER_TOKEN, 'attempt-1');

      advanceTo(20);
      const state = await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');

      expect(state.currentSectionId).toBe('section-b');
      expect(sectionStatuses()['section-a']).toBe('completed');
    });

    it('finalizes and scores the attempt when the last Section is submitted', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');
      advanceTo(5);
      await service.advanceSection(LEARNER_TOKEN, 'attempt-1');
      advanceTo(10);
      await service.advanceSection(LEARNER_TOKEN, 'attempt-1');

      // Answer one Question correctly in Section C before ending the attempt.
      await service.submitResponse(LEARNER_TOKEN, 'attempt-1', {
        questionId: 'question-c1',
        selectedOptionIds: ['option-c1-correct'],
      });
      advanceTo(15);
      const state = await service.advanceSection(LEARNER_TOKEN, 'attempt-1');

      expect(state.status).toBe('completed');
      expect(state.scoreMarks).toBe(1);
    });

    it('does not also consume the Section that reconciliation just opened', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      // Section A lapsed while the tab was backgrounded, so the request that
      // arrives reconciles A closed and opens B. Submitting must not then close
      // B as well — one click must never cost the Learner two Sections.
      advanceTo(100);
      const state = await service.advanceSection(LEARNER_TOKEN, 'attempt-1');

      expect(state.currentSectionId).toBe('section-b');
      expect(state.remainingSeconds).toBe(120);
      expect(sectionStatuses()).toEqual({
        'section-a': 'completed',
        'section-b': 'in_progress',
        'section-c': 'not_started',
      });
    });

    it('rejects advancing an Overall Timing attempt', async () => {
      await expect(
        service
          .startTest(LEARNER_TOKEN, 'test-overall')
          .then(() => service.advanceSection(LEARNER_TOKEN, 'attempt-1')),
      ).rejects.toThrow(/timed overall/i);
    });

    it('rejects advancing a paused attempt', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');
      advanceTo(10);
      await service.pause(LEARNER_TOKEN, 'attempt-1');

      await expect(
        service.advanceSection(LEARNER_TOKEN, 'attempt-1'),
      ).rejects.toThrow(/in-progress/i);
    });

    it('reports the terminal state when the attempt completed as the request arrived', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');
      advanceTo(5);
      await service.advanceSection(LEARNER_TOKEN, 'attempt-1');
      advanceTo(10);
      await service.advanceSection(LEARNER_TOKEN, 'attempt-1');

      // Section C's limit lapses before the "Submit Section" request lands.
      advanceTo(1000);
      const state = await service.advanceSection(LEARNER_TOKEN, 'attempt-1');

      expect(state.status).toBe('completed');
    });
  });

  describe('answering Questions', () => {
    it('accepts a Response for the active Section', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      await expect(
        service.submitResponse(LEARNER_TOKEN, 'attempt-1', {
          questionId: 'question-a1',
          selectedOptionIds: ['option-a1-correct'],
        }),
      ).resolves.toMatchObject({ currentSectionId: 'section-a' });
    });

    it('rejects a Response for a Section that has not started', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      await expect(
        service.submitResponse(LEARNER_TOKEN, 'attempt-1', {
          questionId: 'question-b1',
          selectedOptionIds: ['option-b1-correct'],
        }),
      ).rejects.toThrow(/not currently in progress/i);
    });

    it('rejects a Response for a Section that has closed', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');
      advanceTo(60);
      await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');

      await expect(
        service.submitResponse(LEARNER_TOKEN, 'attempt-1', {
          questionId: 'question-a1',
          selectedOptionIds: ['option-a1-correct'],
        }),
      ).rejects.toThrow(/not currently in progress/i);
    });

    it('scores unreached Sections as unanswered rather than penalising them', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');
      await service.submitResponse(LEARNER_TOKEN, 'attempt-1', {
        questionId: 'question-a1',
        selectedOptionIds: ['option-a1-correct'],
      });

      advanceTo(10);
      const result = await service.submitAttempt(LEARNER_TOKEN, 'attempt-1');

      // One correct answer in Section A (+1); Sections B and C were never
      // reached, so their Questions score 0 instead of the negative mark.
      expect(result.scoreMarks).toBe(1);
    });
  });

  describe('pause and resume', () => {
    it('pauses only the active Section, leaving queued Sections untouched', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      advanceTo(10);
      await service.pause(LEARNER_TOKEN, 'attempt-1');

      expect(sectionStatuses()).toEqual({
        'section-a': 'paused',
        'section-b': 'not_started',
        'section-c': 'not_started',
      });
    });

    it('does not burn the active Section clock while paused', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');
      advanceTo(10);
      await service.pause(LEARNER_TOKEN, 'attempt-1');

      advanceTo(500);
      const state = await service.resume(LEARNER_TOKEN, 'attempt-1');

      expect(state.currentSectionId).toBe('section-a');
      expect(state.remainingSeconds).toBe(50);
    });

    it('advances to the next Section when resuming an exhausted Section', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');
      // Burn Section A down to nothing, then pause on the exhausted Section.
      advanceTo(60);
      await service.pause(LEARNER_TOKEN, 'attempt-1');

      advanceTo(70);
      const state = await service.resume(LEARNER_TOKEN, 'attempt-1');

      expect(state.status).toBe('in_progress');
      expect(state.currentSectionId).toBe('section-b');
      expect(sectionStatuses()['section-a']).toBe('completed');
    });
  });

  describe('Overall Timing is unaffected', () => {
    let overall: AttemptStateDto;

    beforeEach(async () => {
      overall = await service.startTest(LEARNER_TOKEN, 'test-overall');
    });

    it('creates no Section Attempts and names no current Section', () => {
      expect(sectionAttemptRows()).toHaveLength(0);
      expect(overall.currentSectionId).toBeNull();
    });

    it('lets any Section be answered while the single clock runs', async () => {
      await expect(
        service.submitResponse(LEARNER_TOKEN, 'attempt-1', {
          questionId: 'question-ob1',
          selectedOptionIds: ['option-ob1-correct'],
        }),
      ).resolves.toMatchObject({ status: 'in_progress' });
    });

    it('finalizes the whole attempt when the single clock expires', async () => {
      advanceTo(300);
      const state = await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');

      expect(state.status).toBe('completed');
    });
  });

  describe('a Section-scoped attempt (a purchased single Section)', () => {
    it('starts its one Section immediately', async () => {
      const state = await service.startSection(LEARNER_TOKEN, 'section-b');

      expect(state.currentSectionId).toBe('section-b');
      expect(sectionStatuses()).toEqual({ 'section-b': 'in_progress' });
    });

    it('finalizes the attempt when that Section expires', async () => {
      await service.startSection(LEARNER_TOKEN, 'section-b');

      advanceTo(120);
      const state = await service.getAttemptState(LEARNER_TOKEN, 'attempt-1');

      expect(state.status).toBe('completed');
      expect(state.currentSectionId).toBeNull();
    });
  });

  describe('review access', () => {
    it('refuses to reveal the Correct Option Set while the attempt is open', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');

      await expect(
        service.getAttemptReview(LEARNER_TOKEN, 'attempt-1'),
      ).rejects.toThrow(/completed/i);
    });

    it('serves the review once the attempt is completed', async () => {
      await service.startTest(LEARNER_TOKEN, 'test-1');
      advanceTo(10);
      await service.submitAttempt(LEARNER_TOKEN, 'attempt-1');

      const review = await service.getAttemptReview(LEARNER_TOKEN, 'attempt-1');

      expect(review.questions[0].correctOptionIds).toEqual([
        'option-a1-correct',
      ]);
    });
  });
});
