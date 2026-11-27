/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { ActivityBlock } from '../src/core/progress';
import { blockSummary, renderActivityBlocks } from '../src/ui/activityBlocks';

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
    expect(blockSummary({ ...base, state: 'notApplicable', naReason: 'singleVerse' })).toContain('not applicable (single verse)');
    expect(blockSummary({ ...base, rung: 'recite', state: 'notApplicable', naReason: 'speech' })).toContain('speech is not ready');
  });
});

describe('renderActivityBlocks', () => {
  const pv = { passage: { reference: 'John 3:16' } } as never;
  const host = {} as never;
  const render = (blocks: ActivityBlock[]) => renderActivityBlocks(host, pv, blocks, { delegated: true });

  it('gives each block a visible tag, drops title, and keeps one sr-only name', () => {
    const t = render([base, { ...base, rung: 'recite', state: 'practicing' }]);
    const btns = Array.from(t.querySelectorAll('button'));
    expect(btns[0]!.querySelector('.sm-block-tag')!.textContent).toBe('Bl');
    expect(btns[1]!.querySelector('.sm-block-tag')!.textContent).toBe('Re');
    for (const b of btns) {
      expect(b.hasAttribute('title')).toBe(false);
      expect(b.querySelectorAll('.sm-sr-only')).toHaveLength(1);
      expect(b.querySelector('.sm-block-tag')!.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('draws only a completed block with a check; not-applicable has a dash', () => {
    const t = render([base, { ...base, state: 'practicing' }, { ...base, state: 'complete' }, { ...base, state: 'notApplicable', naReason: 'singleVerse' }]);
    const glyphs = Array.from(t.querySelectorAll('.sm-block-glyph')).map((n) => n.textContent);
    expect(glyphs).toEqual(['', '', '✓', '–']);
    expect(Array.from(t.querySelectorAll('button')).map((b) => b.getAttribute('data-state'))).toEqual(['notStarted', 'practicing', 'complete', 'notApplicable']);
  });
});
