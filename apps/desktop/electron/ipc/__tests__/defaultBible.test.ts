/**
 * Tests for the default-Bible rule both processes share.
 *
 * Modules install separately, so KJV may be absent. The rule has to prefer
 * the reader's own translation, then KJV, then whatever is installed - and
 * must never hand back a Bible that is not in the list.
 */
import { describe, it, expect } from 'vitest';
import { pickDefaultBible, PREFERRED_DEFAULT_BIBLE } from '../defaultBible';

const KJV = { abbreviation: 'KJV' };
const ASV = { abbreviation: 'ASV' };
const WEB = { abbreviation: 'WEB' };

describe('pickDefaultBible', () => {
  it('prefers KJV when it is installed', () => {
    expect(PREFERRED_DEFAULT_BIBLE).toBe('KJV');
    expect(pickDefaultBible([ASV, KJV, WEB])).toBe('KJV');
  });

  it('falls back to the first installed Bible when KJV is not installed', () => {
    expect(pickDefaultBible([ASV, WEB])).toBe('ASV');
  });

  it('uses the preferred translation when it is installed', () => {
    expect(pickDefaultBible([KJV, ASV, WEB], 'WEB')).toBe('WEB');
  });

  it('ignores a preferred translation that is not installed', () => {
    expect(pickDefaultBible([KJV, ASV], 'NIV')).toBe('KJV');
    expect(pickDefaultBible([ASV, WEB], 'KJV')).toBe('ASV');
  });

  it('matches without regard to case and answers with the installed spelling', () => {
    expect(pickDefaultBible([ASV, { abbreviation: 'Kjv' }])).toBe('Kjv');
    expect(pickDefaultBible([KJV, ASV], 'asv')).toBe('ASV');
  });

  it('answers undefined when no Bible is installed, whatever was preferred', () => {
    expect(pickDefaultBible([])).toBeUndefined();
    expect(pickDefaultBible([], 'KJV')).toBeUndefined();
  });

  it('treats null and empty preferences as no preference', () => {
    expect(pickDefaultBible([ASV, KJV], null)).toBe('KJV');
    expect(pickDefaultBible([ASV, KJV], '')).toBe('KJV');
  });
});
