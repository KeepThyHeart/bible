/** The Preferences sidebar glyph of the measures section (a pair of scales). Entry-chunk code: no JSX file needed. */
import { createElement } from 'react';

export const measuresGlyph = createElement(
  'svg',
  { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.5 },
  createElement('path', {
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    d: 'M12 3v18M6 21h12M5 7h14M5 7l-2.5 7a3.5 3.5 0 0 0 5 0L5 7Zm14 0-2.5 7a3.5 3.5 0 0 0 5 0L19 7Z',
  }),
);
