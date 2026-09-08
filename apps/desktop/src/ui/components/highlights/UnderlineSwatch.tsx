import React from 'react';
import type { HighlightColor, UnderlineStyle } from '@bible/core';

/**
 * The preview inside one swatch of the underline-colour picker: a single bold
 * line, drawn in that swatch's colour and in the underline style currently
 * chosen.
 *
 * A capital "A" wearing the real `.word.underline-*` classes would be a
 * faithful preview of the *mark* and a poor preview of the *colour*, which is
 * what the grid is for: the glyph is the largest thing in a 40px button, and
 * the two-pixel rule under it - the only coloured pixels - is the part the
 * reader is trying to compare across six swatches. Picking red from that grid
 * would be guesswork.
 *
 * Drawn as SVG rather than as `text-decoration` on invisible text, because
 * `wavy` has no CSS border equivalent and text-decoration needs a text run to
 * paint over: sizing it then means sizing a string of spaces. The stroke is
 * `var(--underline-color-<name>)`, the same token
 * `.word.underline-color-<name>` uses in `highlights.css` (including its
 * dark-theme brightening), so the preview and the applied mark cannot drift.
 */

/** Roomy enough to show two dashes or three wave crests inside a 40px button. */
const WIDTH = 26;
const HEIGHT = 10;
/** Vertical centre - the line sits on the baseline of the box, not at its top. */
const MID = HEIGHT / 2;
const INSET = 1;

/** "Bold", per the report: thick enough that the colour is unmistakable. */
const THICKNESS = 3;
/** Wavy needs a slightly finer stroke or the crests merge into a bar. */
const WAVY_THICKNESS = 2;

/**
 * A wave across the full width: one quadratic hump, then repeated smoothly.
 * Each segment advances 3px, so the run ends at `WIDTH - INSET`.
 */
const WAVY_PATH = `M${INSET} ${MID} q1.5 -3 3 0 ${'t3 0 '.repeat(7).trim()}`;

const DASH_ARRAY: Partial<Record<UnderlineStyle, string>> = {
  dashed: '6 4',
  // A zero-length dash with a round cap is a dot; the gap sets their spacing.
  dotted: '0.01 5',
};

export interface UnderlineSwatchProps {
  /** The style being previewed - the one selected in the picker above. */
  style: UnderlineStyle;
  /** The colour this swatch offers. */
  color: HighlightColor;
}

export const UnderlineSwatch: React.FC<UnderlineSwatchProps> = ({ style, color }) => {
  const stroke = `var(--underline-color-${color})`;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      data-testid="underline-swatch"
      data-underline-style={style}
      data-underline-color={color}
    >
      {style === 'wavy' ? (
        <path
          d={WAVY_PATH}
          fill="none"
          stroke={stroke}
          strokeWidth={WAVY_THICKNESS}
          strokeLinecap="round"
        />
      ) : (
        <line
          x1={INSET}
          y1={MID}
          x2={WIDTH - INSET}
          y2={MID}
          stroke={stroke}
          strokeWidth={THICKNESS}
          strokeLinecap={style === 'dotted' ? 'round' : 'butt'}
          strokeDasharray={DASH_ARRAY[style]}
        />
      )}
    </svg>
  );
};

export default UnderlineSwatch;
