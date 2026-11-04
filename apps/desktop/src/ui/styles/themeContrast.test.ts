/**
 * WCAG contrast guard for every theme (B-044).
 *
 * Parses `themes.css` and checks the text/control/accent pairs the UI really
 * uses: 4.5:1 for text, 3:1 for focus ring and range thumb, and text over each
 * highlight swatch at the theme's highlight alpha. The `high-contrast` theme
 * is held to 7:1 on its text pairs. The web palette is checked too (muted,
 * secondary and accent text on the page backgrounds).
 *
 * Known gaps, left for a product decision: input/control borders are not held
 * to 3:1 in the original themes (only high-contrast meets it).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { THEME_IDS } from './themeTokens';

type RGB = [number, number, number];
const REPO_ROOT = resolve(__dirname, '../../../../..');
const css = readFileSync(resolve(__dirname, 'themes.css'), 'utf8');

const lum = ([r, g, b]: RGB) => {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (fg: RGB, bg: RGB, a: number): RGB => fg.map((v, i) => v * a + bg[i] * (1 - a)) as RGB;
const parseHex = (h: string): RGB => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
};

function parseThemes(): Record<string, Record<string, RGB> & { _alpha?: number }> {
  const out: Record<string, Record<string, RGB> & { _alpha?: number }> = {};
  const re = /\[data-theme="([a-z0-9-]+)"\]\s*\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const body = m[2];
    if (!/--theme-bg-primary-rgb/.test(body)) continue;
    const t: Record<string, RGB> & { _alpha?: number } = {};
    let v: RegExpExecArray | null;
    const r1 = /--theme-([a-z0-9-]+)-rgb:\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*;/g;
    while ((v = r1.exec(body))) t[v[1]] = [+v[2], +v[3], +v[4]];
    const r2 = /--theme-([a-z0-9-]+):\s*(?:rgb\(\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*\)|(#[0-9a-fA-F]{3,6}))\s*;/g;
    while ((v = r2.exec(body))) if (!t[v[1]]) t[v[1]] = v[5] ? parseHex(v[5]) : [+v[2], +v[3], +v[4]];
    const a = /--theme-highlight-alpha:\s*([0-9.]+)/.exec(body);
    t._alpha = a ? +a[1] : 0.4;
    out[m[1]] = t;
  }
  return out;
}

const HL: Record<string, RGB> = {
  yellow: [255, 255, 0],
  green: [144, 238, 144],
  blue: [173, 216, 230],
  red: [255, 182, 193],
  purple: [216, 191, 216],
  orange: [255, 200, 124]
};

const RULES: Array<[string, string[], number]> = [
  ['text-primary', ['bg-primary', 'bg-secondary', 'bg-tertiary', 'surface-elevated'], 4.5],
  ['text-secondary', ['bg-primary', 'bg-secondary', 'bg-tertiary', 'surface-elevated'], 4.5],
  ['text-heading', ['bg-primary', 'bg-secondary'], 4.5],
  ['text-muted', ['bg-primary', 'bg-secondary', 'surface-elevated'], 4.5],
  ['input-placeholder', ['input-bg'], 4.5],
  ['input-text', ['input-bg'], 4.5],
  ['control-text', ['control-bg', 'control-hover'], 4.5],
  ['accent-primary', ['bg-primary', 'bg-secondary', 'surface-elevated'], 4.5],
  ['accent-strong', ['bg-primary', '@accent-light', '@accent-soft'], 4.5],
  ['accent-text', ['accent-primary', 'accent-hover', 'danger'], 4.5],
  ['christ', ['bg-primary'], 4.5],
  ['pane-header-text', ['pane-header-bg'], 4.5],
  ['pane-header-text-secondary', ['pane-header-bg'], 4.5],
  ['tab-text', ['pane-header-bg'], 4.5],
  ['tab-active-text', ['tab-active-bg'], 4.5],
  ['link-color', ['bg-primary', 'surface-primary'], 4.5],
  ['strongs-color', ['bg-primary'], 4.5],
  ['footnote-color', ['bg-primary'], 4.5],
  ['crossref-color', ['bg-primary'], 4.5],
  ['danger-text', ['danger-soft'], 4.5],
  ['success-text', ['success-soft'], 4.5],
  ['warning-text', ['warning-soft'], 4.5],
  ['info-text', ['info-soft'], 4.5],
  ['border-focus', ['bg-primary', 'bg-secondary'], 3],
  ['range-thumb', ['bg-primary'], 3],
  ['text-primary', Object.keys(HL).map((k) => '@hl-' + k), 4.5],
  // What the user sees on a highlighted word (B-103): the verse text colour, or a fixed override in highlights.css.
  ['@word-on-highlight', Object.keys(HL).map((k) => '@hl-' + k), 4.5],
  // Notes "Saved" status label sits on the pane background (it used the raw success colour, below AA).
  ['success-text', ['bg-primary', 'bg-secondary', 'surface-elevated'], 4.5]
];

const highlightsCss = readFileSync(resolve(__dirname, 'highlights.css'), 'utf8');

/** Text colour of a highlighted word: a per-theme override from highlights.css, else the theme's text-primary. */
function wordOnHighlight(id: string, t: Record<string, RGB>): RGB {
  const re = /((?:\[data-theme="[a-z0-9-]+"\]\s*\.word\[class\*="highlight-"\]\s*,?\s*)+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(highlightsCss))) {
    if (!m[1].includes(`[data-theme="${id}"]`)) continue;
    const c = /(?:^|[;\s])color:\s*(#[0-9a-fA-F]{3,6})/.exec(m[2]);
    if (c) return parseHex(c[1]);
  }
  return t['text-primary'];
}

function resolveBg(t: Record<string, RGB> & { _alpha?: number }, k: string): RGB | undefined {
  if (k === '@accent-light') return mix(t['accent-primary'], t['bg-primary'], 0.12);
  if (k === '@accent-soft') return mix(t['accent-primary'], t['bg-primary'], 0.22);
  if (k.startsWith('@hl-')) return mix(HL[k.slice(4)], t['bg-primary'], t._alpha ?? 0.4);
  return t[k];
}

const themes = parseThemes();

describe('theme contrast (WCAG AA)', () => {
  it('themes.css has a block for every registered theme', () => {
    for (const id of THEME_IDS) expect(Object.keys(themes), id).toContain(id);
  });

  it.each([...THEME_IDS])('%s: every text/control pair meets its minimum', (id) => {
    const t = themes[id];
    expect(t, `no block for ${id}`).toBeTruthy();
    const fails: string[] = [];
    for (const [fg, bgs, min] of RULES) {
      for (const b of bgs) {
        const F = fg === '@word-on-highlight' ? wordOnHighlight(id, t) : t[fg];
        const B = resolveBg(t, b);
        if (!F || !B) continue;
        const r = ratio(F, B);
        if (r < min) fails.push(`${fg} on ${b}: ${r.toFixed(2)} < ${min}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('high-contrast is registered and holds 7:1 on its text pairs', () => {
    expect(THEME_IDS).toContain('high-contrast');
    const t = themes['high-contrast'];
    expect(t).toBeTruthy();
    const pairs: Array<[string, string]> = [
      ['text-primary', 'surface-elevated'],
      ['text-secondary', 'surface-elevated'],
      ['text-muted', 'surface-elevated'],
      ['text-muted', 'bg-tertiary'],
      ['accent-primary', 'surface-elevated'],
      ['accent-text', 'accent-primary'],
      ['christ', 'bg-primary'],
      ['link-color', 'surface-elevated'],
      ['tab-text', 'pane-header-bg'],
      ['control-text', 'control-hover'],
      ['danger-text', 'danger-soft'],
      ['footnote-color', 'bg-primary']
    ];
    const fails = pairs.filter(([f, b]) => ratio(t[f], t[b]) < 7).map(([f, b]) => `${f}/${b}`);
    expect(fails).toEqual([]);
    expect(ratio(t['input-border'], t['input-bg'])).toBeGreaterThanOrEqual(3);
  });

  it('web palette: muted/secondary/accent text pass 4.5:1 on page backgrounds', () => {
    const pal = JSON.parse(readFileSync(resolve(REPO_ROOT, 'admin/brand/theme-palettes.json'), 'utf8')).themes;
    const w = (v: unknown) => (typeof v === 'object' && v ? (v as { web: string }).web : (v as string));
    const fails: string[] = [];
    for (const [id, th] of Object.entries<any>(pal)) {
      const g = (k: string) => {
        const v = w(th.colors[k]);
        return v && v.startsWith('#') ? parseHex(v) : null;
      };
      for (const fg of ['text-secondary', 'text-muted', 'accent-color']) {
        for (const bg of ['bg-primary', 'bg-secondary']) {
          const F = g(fg);
          const B = g(bg);
          if (F && B && ratio(F, B) < 4.5) fails.push(`${id}: ${fg} on ${bg} ${ratio(F, B).toFixed(2)}`);
        }
      }
    }
    expect(fails).toEqual([]);
  });
});
