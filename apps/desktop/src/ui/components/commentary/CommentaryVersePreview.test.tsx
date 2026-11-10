import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const panel = vi.hoisted(() => ({ current: null as unknown }));
const fetchVerses = vi.hoisted(() => vi.fn());

vi.mock('../../contexts/useI18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock('../../utils/verseReference', () => ({ formatVerseReference: (id: number) => `Ref ${id}` }));
vi.mock('../../stores/useBibleStore', () => ({
  useBibleStore: (selector: (s: unknown) => unknown) =>
    selector({ panels: new Map([['p1', panel.current]]) }),
}));
vi.mock('../../services/verseFetchCache', () => ({ getVersesCached: fetchVerses }));

import CommentaryVersePreview from './CommentaryVersePreview';

const noop = () => {};

function setPanel(verses: Array<{ verse_id: number; text: string; text_html?: string }>) {
  panel.current = {
    openTabs: [{ tabId: 't1', abbreviation: 'KJV' }],
    activeTabIndex: 0,
    versesByTab: new Map([['t1', verses]]),
  };
}

describe('CommentaryVersePreview verse text', () => {
  beforeEach(() => fetchVerses.mockReset());

  it('shows the reference and the loaded verse text (tags stripped) without fetching', () => {
    setPanel([{ verse_id: 20019017, text: 'x', text_html: 'He that hath <i>pity</i> upon the poor' }]);
    render(<CommentaryVersePreview verseId={20019017} onNavigatePrev={noop} onNavigateNext={noop} isLoading={false} />);
    expect(screen.getByText('Ref 20019017')).toBeInTheDocument();
    expect(screen.getByText('He that hath pity upon the poor')).toBeInTheDocument();
    expect(fetchVerses).not.toHaveBeenCalled();
  });

  it('fetches the verse when the Bible pane has not loaded it (e.g. opened from a search result)', async () => {
    setPanel([{ verse_id: 1001001, text: 'In the beginning' }]);
    fetchVerses.mockResolvedValue([{ verse_id: 20019017, text: 'He that hath pity upon the poor lendeth unto the LORD' }]);
    render(<CommentaryVersePreview verseId={20019017} onNavigatePrev={noop} onNavigateNext={noop} isLoading={false} />);
    expect(fetchVerses).toHaveBeenCalledWith('KJV', 20019017, 20019017);
    await waitFor(() => expect(screen.getByText(/lendeth unto the LORD/)).toBeInTheDocument());
  });
});
