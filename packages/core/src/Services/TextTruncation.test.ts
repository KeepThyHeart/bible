import { describe, it, expect } from 'vitest';
import { truncateAtWordBoundary, TRUNCATION_ELLIPSIS } from './TextTruncation';

/** The real G1722 (ἐν) gloss - 564 characters, the case that motivated this. */
const LONG_GLOSS =
  'about, after, against, + almost, X altogether, among, X as, at, before, ' +
  'between, (here-)by (+ all means), for (... sake of), + give self wholly to, ' +
  '(here-)in(-to, -wardly), X mightily, (because) of, (up-)on, (open-)ly, ' +
  'X outwardly, one, X quickly, X shortly, (speedi-)ly, X that, X there(-in, -on)';

describe('truncateAtWordBoundary', () => {
  it('leaves text that already fits untouched', () => {
    const result = truncateAtWordBoundary('(be-)love(-ed). Compare 5368', 120);
    expect(result).toEqual({ text: '(be-)love(-ed). Compare 5368', truncated: false });
  });

  it('reports truncation and appends a real ellipsis', () => {
    const result = truncateAtWordBoundary(LONG_GLOSS, 120);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith(TRUNCATION_ELLIPSIS)).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(121);
  });

  it('never splits a word', () => {
    const result = truncateAtWordBoundary('alpha beta gamma delta', 14);
    expect(result.text).toBe(`alpha beta${TRUNCATION_ELLIPSIS}`);
  });

  it('drops the list punctuation the cut would leave dangling', () => {
    const result = truncateAtWordBoundary('about, after, against, almost', 14);
    expect(result.text).toBe(`about, after${TRUNCATION_ELLIPSIS}`);
  });

  it('cuts mid-word when there is no boundary to cut at', () => {
    const result = truncateAtWordBoundary('supercalifragilistic', 8);
    expect(result.text).toBe(`supercal${TRUNCATION_ELLIPSIS}`);
  });

  it('treats a non-positive limit as "nothing fits"', () => {
    expect(truncateAtWordBoundary('anything', 0)).toEqual({ text: '', truncated: true });
    expect(truncateAtWordBoundary('', 0)).toEqual({ text: '', truncated: false });
  });

  it('trims surrounding whitespace before measuring', () => {
    expect(truncateAtWordBoundary('   short   ', 10)).toEqual({ text: 'short', truncated: false });
  });
});
