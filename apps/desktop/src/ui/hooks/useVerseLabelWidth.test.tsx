import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { useVerseLabelWidth, VERSE_LABEL_WIDTH_VAR } from './useVerseLabelWidth';
import type { VerseLabelMode } from '../stores/usePreferencesStore';

/** jsdom has no layout, so each label reports the width in its data attribute. */
function Labels({ mode, widths }: { mode: VerseLabelMode; widths: number[] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useVerseLabelWidth(ref, mode);
  return (
    <div ref={ref} data-testid="root">
      {widths.map((w, i) => (
        <span
          key={i}
          data-verse-label=""
          ref={(el) => {
            if (el) el.getBoundingClientRect = () => ({ width: w } as DOMRect);
          }}
        />
      ))}
    </div>
  );
}

describe('useVerseLabelWidth', () => {
  it('publishes the widest label, rounded up, for the reference styles', () => {
    const { getByTestId, rerender } = render(<Labels mode="bookChapterVerse" widths={[41.2, 52.4, 47]} />);
    expect(getByTestId('root').style.getPropertyValue(VERSE_LABEL_WIDTH_VAR)).toBe('53px');
    rerender(<Labels mode="chapterVerse" widths={[20, 30.1]} />);
    expect(getByTestId('root').style.getPropertyValue(VERSE_LABEL_WIDTH_VAR)).toBe('31px');
  });

  it('leaves plain verse numbers alone', () => {
    const { getByTestId } = render(<Labels mode="number" widths={[20, 30]} />);
    expect(getByTestId('root').style.getPropertyValue(VERSE_LABEL_WIDTH_VAR)).toBe('');
  });
});
