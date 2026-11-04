import { describe, expect, it } from 'vitest';
import { themeRedLetterPreview } from './themePassagePreview';

describe('themeRedLetterPreview (B-189)', () => {
  it('swaps the hard-coded copy red for the theme red-letter token', () => {
    const out = themeRedLetterPreview('a <span style="color: #B71C1C;">Verily</span> b');
    expect(out).not.toMatch(/#B71C1C;"/i);
    expect(out).toContain('var(--theme-christ');
  });
  it('leaves other markup alone', () => {
    expect(themeRedLetterPreview('<b>x</b>')).toBe('<b>x</b>');
  });
});
