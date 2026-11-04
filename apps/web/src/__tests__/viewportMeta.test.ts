import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// B-139: Android Chrome 108+ resizes only the visual viewport for the soft keyboard unless the page
// opts in, which left the (max-height) keyboard fold in the search panel inert on real phones.
describe('index.html viewport meta', () => {
  it('opts into resizes-content so the keyboard shrinks the layout viewport', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const m = html.match(/<meta name="viewport" content="([^"]*)"/);
    expect(m?.[1]).toContain('interactive-widget=resizes-content');
  });
});
