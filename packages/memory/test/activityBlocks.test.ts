/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { ActivityBlock } from '../src/core/progress';
import { blockSummary, notNeededBlock, renderBlockLegend, renderBlockSquare } from '../src/ui/activityBlocks';

const base: ActivityBlock = {
  rung: 'blanks', state: 'notStarted', tiers: 3, tiersPassed: 0, level: 0, bestScore: null,
  coveredBy: null, startable: true, naReason: null,
};

describe('blockSummary', () => {
  it('names the activity and its state in words', () => {
    expect(blockSummary(base)).toBe('Fill in the blanks: not started');
    expect(blockSummary({ ...base, state: 'practicing', tiersPassed: 1 })).toBe('Fill in the blanks: 1 of 3 stages passed');
    expect(blockSummary({ ...base, state: 'complete' })).toBe('Fill in the blanks: complete');
    expect(blockSummary({ ...base, state: 'complete', coveredBy: 'firstletters' })).toBe('Fill in the blanks: complete (covered by First letters)');
    expect(blockSummary({ ...base, state: 'notApplicable', naReason: 'tooShort' })).toContain('not needed (fewer than 3 verses)');
    expect(blockSummary({ ...base, rung: 'recite', state: 'notApplicable', naReason: 'speech' })).toContain('speech is not ready');
  });
});

describe('renderBlockSquare', () => {
  const glyph = (n: Element) => n.querySelector('.sm-block-glyph')!.textContent;

  it('draws each state with a non-colour cue', () => {
    expect(glyph(renderBlockSquare(base))).toBe('');
    expect(glyph(renderBlockSquare({ ...base, state: 'practicing', tiersPassed: 1 }))).toBe('1/3');
    expect(glyph(renderBlockSquare({ ...base, state: 'complete' }))).toBe('✓');
    expect(glyph(renderBlockSquare(notNeededBlock('ordering')))).toBe('–');
  });

  it('a startable square is a button named by the summary; complete is still a button', () => {
    for (const b of [base, { ...base, state: 'complete' as const }]) {
      const sq = renderBlockSquare(b, { tabStop: true });
      expect(sq.tagName).toBe('BUTTON');
      expect(sq.getAttribute('tabindex')).toBe('0');
      expect(sq.querySelector('.sm-sr-only')!.textContent).toBe(blockSummary(b));
      expect(sq.querySelector('.sm-block-glyph')!.getAttribute('aria-hidden')).toBe('true');
      expect(sq.dataset.state).toBe(b.state);
    }
    expect(renderBlockSquare(base).getAttribute('tabindex')).toBe('-1');
  });

  it('a not-needed square is not a button', () => {
    const sq = renderBlockSquare(notNeededBlock('ordering'));
    expect(sq.tagName).toBe('SPAN');
    expect(sq.getAttribute('role')).toBe('img');
    expect(sq.getAttribute('aria-label')).toBe('Put in order: not needed (fewer than 3 verses)');
  });
});

describe('renderBlockLegend', () => {
  it('shows four sample squares with labels', () => {
    const legend = renderBlockLegend();
    const items = Array.from(legend.querySelectorAll('li'));
    expect(items.map((li) => li.textContent?.replace(/[–✓]|1\/3/g, '').trim())).toEqual(['Not started', 'Not needed', 'In progress', 'Finished']);
    expect(Array.from(legend.querySelectorAll('.sm-act-sq')).map((n) => n.getAttribute('data-state'))).toEqual(['notStarted', 'notApplicable', 'practicing', 'complete']);
  });
});
