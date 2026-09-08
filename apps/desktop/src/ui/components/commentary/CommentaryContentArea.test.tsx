/**
 * FIX 3 (commentary side) - "no commentary" flashes during session restore.
 *
 * openTabs is published synchronously in sessionSlice.restoreFromSession
 * before batchRestoreSession resolves; loadingByTab is now seeded true for
 * every restored tab in that same update, so isLoading reads true here
 * during the gap instead of the ambiguous default `false`. This should
 * render the shared PaneLoadingSkeleton, not the "no commentary" empty
 * state - and only once useDeferredLoading's 80ms debounce has actually
 * elapsed, so a fast cache-hit load never flashes it either.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import CommentaryContentArea from './CommentaryContentArea';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('./useModuleProvenance', () => ({ useModuleProvenance: () => undefined }));
vi.mock('./DigestDisclaimer', () => ({ default: () => null }));
vi.mock('./CommentaryEntryView', () => ({ default: () => <div data-testid="entry" /> }));
vi.mock('./CommentaryEmptyVerseGrid', () => ({ default: () => null }));

function renderArea(overrides: Partial<React.ComponentProps<typeof CommentaryContentArea>> = {}) {
  return render(
    <CommentaryContentArea
      entries={[]}
      moduleName="Matthew Henry"
      currentVerseId={43003016}
      isLoading={false}
      error={null}
      onNavigatePrev={vi.fn()}
      onNavigateNext={vi.fn()}
      {...overrides}
    />,
  );
}

describe('CommentaryContentArea: session-restore loading gap (FIX 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the shared loading skeleton, not the "no commentary" empty state, once loading has been in flight past the debounce window', () => {
    renderArea({ isLoading: true, entries: [] });

    act(() => {
      vi.advanceTimersByTime(100); // past useDeferredLoading's 80ms debounce
    });

    expect(screen.getByTestId('commentary-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('commentaryContentArea.noCommentary')).not.toBeInTheDocument();
  });

  it('does not flash the skeleton for a fast load that resolves before the debounce window elapses', () => {
    renderArea({ isLoading: true, entries: [] });

    act(() => {
      vi.advanceTimersByTime(30); // well under the 80ms debounce
    });

    expect(screen.queryByTestId('commentary-loading-skeleton')).not.toBeInTheDocument();
  });

  it('shows the real "no commentary" empty state once loading has genuinely finished with zero entries', () => {
    renderArea({ isLoading: false, entries: [] });

    expect(screen.queryByTestId('commentary-loading-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('commentaryContentArea.noCommentary')).toBeInTheDocument();
  });

  it('renders entries normally once loading has finished with content', () => {
    renderArea({
      isLoading: false,
      entries: [{ entry_id: 1, entry_level: 'verse', content: 'Some commentary text' }],
    });

    expect(screen.queryByTestId('commentary-loading-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('entry')).toBeInTheDocument();
  });
});
