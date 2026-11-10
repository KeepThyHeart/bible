import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Layout itself is verified in a browser; these pin the rules that make the header fit.
describe('header fit', () => {
  // W-060: at 800-900px (a phone held landscape, desktop layout) the search form could not
  // shrink below its field's intrinsic width and pushed Settings 28px past the edge.
  it('lets the desktop header search shrink (min-width: 0)', () => {
    const css = readFileSync(resolve(__dirname, '_header.scss'), 'utf8');
    expect(css).toMatch(/&__search\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0;/);
  });

  // W-061: on a 320px phone the wordmark broke over five lines.
  it('shrinks the phone wordmark below 340px', () => {
    const css = readFileSync(resolve(__dirname, '_responsive.scss'), 'utf8');
    expect(css).toMatch(/@media \(max-width: 340px\)\s*\{\s*&__logo\s*\{\s*--ui-font-scale:\s*1;/);
  });

  // U-137: the phone wordmark wrapped to a three-line block; each line is now nowrap + ellipsis.
  it('keeps the phone wordmark name and tagline on one line each', () => {
    const css = readFileSync(resolve(__dirname, '_responsive.scss'), 'utf8');
    expect(css).toMatch(/&__wordmark-name,\s*&__wordmark-tagline\s*\{\s*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/);
  });
});
