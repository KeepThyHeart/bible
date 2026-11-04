import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The tab badge pairs --theme-accent-text with a solid accent fill. --theme-accent-bg is the pale
// 12% tint (B-198 alias), so using it here left the count near-invisible in every theme.
describe('panel tab badge colours', () => {
  it('fills the badge with the solid accent, not the pale accent tint', () => {
    const src = readFileSync(resolve(__dirname, 'DockviewTabRenderer.tsx'), 'utf8');
    expect(src).not.toMatch(/background:\s*'var\(--theme-accent-bg/);
    expect(src).toMatch(/background:\s*'var\(--theme-accent-primary\)',\s*\n\s*color:\s*'var\(--theme-accent-text\)'/);
  });
});
