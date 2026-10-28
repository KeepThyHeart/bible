/**
 * Verse text fetching and duplicate rows in the passage list (task 0202).
 *
 * Two bugs the Topics pane showed: a list swapped for another of the same
 * length never fetched the new rows' text (they read "Loading..." forever),
 * and the same range twice produced duplicate React keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getVerses = vi.fn();
vi.mock('../../services/electronAPI', () => ({ bibleAPI: { getVerses: (...a: unknown[]) => getVerses(...a) } }));
vi.mock('../../utils/verseReference', () => ({
  formatVerseReference: (id: number) => `ref ${id}`,
  formatVerseRange: (a: number, b: number) => `ref ${a}-${b}`,
  loadBookNamesCache: vi.fn(),
}));
vi.mock('../../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: () => ({ openTabs: [{ abbreviation: 'KJV' }], activeTabIndex: 0 }),
}));
vi.mock('../../stores/useBibleStore', () => ({
  useBibleStore: (sel: (s: { getDefaultBible: () => string }) => unknown) => sel({ getDefaultBible: () => 'KJV' }),
}));
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => (key === 'ui.common.loading' ? 'Loading...' : key), locale: 'en', i18n: {} }),
}));

import VerseListWithPreview from './VerseListWithPreview';

const item = (id: number) => ({ start_verse_id: id, end_verse_id: id });

beforeEach(() => {
  getVerses.mockReset();
  getVerses.mockImplementation(async (_v: string, start: number) => [{ verse_id: start, verse: 1, text: `text ${start}` }]);
});

describe('VerseListWithPreview', () => {
  it('fetches text for a replacement list of the same length', async () => {
    const { rerender } = render(<VerseListWithPreview verses={[item(1001001), item(1001002)]} onVerseClick={vi.fn()} />);
    await screen.findByText('text 1001001');

    rerender(<VerseListWithPreview verses={[item(2002001), item(2002002)]} onVerseClick={vi.fn()} />);

    await screen.findByText('text 2002001');
    await screen.findByText('text 2002002');
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('renders a passage listed twice once, with no duplicate-key warning', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<VerseListWithPreview verses={[item(1003015), item(1003015), item(1012003)]} onVerseClick={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('verse-ref-link')).toHaveLength(2));
    expect(error.mock.calls.filter(c => String(c[0]).includes('same key'))).toHaveLength(0);
    error.mockRestore();
  });
});
