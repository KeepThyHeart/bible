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
  // B-198: --theme-warning-bg, --theme-accent-bg, --theme-accent-disabled and --theme-border were used but defined in
  // no theme, so the pale fallback showed (an unreadable "N days behind" chip in High Contrast). Every var(--theme-*)
  // in source must name a token themes.css defines.
  it('every var(--theme-*) used in source is defined in themes.css', () => {
    // --theme-bookmark-rgb is an opt-in override with a deliberate default (see BookmarkIcon).
    const defined = new Set<string>();
    const themes = readFileSync(resolve(SRC, 'styles/themes.css'), 'utf8');
    for (const m of themes.matchAll(/(--theme-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    const undef: string[] = [];
    for (const f of walk(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/var\((--theme-[a-z0-9-]+)/g)) {
        if (!defined.has(m[1]) && m[1] !== '--theme-bookmark-rgb') undef.push(`${f.slice(SRC.length + 1)}: ${m[1]}`);
      }
    }
    expect(undef).toEqual([]);
  });
  it('quiz radio is filled with the accent', () => {
    const css = readFileSync(resolve(__dirname, '../../../../../packages/ui/css/kth-quiz.css'), 'utf8');
    expect(css).toMatch(/\.kth-quiz__choice-input[^{]*\{[^}]*accent-color:\s*var\(--kth-accent\)/);
  });
});
