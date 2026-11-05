import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');

// 0209 r3 W9: CSS polish found by the driver. Source-level guards, since layout is not measurable in jsdom.
describe('0209 r3 CSS polish', () => {
  it('keeps the side-pane tab strip on one row and lets the tabs scroll', () => {
    const css = read('_right-pane.scss');
    expect(css).toMatch(/\.right-pane-tabs\s*\{[^}]*flex-wrap:\s*nowrap;/);
    expect(css).toMatch(/&__list\s*\{[^}]*overflow-x:\s*auto;/);
    expect(css).not.toMatch(/flex-wrap:\s*wrap;/);
  });

  it('outlines the whole tab on keyboard focus', () => {
    expect(read('_right-pane.scss')).toMatch(/&__tab\s*\{[\s\S]*?&:focus-visible\s*\{[^}]*outline:\s*2px solid[^}]*outline-offset:\s*-2px;/);
  });

  it('ends the long header search placeholder with an ellipsis', () => {
    expect(read('_header.scss')).toMatch(/&__search-field\s*\{[^}]*text-overflow:\s*ellipsis;/);
  });

  it('lets the Topics browser search input inherit the page font', () => {
    expect(read('_study-pane.scss')).toMatch(/&__search-input\s*\{[^}]*font-family:\s*inherit;/);
  });
});
