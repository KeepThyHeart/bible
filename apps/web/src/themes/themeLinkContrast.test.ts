/**
 * W-041 / W-042: contrast guards for the commentary scripture links and the Theme swatch labels.
 * The colours come from each theme's own source (`_vars.scss`, `theme.json`), and the stylesheet
 * rules that apply them are asserted from the SCSS source, so reverting either the colour choice
 * or the CSS that applies it fails here.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const dir = __dirname;
const styles = resolve(dir, '..', 'styles');
const ids = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

describe('W-042: commentary scripture links', () => {
  const commentary = readFileSync(resolve(styles, '_commentary.scss'), 'utf8');
  const linkRule = /\.scripture-link,[\s\S]*?\{([^}]*)\}/.exec(commentary)?.[1] ?? '';

  it('the link rule uses the accent colour, not an inherited/muted one', () => {
    expect(linkRule).toMatch(/color:\s*var\(--accent-color\)/);
    expect(linkRule).not.toMatch(/color:\s*inherit/);
  });

  for (const id of ids) {
    it(`${id}: accent link colour >= 4.5:1 on the pane backgrounds, and on hover`, () => {
      const css = readFileSync(resolve(dir, id, '_vars.scss'), 'utf8');
      const get = (k: string) => new RegExp(`--${k}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]!;
      for (const bg of ['bg-primary', 'bg-secondary']) {
        expect(ratio(get('accent-color'), get(bg))).toBeGreaterThanOrEqual(4.5);
      }
      const hover = get('accent-hover');
      if (hover) expect(ratio(hover, get('bg-primary'))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('W-041: theme swatch labels', () => {
  const settings = readFileSync(resolve(styles, '_settings.scss'), 'utf8');

  it('label colour is inherited from the swatch (not the current theme) with enough specificity', () => {
    // `.settings-panel__field span` would otherwise win (0,1,1 vs 0,1,0).
    const rule = /&__theme-swatch &__theme-swatch-label\s*\{([^}]*)\}/.exec(settings)?.[1] ?? '';
    expect(rule).toMatch(/color:\s*inherit/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
  });

  for (const id of ids) {
    it(`${id}: swatch foreground vs swatch background >= 4.5:1`, () => {
      const t = JSON.parse(readFileSync(resolve(dir, id, 'theme.json'), 'utf8'));
      expect(ratio(t.swatch.fg, t.swatch.bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
