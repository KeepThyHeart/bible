/** The Preferences sidebar glyph of the account section (a person outline). Entry-chunk code: no JSX file needed. */
import { createElement } from 'react';

export const accountGlyph = createElement(
  'svg',
  { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.5 },
  createElement('path', {
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    d: 'M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0',
  }),
);
