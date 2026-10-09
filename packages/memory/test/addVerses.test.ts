/**
 * `versesFromMenuArgs` and `MemoryService.addVerses`: reading what the user
 * selected in the reader.
 *
 * The old verse context menu reached the worker with `args.verse`; the UI now
 * passes the selected verse ids explicitly. These pin how a selection becomes a
 * passage, and that anything else falls back rather than guessing.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { versesFromMenuArgs } from '../src/core/service';
import { disposeAll, startTestService, call } from './helpers/service';
import type { PlanView } from '../src/core/types';

afterEach(disposeAll);

describe('versesFromMenuArgs', () => {
  it('reads a single clicked verse and its translation', () => {
    expect(versesFromMenuArgs({ verseId: 43003016, verseIds: [43003016], module: 'KJV' })).toEqual({
      start: 43003016,
      end: 43003016,
      module: 'KJV',
    });
  });

  it('turns a contiguous selection within one chapter into a range', () => {
    expect(
      versesFromMenuArgs({ verseId: 19023002, verseIds: [19023003, 19023001, 19023002], module: 'ASV' }),
    ).toEqual({ start: 19023001, end: 19023003, module: 'ASV' });
  });

  it('falls back to the first verse for a gapped or cross-chapter selection', () => {
    expect(versesFromMenuArgs({ verseId: 19023001, verseIds: [19023001, 19023004] })).toEqual({
      start: 19023001,
      end: 19023001,
    });
    expect(versesFromMenuArgs({ verseId: 19022031, verseIds: [19022031, 19023001] })).toEqual({
      start: 19022031,
      end: 19022031,
    });
  });

  it('takes the lowest selected verse when no clicked verse is named', () => {
    expect(versesFromMenuArgs({ verseIds: [19023004, 19023001] })).toEqual({ start: 19023001, end: 19023001 });
  });

  it('falls back to the first verse for a selection longer than one passage may be', () => {
    const ids = Array.from({ length: 200 }, (_, i) => 19119001 + i);
    expect(versesFromMenuArgs({ verseIds: ids })).toEqual({ start: 19119001, end: 19119001 });
  });

  it('returns null when there is no verse', () => {
    expect(versesFromMenuArgs(undefined)).toBeNull();
    expect(versesFromMenuArgs(null)).toBeNull();
    expect(versesFromMenuArgs({ verseIds: [] })).toBeNull();
    expect(versesFromMenuArgs({})).toBeNull();
  });
});

describe('MemoryService.addVerses', () => {
  it('adds a contiguous run as one passage, then reports exists and revived', async () => {
    const { svc, notices } = await startTestService();

    const first = await svc.addVerses({ verseIds: [19023001, 19023002, 19023003], module: 'KJV' });
    expect(first.outcome).toBe('added');
    expect(notices()).toEqual(['Added to your memorization plan.']);

    const plan = await call<PlanView>(svc, { type: 'getPlan' });
    expect(plan.passages).toHaveLength(1);
    expect(plan.passages[0]!.passage).toMatchObject({
      id: first.passageId,
      startVerseId: 19023001,
      endVerseId: 19023003,
      verseCount: 3,
      moduleId: 'KJV',
    });

    const again = await svc.addVerses({ verseIds: [19023001, 19023002, 19023003] });
    expect(again).toEqual({ outcome: 'exists', passageId: first.passageId });
    expect(notices().pop()).toBe('That verse is already in your plan.');

    await svc.removePassage({ passageId: first.passageId });
    const revived = await svc.addVerses({ verseIds: [19023001, 19023002, 19023003] });
    expect(revived).toEqual({ outcome: 'revived', passageId: first.passageId });
    expect(notices().pop()).toBe('Restored to your memorization plan with its progress.');
  });

  it('adds only the first verse of a gapped selection', async () => {
    const { svc } = await startTestService();
    await svc.addVerses({ verseIds: [19023004, 19023001] });
    const plan = await call<PlanView>(svc, { type: 'getPlan' });
    expect(plan.passages[0]!.passage).toMatchObject({ startVerseId: 19023001, endVerseId: 19023001 });
  });

  it('records the passage against the named module, else the first installed one', async () => {
    const { svc } = await startTestService();
    const plan0 = await svc.addVerses({ verseIds: [43003016], module: 'NOPE' });
    const plan = await call<PlanView>(svc, { type: 'getPlan' });
    expect(plan.passages.find((p) => p.passage.id === plan0.passageId)?.passage.moduleId).toBe('KJV');
  });

  it('refuses an empty selection with a readable error', async () => {
    const { svc } = await startTestService();
    await expect(svc.addVerses({ verseIds: [] })).rejects.toThrow(/Select a verse/);
  });
});
