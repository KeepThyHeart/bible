/**
 * The way home from a preview.
 *
 * The bar is an offer, not a mode - these tests pin that it appears only when
 * there is somewhere to go, that it fades itself out rather than sitting over
 * the text forever, and that dismissing it does not silently discard the
 * preview it belongs to (that decision lives in the store; here it just means
 * the bar reports the dismissal and nothing more).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

vi.mock('../../utils/verseReference', () => ({
  formatVerseReference: (verseId: number) => (verseId === 43003016 ? 'John 3:16' : `#${verseId}`),
}));

import PreviewBackBar from './PreviewBackBar';
import { enT } from '../../testing/enCatalog';

const JOHN_3_16 = 43003016;

describe('PreviewBackBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there is nowhere to go back to', () => {
    render(<PreviewBackBar verseId={null} onBack={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('preview-back-bar')).not.toBeInTheDocument();
  });

  it('names the verse the reader left', () => {
    render(<PreviewBackBar verseId={JOHN_3_16} onBack={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('preview-back-bar-back')).toHaveTextContent('John 3:16');
  });

  it('goes back when the label is clicked', () => {
    const onBack = vi.fn();
    render(<PreviewBackBar verseId={JOHN_3_16} onBack={onBack} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByTestId('preview-back-bar-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('dismisses on the ×', () => {
    const onDismiss = vi.fn();
    render(<PreviewBackBar verseId={JOHN_3_16} onBack={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('preview-back-bar-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  // A reader who has moved on and started reading where they landed should not
  // keep being told about a verse they have finished with.
  it('fades itself out and dismisses after half a minute', () => {
    const onDismiss = vi.fn();
    render(<PreviewBackBar verseId={JOHN_3_16} onBack={vi.fn()} onDismiss={onDismiss} />);

    act(() => { vi.advanceTimersByTime(29_000); });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1_500); });
    expect(onDismiss).toHaveBeenCalled();
  });

  // Following a second link restarts the clock rather than inheriting the
  // remainder of the first one's.
  it('restarts its clock when the target changes', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <PreviewBackBar verseId={JOHN_3_16} onBack={vi.fn()} onDismiss={onDismiss} />,
    );

    act(() => { vi.advanceTimersByTime(25_000); });
    rerender(<PreviewBackBar verseId={45008028} onBack={vi.fn()} onDismiss={onDismiss} />);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(21_000); });
    expect(onDismiss).toHaveBeenCalled();
  });
});
