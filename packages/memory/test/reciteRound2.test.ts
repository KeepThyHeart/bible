/**
 * @vitest-environment jsdom
 *
 * Round 2 (task 0151): score-following messages, heard -> expected in the diff, peek ("not graded"),
 * and the spoken reference.
 */
// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kitFor } from '@bible/core/recite';
import type { ReciteStateView, VerseText } from '../src/core/types';
import { gradeRecitation } from '../src/core/recite/grade';
import { spokenReferenceWords } from '../src/core/recite/spokenReference';
import { renderRecite, scoreMessage } from '../src/ui/reciteView';

const kit = kitFor('en')!;
const verse: VerseText = {
  verseId: 1, label: '1:1', words: 'In the beginning God created the heaven and the earth'.split(' '),
  lines: null, psalmTitle: null, paragraphStart: true,
};
const say = (t: string) => t.split(' ').map((w) => ({ text: w }));
const FULL = 'in the beginning god created the heaven and the earth';

function state(over: Partial<ReciteStateView> = {}): ReciteStateView {
  return {
    reciteId: 'r1', mode: 'tap', source: 'passage', phase: 'ready', passageId: 1,
    reference: 'Genesis 1:1', verses: null, heard: [], position: -1, hinted: [], peeked: 0, peekText: null,
    referenceText: null, result: null, done: 0, remaining: 0, message: '', error: null, ...over,
  };
}
const text = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ');

describe('score message follows the score', () => {
  const r = (score: number, wl = true) => ({ score, passageWellLearned: wl });
  it('never says "Well learned" for a low score', () => {
    expect(scoreMessage(r(0.42))).not.toMatch(/well learned/i);
    expect(scoreMessage(r(0.6))).not.toMatch(/well learned/i);
    expect(scoreMessage(r(0.42))).toMatch(/keep practicing/i);
  });
  it('says it for a high score on a well-learned passage', () => {
    expect(scoreMessage(r(0.95))).toMatch(/well learned/i);
    expect(scoreMessage(r(0.95, false))).toMatch(/excellent/i);
    expect(scoreMessage(r(1))).toBe('Perfect.');
  });
  it('is on screen after scoring', () => {
    const root = renderRecite(state({ phase: 'feedback', verses: [verse], result: { score: 0.42, level: 4, nextDueAt: null, missedQuote: [], passageWellLearned: true, words: [], extras: [] } }), { onControl: vi.fn(), onExit: vi.fn() });
    expect(text(root)).not.toMatch(/well learned/i);
  });
});

describe('diff shows the correct word', () => {
  it('heard -> expected for close words, the missed word, and a visible extra', () => {
    const words = verse.words.map((_, index) => ({ index, verdict: 'correct' }));
    words[6] = { index: 6, verdict: 'near', heard: 'heavens' };
    words[7] = { index: 7, verdict: 'missed' };
    const root = renderRecite(state({ phase: 'feedback', verses: [verse], result: { score: 0.8, level: 1, nextDueAt: null, missedQuote: ['and'], passageWellLearned: false, words, extras: [{ afterIndex: 2, heard: 'without' }] } }), { onControl: vi.fn(), onExit: vi.fn() });
    const t = text(root);
    expect(t).toContain('heavens → heaven (close)');
    expect(t).toContain('and (missed)');
    expect(t).toContain('+without (extra)');
  });
});

describe('peek', () => {
  it('offers peek buttons before reciting and sends the actions', () => {
    const onControl = vi.fn();
    const root = renderRecite(state(), { onControl, onExit: vi.fn() });
    root.querySelector('[data-testid=recite-peek]').click();
    root.querySelector('[data-testid=recite-peek-all]').click();
    expect(onControl.mock.calls.map((c) => c[0])).toEqual(['peek', 'peekAll']);
  });
  it('shows the peeked words marked not graded', () => {
    const root = renderRecite(state({ peeked: 3, peekText: 'In the beginning' }), { onControl: vi.fn(), onExit: vi.fn() });
    expect(text(root.querySelector('[data-testid=recite-peek-text]'))).toContain('In the beginning (not graded)');
  });
  it('marks peeked words in the result and leaves them out of the score', () => {
    const g = gradeRecitation([verse], say('xx xx xx god created the heaven and the earth'), new Set(), 'normal', kit, { peeked: 3 });
    expect(g.result.words.slice(0, 3).every((w) => w.peeked)).toBe(true);
    expect(g.result.score).toBe(1);
    expect(g.attempt.totalSteps).toBe(7);
    expect(g.practiceOnly).toBe(false);
    const root = renderRecite(state({ phase: 'feedback', verses: [verse], result: { score: 1, level: 1, nextDueAt: null, missedQuote: [], passageWellLearned: false, words: g.result.words, extras: [] } }), { onControl: vi.fn(), onExit: vi.fn() });
    expect(text(root)).toContain('In (not graded)');
  });
  it('peeking at everything is practice only', () => {
    const g = gradeRecitation([verse], say(FULL), new Set(), 'normal', kit, { peeked: 99 });
    expect(g.practiceOnly).toBe(true);
  });
});

describe('spoken reference', () => {
  it('turns a reference into the words said', () => {
    expect(spokenReferenceWords({ reference: 'John 3:16' }, ['John'])).toEqual(['John', 'three', 'sixteen']);
    expect(spokenReferenceWords({ reference: '1 John 3:16-18' }, ['1 John'])).toEqual(['First', 'John', 'three', 'sixteen', 'to', 'eighteen']);
  });
  it('is graded leniently and apart from the verse', () => {
    const ref = ['Genesis', 'one', 'one'];
    const g = gradeRecitation([verse], say(`genesis chapter one verse one ${FULL}`), new Set(), 'strict', kit, { refBefore: ref });
    expect(g.result.score).toBe(1);
    expect(g.result.extras).toHaveLength(0);
    expect(g.referenceScore).toBe(1);
    const skipped = gradeRecitation([verse], say(FULL), new Set(), 'normal', kit, { refBefore: ref, refAfter: ref });
    expect(skipped.result.score).toBe(1);
    expect(skipped.referenceScore).toBe(0);
  });
  it('reference after the verse', () => {
    const ref = ['Genesis', 'one', 'one'];
    const g = gradeRecitation([verse], say(`${FULL} genesis 1 1`), new Set(), 'normal', kit, { refAfter: ref });
    expect(g.result.score).toBe(1);
    expect(g.referenceScore).toBeGreaterThan(0.9);
  });
});
