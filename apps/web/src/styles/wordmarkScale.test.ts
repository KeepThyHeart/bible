import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The wordmark is branding: on a phone it must not grow with the reading-text step (B-184),
// or at the maximum Aa step on a 360px screen the title is cut mid-letter.
describe('mobile header wordmark scale', () => {
  it('pins --ui-font-scale to 1 on the mobile header logo', () => {
    const css = readFileSync(resolve(__dirname, '_responsive.scss'), 'utf8');
    expect(css).toMatch(/&__logo\s*\{[^}]*--ui-font-scale:\s*1;/);
  });
});
