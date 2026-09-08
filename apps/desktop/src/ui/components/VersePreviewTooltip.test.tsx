/**
 * The verse preview popup's navigation affordances.
 *
 * The footer hint is a per-consumer prop. A hardcoded "Ctrl+Click: new tab -
 * Alt+Click: current tab" shown by all six consumers would be wrong for most
 * of them: only the notes editor handles both modifiers, while the Study
 * pane's cross-references and the read-only note viewer navigate on a plain
 * click and ignore modifiers entirely. The popup also offers an explicit
 * "Go to verse" button so following a reference does not depend on knowing a
 * modifier convention at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VersePreviewTooltip from './VersePreviewTooltip';
import { __clearVerseFetchCache } from '../services/verseFetchCache';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => (key === 'versePreviewTooltip.goToVerse' ? 'Go to verse' : key),
    locale: 'en',
    i18n: {},
  }),
}));

vi.mock('../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: () => ({ openTabs: [{ abbreviation: 'KJV' }], activeTabIndex: 0 }),
}));

vi.mock('../utils/verseReference', () => ({ loadBookNamesCache: vi.fn().mockResolvedValue(undefined) }));

/**
 * "Words of Christ in red" comes from the Bible pane's text settings. Mocked
 * rather than driven through the real zustand store so a test can flip it
 * without dragging in session persistence.
 */
let mockShowRedLetter = true;
vi.mock('../stores/useTextSettingsStore', () => ({
  useTextSettingsStore: (selector: (state: { getSettings: (pane: string) => { showRedLetter: boolean } }) => unknown) =>
    selector({ getSettings: () => ({ showRedLetter: mockShowRedLetter }) }),
}));

vi.mock('../utils/verseFormatting', () => ({ formatVerseReference: () => 'John 3:16' }));

const getVerses = vi.fn();
vi.mock('../services/electronAPI', () => ({
  bibleAPI: {
    getVerses: (...args: unknown[]) => getVerses(...args),
    getVerse: vi.fn().mockResolvedValue(null),
  },
}));

const VERSE = {
  verse_id: 43003016,
  book_number: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world',
};

function renderTooltip(props: Partial<React.ComponentProps<typeof VersePreviewTooltip>> = {}) {
  return render(
    <VersePreviewTooltip
      verseId={43003016}
      position={{ x: 10, y: 10 }}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

describe('VersePreviewTooltip', () => {
  beforeEach(() => {
    __clearVerseFetchCache();
    mockShowRedLetter = true;
    getVerses.mockReset();
    getVerses.mockResolvedValue([VERSE]);
  });

  it('renders through a portal to document.body, outside any dock pane', async () => {
    // `usePopupPosition` hands back viewport coordinates and `position: fixed`,
    // which only means "relative to the viewport" while nothing above it
    // establishes a containing block. Dockview's stylesheet does exactly that
    // (`.dv-dockview { contain: layout }`), so a tooltip left inside the pane
    // painted a fixed ~100px low in every pane. Portalling to body is what
    // makes the hook's arithmetic land where it computes.
    const { container } = renderTooltip();
    const card = await screen.findByText(/For God so loved/);
    expect(container).toBeEmptyDOMElement();
    expect(card.closest('body')).toBe(document.body);
  });

  it('renders no footer hint when the consumer does not supply one', async () => {
    renderTooltip();
    await screen.findByText(/For God so loved/);
    // A hardcoded string would advertise Alt+Click in panes that ignore it.
    expect(screen.queryByText(/Alt\+Click/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ctrl\+Click/)).not.toBeInTheDocument();
  });

  it('renders the hint the consumer supplies', async () => {
    renderTooltip({ hint: 'Click: go to verse' });
    expect(await screen.findByText('Click: go to verse')).toBeInTheDocument();
  });

  it('shows no "Go to verse" action unless the consumer wires navigation', async () => {
    renderTooltip();
    await screen.findByText(/For God so loved/);
    expect(screen.queryByRole('button', { name: /Go to verse/ })).not.toBeInTheDocument();
  });

  it('invokes the consumer\'s navigation when "Go to verse" is clicked', async () => {
    const onGoToVerse = vi.fn();
    renderTooltip({ onGoToVerse });

    fireEvent.click(await screen.findByRole('button', { name: /Go to verse/ }));
    expect(onGoToVerse).toHaveBeenCalledTimes(1);
  });

  it('renders the formatted html, so the words of Christ stay red', async () => {
    // Rendering the raw `text` column instead would carry none of the spans
    // `formatVerseText` emits - a red-letter verse previewed in flat black
    // beside a Bible pane showing it in red.
    getVerses.mockResolvedValue([{
      ...VERSE,
      text_html: '<span class="christ-words">Verily I say</span> unto you',
    }]);
    renderTooltip();

    await screen.findByText(/unto you/);
    expect(document.querySelector('.christ-words')?.textContent).toBe('Verily I say');
  });

  it('falls back to the plain text column when a row carries no formatted html', async () => {
    renderTooltip();
    expect(await screen.findByText(/For God so loved/)).toBeInTheDocument();
  });

  it('marks the popup no-red-letter when the reader has that switched off', async () => {
    // The colour lives in a `.no-red-letter .christ-words` rule, so the switch
    // has to reach the popup's own root - it is portalled to <body>, well
    // outside the Bible pane element that carries the class for the reader.
    mockShowRedLetter = false;
    getVerses.mockResolvedValue([{
      ...VERSE,
      text_html: '<span class="christ-words">Verily I say</span> unto you',
    }]);
    renderTooltip();

    await screen.findByText(/unto you/);
    expect(document.querySelector('.christ-words')?.closest('.no-red-letter')).not.toBeNull();
  });

  it('serves a repeat preview of the same range from the shared cache', async () => {
    const { unmount } = renderTooltip();
    await screen.findByText(/For God so loved/);
    unmount();

    renderTooltip();
    await screen.findByText(/For God so loved/);
    // The cache is shared with the notes editor's verse expansion, so a
    // second look at the same reference must not re-hit IPC.
    await waitFor(() => expect(getVerses).toHaveBeenCalledTimes(1));
  });
});
