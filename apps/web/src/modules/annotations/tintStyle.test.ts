import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HIGHLIGHT_COLOR_HEX, HIGHLIGHT_COLOR_NAMES } from '@bible/core/browser';
import { tintCss, installTintStyle, TINT_STYLE_ID } from './tintStyle';

describe('tint style', () => {
  it('has one rule per palette colour, straight from core', () => {
    const css = tintCss();
    for (const n of HIGHLIGHT_COLOR_NAMES) expect(css).toContain(`.verse.kth-annot-hl--${n}{--kth-annot-tint:${HIGHLIGHT_COLOR_HEX[n]}}`);
  });
  it('installs once and removes itself', () => {
    const off1 = installTintStyle();
    const off2 = installTintStyle();
    expect(document.querySelectorAll(`#${TINT_STYLE_ID}`)).toHaveLength(1);
    off1(); // already replaced: harmless
    off2();
    expect(document.getElementById(TINT_STYLE_ID)).toBeNull();
  });
  it('the stylesheet keeps no copy of the palette hex values', () => {
    const scss = readFileSync(join(process.cwd(), 'src/modules/annotations/annotations.scss'), 'utf8');
    for (const hex of Object.values(HIGHLIGHT_COLOR_HEX)) expect(scss.toLowerCase()).not.toContain(hex.toLowerCase());
  });
});
