/** The Preferences sidebar glyph of the speech section (a microphone). Entry-chunk code: no JSX file needed. */
import { createElement } from 'react';

export const speechGlyph = createElement(
  'svg',
  { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.5 },
  createElement('path', {
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    d: 'M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z',
  }),
);
