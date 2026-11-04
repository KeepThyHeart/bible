/**
 * B-189: `--theme-accent` is not a token (the accent is `--theme-accent-primary`), so every `var(--theme-accent, #3b82f6)`
 * silently rendered its blue fallback on every theme, including High Contrast. Also holds the shared quiz radio to the
 * accent colour, so a selected radio is filled in the theme accent rather than the browser's grey.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

describe('theme token use', () => {
  it('never references the undefined --theme-accent token', () => {
    const bad = walk(SRC).filter((f) => /var\(--theme-accent\s*[,)]/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('quiz radio is filled with the accent', () => {
    const css = readFileSync(resolve(__dirname, '../../../../../packages/ui/css/kth-quiz.css'), 'utf8');
    expect(css).toMatch(/\.kth-quiz__choice-input[^{]*\{[^}]*accent-color:\s*var\(--kth-accent\)/);
  });
});
