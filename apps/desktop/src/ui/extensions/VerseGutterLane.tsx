/**
 * The verse gutter lane (task 0036, P0.1a, amendment A4).
 *
 * A fixed-width 18px lane next to the verse-number affordance in Standard
 * (`BibleVerseList`) and Study (`StudyModeView`) mode - present whenever ANY
 * enabled decorator layer applies to the current surface, so enabling an
 * extension shifts the column once and individual marks arriving never do.
 * Never rendered in Reading mode, even for a layer that opted in to it
 * (amendment A4 supersedes the design doc's reading-mode inline-prefix
 * design entirely - Reading mode is deliberately simple).
 *
 * Icons come from the host's own closed `HostIconKey` set - this is a tiny
 * inline glyph table, not an extension-supplied SVG.
 */

import React from 'react';
import { useVerseGutterMarks, useHasEnabledDecoratorLayers } from './useResolvedVerseDecorations';
import type { GutterMark } from '@bible/core/browser';

const ICON_GLYPH: Record<string, string> = {
  dot: '●',
  flag: '⚑',
  star: '★',
  bookmark: '⬒',
  info: 'ℹ',
  warning: '⚠',
  check: '✓',
  cross: '✕',
  question: '?',
  pencil: '✎',
};

function GutterIcon({ mark }: { mark: GutterMark }): JSX.Element {
  const title = typeof mark.tooltip === 'string' ? mark.tooltip : undefined;
  return (
    <span
      className="verse-gutter-mark inline-block leading-none"
      style={mark.color ? { color: mark.color } : undefined}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {ICON_GLYPH[mark.icon] ?? ICON_GLYPH.dot}
    </span>
  );
}

export interface VerseGutterProps {
  verseId: number;
  moduleId: number;
  surface: 'standard' | 'study';
}

/**
 * One verse's gutter cell. Always reserves the 18px width when the lane
 * itself is present (see `useHasEnabledDecoratorLayers`, checked by the
 * caller), whether or not THIS verse has a mark - that is what keeps marks
 * arriving from ever shifting text.
 */
export const VerseGutter: React.FC<VerseGutterProps> = ({ verseId, moduleId, surface }) => {
  const { gutter, gutterOverflow } = useVerseGutterMarks(verseId, moduleId, surface);
  return (
    <span className="verse-gutter flex-shrink-0 flex items-start justify-center gap-0.5" style={{ width: 18 }}>
      {gutter.map((mark, i) => (
        <GutterIcon key={`${mark.layerKey}-${i}`} mark={mark} />
      ))}
      {gutterOverflow > 0 && (
        <span className="verse-gutter-overflow text-[10px] text-text-muted" title={`+${gutterOverflow} more`}>
          +{gutterOverflow}
        </span>
      )}
    </span>
  );
};

export { useHasEnabledDecoratorLayers };
