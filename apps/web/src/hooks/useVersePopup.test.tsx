/**
 * Tests for the verse-reference popup hook.
 *
 * This is the hook behind every scripture reference in rendered content —
 * commentary, cross-references, topic entries. It has three different
 * behaviours for the same link depending on the pointer and the modifier key:
 * hover a mouse and you get a preview tooltip after a beat; tap on a touch
 * screen and you get a popup with a "Go" button, because there is no hover to
 * preview with; ctrl-click and it opens in a new tab instead of moving the
 * pane you are reading.
 *
 * The parts worth pinning down are the ones that go wrong quietly. The 300ms
 * hover debounce has to be cancelled when the pointer leaves, or a tooltip
 * appears for a link the reader has already moved off. The fetch failure paths
 * have to fall back to plain navigation rather than leaving a spinner on
 * screen. And a click has to be recognised only on an actual `.scripture-link`
 * with a parseable href, while still calling `preventDefault` on every anchor
 * — the content is arbitrary HTML, and one unprevented `<a href>` navigates
 * the whole SPA away.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import type { IBibleDataProvider } from '../providers/interfaces';
import type { VerseData } from '../types';

// ---- Mocks ---------------------------------------------------------------

const BOOKS: Record<number, string> = { 43: 'John', 45: 'Romans', 19: 'Psalm' };

vi.mock('../constants', () => ({
  formatPassageRef: (book: number, chapter: number, verse?: number | null) =>
    verse ? `${BOOKS[book] ?? book} ${chapter}:${verse}` : `${BOOKS[book] ?? book} ${chapter}`,
}));

const mockAddTabWithPassage = vi.fn();
const mockNavigateToPreview = vi.fn();
let mockActiveTab: { moduleAbbr: string } | undefined = { moduleAbbr: 'KJV' };

vi.mock('../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => mockActiveTab,
    addTabWithPassage: (...args: unknown[]) => mockAddTabWithPassage(...args),
    navigateToPreview: (...args: unknown[]) => mockNavigateToPreview(...args),
  },
}));

// The real one measures and repositions after paint; irrelevant here and it
// only reports zeroes under happy-dom.
vi.mock('./useViewportPosition', () => ({ useViewportPosition: () => ({ current: null }) }));

// Same store-mocking pattern as VerseRenderer.test.tsx: a mutable module-scope
// flag so a test can flip "Words of Christ in red" without a live store, and a
// useStore that just runs the selector.
let mockWordsOfChristInRed = true;
vi.mock('./useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));
vi.mock('../stores/settingsStore', () => ({
  settingsStore: {
    get wordsOfChristInRed() { return mockWordsOfChristInRed; },
  },
}));

const { useVersePopup } = await import('./useVersePopup');

// ---- Harness -------------------------------------------------------------

const JOHN_3_16 = 43003016;
const JOHN_3_17 = 43003017;
const JOHN_3_18 = 43003018;
const JOHN_4_2 = 43004002;

/**
 * A full `VerseData`, with only the fields under test varied.
 *
 * The stubs below return a full record rather than a bare `{ text_html }` /
 * `{ text }` object cast to `Partial<IBibleDataProvider>`: that is a shape the
 * provider never produces, since the server always sends every column. Varying
 * the real record keeps the fallback cases (empty html, empty text) honest.
 */
function verseData(overrides: Partial<VerseData> = {}): VerseData {
  return {
    verse_id: JOHN_3_16,
    book_number: 43,
    chapter: 3,
    verse: 16,
    text: 'For God so loved the world',
    text_html: 'For God so loved the world',
    is_paragraph_start: false,
    words_of_christ: false,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<IBibleDataProvider> = {}): IBibleDataProvider {
  return {
    getVerse: vi.fn(async () => verseData()),
    getVerseTexts: vi.fn(async (_m: string, ids: number[]) => ({
      verses: Object.fromEntries(ids.map(id => [String(id), { text_html: `text-${id}` }])),
    })),
    ...overrides,
  } as unknown as IBibleDataProvider;
}

function Harness({ provider }: { provider?: IBibleDataProvider }) {
  const { containerProps, popupJsx, handleHover, handleLeave, handleClick } = useVersePopup(provider);
  return (
    <div>
      <div data-testid="content" {...containerProps}>
        <a class="scripture-link" href={`#verse-${JOHN_3_16}`} data-testid="link">John 3:16</a>
        <a class="scripture-link" href={`#verse-${JOHN_3_16}-${JOHN_3_18}`} data-testid="range">John 3:16-18</a>
        <a class="scripture-link" href="#not-a-verse" data-testid="bad-href">bad</a>
        <a class="scripture-link" data-testid="no-href">no href</a>
        <a href="https://example.com" data-testid="plain-anchor">elsewhere</a>
        <span data-testid="not-a-link">plain text</span>
      </div>
      <span
        data-testid="direct"
        onMouseOver={(e: MouseEvent) => handleHover(JOHN_3_16, e)}
        onMouseOut={handleLeave}
        onClick={(e: MouseEvent) => handleClick(JOHN_3_16, e, JOHN_3_18)}
      >direct</span>
      {popupJsx}
    </div>
  );
}

/** Simulate a touch device (or not). The hook branches on `pointer: coarse`. */
function setPointer(kind: 'fine' | 'coarse') {
  window.matchMedia = ((query: string) => ({
    matches: kind === 'coarse' && query.includes('coarse'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** Run out the hover debounce and let the verse fetch settle. */
async function settleHover() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Let a click's fetch settle (no debounce on this path). */
async function settleClick() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockActiveTab = { moduleAbbr: 'KJV' };
  mockWordsOfChristInRed = true;
  setPointer('fine');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---- Hover tooltip -------------------------------------------------------

describe('hover tooltip', () => {
  it('shows the verse after the hover delay', async () => {
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    expect(container.querySelector('.verse-ref-tooltip__ref')?.textContent).toBe('John 3:16');
    expect(container.querySelector('.verse-ref-tooltip__text')?.textContent).toBe('For God so loved the world');
  });

  it('shows nothing before the delay elapses', async () => {
    // Without the debounce, dragging the pointer across a paragraph of
    // cross-references fires a fetch and a tooltip for every one of them.
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);

    fireEvent.mouseOver(getByTestId('link'));
    await act(async () => { vi.advanceTimersByTime(299); });

    expect(container.querySelector('.verse-ref-tooltip')).toBeNull();
  });

  it('cancels a pending tooltip when the pointer leaves first', async () => {
    // The race: leave before the timer fires and the tooltip must never
    // appear, not appear and then be dismissed.
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);

    fireEvent.mouseOver(getByTestId('link'));
    await act(async () => { vi.advanceTimersByTime(200); });
    fireEvent.mouseOut(getByTestId('content'));
    await settleHover();

    expect(container.querySelector('.verse-ref-tooltip')).toBeNull();
  });

  it('hides a tooltip that is already up', async () => {
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);
    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    await act(async () => { fireEvent.mouseOut(getByTestId('content')); });

    expect(container.querySelector('.verse-ref-tooltip')).toBeNull();
  });

  it('strips markup the small box cannot honour, keeping the words', async () => {
    // Footnote markers and paragraph breaks have no place in a one-line
    // preview; the words they wrap do.
    const provider = makeProvider({
      getVerse: vi.fn(async () => verseData({
        text_html: '<p>Verily</p>,\n  I  say<sup class="verse__footnote-marker">a</sup>',
      })),
    });
    const { getByTestId, container } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    expect(container.querySelector('.verse-ref-tooltip__text')?.textContent).toBe('Verily, I saya');
  });

  it('renders the words of Christ in red, as the reading pane does', async () => {
    // The preview showed `text_html` flattened to plain text, so a red-letter
    // verse previewed in black right next to a pane rendering it in red.
    const provider = makeProvider({
      getVerse: vi.fn(async () => verseData({
        text_html: '<span class="christ-words">Verily</span>, I say',
      })),
    });
    const { getByTestId, container } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    const text = container.querySelector('.verse-ref-tooltip__text');
    expect(text?.querySelector('.christ-words')?.textContent).toBe('Verily,');
    expect(text?.textContent).toBe('Verily, I say');
  });

  it('honours "Words of Christ in red" being switched off', async () => {
    mockWordsOfChristInRed = false;
    const provider = makeProvider({
      getVerse: vi.fn(async () => verseData({
        text_html: '<span class="christ-words">Verily</span>, I say',
      })),
    });
    const { getByTestId, container } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    const text = container.querySelector('.verse-ref-tooltip__text');
    expect(text?.querySelector('.christ-words')).toBeNull();
    expect(text?.textContent).toBe('Verily, I say');
  });

  it('falls back to the plain text field when there is no html', async () => {
    // An empty `text_html` is what a module with no markup for this verse
    // actually sends; the hook then falls back to `text`.
    const provider = makeProvider({
      getVerse: vi.fn(async () => verseData({ text_html: '', text: 'plain text' })),
    });
    const { getByTestId, container } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    expect(container.querySelector('.verse-ref-tooltip__text')?.textContent).toBe('plain text');
  });

  it('fetches a given verse only once', async () => {
    const provider = makeProvider();
    const { getByTestId } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();
    fireEvent.mouseOut(getByTestId('content'));
    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    expect(provider.getVerse).toHaveBeenCalledTimes(1);
  });

  it('still shows the tooltip on the second hover, from cache', async () => {
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);
    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();
    await act(async () => { fireEvent.mouseOut(getByTestId('content')); });

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    expect(container.querySelector('.verse-ref-tooltip__text')?.textContent).toBe('For God so loved the world');
  });

  it('stays silent when the verse cannot be fetched', async () => {
    // A commentary can reference a verse the open translation does not have.
    // An error tooltip on hover would be worse than none.
    const provider = makeProvider({ getVerse: vi.fn(async () => { throw new Error('not found'); }) } as Partial<IBibleDataProvider>);
    const { getByTestId, container } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    expect(container.querySelector('.verse-ref-tooltip')).toBeNull();
  });

  it('does not preview on a touch screen', async () => {
    // There is no hover on touch; the tap path shows a popup instead.
    setPointer('coarse');
    const provider = makeProvider();
    const { getByTestId, container } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    expect(container.querySelector('.verse-ref-tooltip')).toBeNull();
    expect(provider.getVerse).not.toHaveBeenCalled();
  });

  it('does nothing without a data provider', async () => {
    // The hook is used in contexts that have no Bible provider wired up.
    const { getByTestId, container } = render(<Harness />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    expect(container.querySelector('.verse-ref-tooltip')).toBeNull();
  });

  it('does nothing with no translation open', async () => {
    mockActiveTab = undefined;
    const provider = makeProvider();
    const { getByTestId } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    expect(provider.getVerse).not.toHaveBeenCalled();
  });

  it('works on a directly-wired link too', async () => {
    // Cross-reference lists pass the verse id in rather than going through
    // href parsing.
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);

    fireEvent.mouseOver(getByTestId('direct'));
    await settleHover();

    expect(container.querySelector('.verse-ref-tooltip__ref')?.textContent).toBe('John 3:16');
  });

  it('ignores a hover that is not on a scripture link', async () => {
    const provider = makeProvider();
    const { getByTestId } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('not-a-link'));
    await settleHover();

    expect(provider.getVerse).not.toHaveBeenCalled();
  });

  it('ignores a scripture link whose href is not a verse', async () => {
    const provider = makeProvider();
    const { getByTestId } = render(<Harness provider={provider} />);

    fireEvent.mouseOver(getByTestId('bad-href'));
    fireEvent.mouseOver(getByTestId('no-href'));
    await settleHover();

    expect(provider.getVerse).not.toHaveBeenCalled();
  });
});

// ---- Click, pointer: fine ------------------------------------------------

describe('click on a mouse', () => {
  it('navigates the Bible pane and asks the app to show it', async () => {
    const { getByTestId } = render(<Harness provider={makeProvider()} />);
    const shown = vi.fn();
    window.addEventListener('navigate-to-bible', shown);

    fireEvent.click(getByTestId('link'));

    expect(mockNavigateToPreview).toHaveBeenCalledWith(43, 3, 16, undefined);
    expect(shown).toHaveBeenCalled();
    window.removeEventListener('navigate-to-bible', shown);
  });

  it('carries the end of a range through', async () => {
    const { getByTestId } = render(<Harness provider={makeProvider()} />);

    fireEvent.click(getByTestId('range'));

    expect(mockNavigateToPreview).toHaveBeenCalledWith(43, 3, 16, JOHN_3_18);
  });

  it('opens a new tab on ctrl-click instead of moving the current one', async () => {
    const { getByTestId } = render(<Harness provider={makeProvider()} />);

    fireEvent.click(getByTestId('link'), { ctrlKey: true });

    expect(mockAddTabWithPassage).toHaveBeenCalledWith('KJV', 43, 3, 16);
    expect(mockNavigateToPreview).not.toHaveBeenCalled();
  });

  it('treats cmd-click the same way', async () => {
    const { getByTestId } = render(<Harness provider={makeProvider()} />);

    fireEvent.click(getByTestId('link'), { metaKey: true });

    expect(mockAddTabWithPassage).toHaveBeenCalled();
  });

  it('opens the new tab in the reader\'s translation, defaulting to KJV', async () => {
    mockActiveTab = { moduleAbbr: 'ASV' };
    const { getByTestId, rerender } = render(<Harness provider={makeProvider()} />);
    fireEvent.click(getByTestId('link'), { ctrlKey: true });
    expect(mockAddTabWithPassage).toHaveBeenCalledWith('ASV', 43, 3, 16);

    mockActiveTab = undefined;
    rerender(<Harness provider={makeProvider()} />);
    fireEvent.click(getByTestId('link'), { ctrlKey: true });

    expect(mockAddTabWithPassage).toHaveBeenLastCalledWith('KJV', 43, 3, 16);
  });

  it('stops the browser following any anchor in the content', async () => {
    // Rendered commentary is arbitrary HTML. One unprevented `<a href>` and
    // the SPA navigates away, losing the session.
    const { getByTestId } = render(<Harness provider={makeProvider()} />);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    getByTestId('plain-anchor').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a click that is not on a link at all', async () => {
    const { getByTestId } = render(<Harness provider={makeProvider()} />);

    fireEvent.click(getByTestId('not-a-link'));

    expect(mockNavigateToPreview).not.toHaveBeenCalled();
  });

  it('ignores a scripture link with an unparseable href', async () => {
    const { getByTestId } = render(<Harness provider={makeProvider()} />);

    fireEvent.click(getByTestId('bad-href'));
    fireEvent.click(getByTestId('no-href'));

    expect(mockNavigateToPreview).not.toHaveBeenCalled();
  });

  it('shows no popup on a mouse', async () => {
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);

    fireEvent.click(getByTestId('link'));
    await settleClick();

    expect(container.querySelector('.verse-link-popup')).toBeNull();
  });
});

// ---- Click, pointer: coarse ----------------------------------------------

describe('tap on a touch screen', () => {
  beforeEach(() => setPointer('coarse'));

  it('previews the verse in a popup rather than navigating', async () => {
    // The reader gets to see what the reference says before deciding to leave
    // the page they are on — the thing hover does on a mouse.
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);

    fireEvent.click(getByTestId('link'));
    await settleClick();

    expect(container.querySelector('.verse-link-popup__ref')?.textContent).toBe('John 3:16');
    expect(container.querySelector('.verse-link-popup__text')?.textContent).toBe('For God so loved the world');
    expect(mockNavigateToPreview).not.toHaveBeenCalled();
  });

  it('shows a spinner while the verse is loading', async () => {
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);

    // Deliberately not awaiting the fetch: the loading frame is the thing
    // under test, and awaiting it renders the resolved popup instead.
    fireEvent.click(getByTestId('link'));

    expect(container.querySelector('.verse-link-popup__text .fa-spinner')).toBeTruthy();
  });

  it('takes the reader to the passage from the Go button', async () => {
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);
    const shown = vi.fn();
    window.addEventListener('navigate-to-bible', shown);
    fireEvent.click(getByTestId('link'));
    await settleClick();

    await act(async () => { fireEvent.click(container.querySelector('.verse-link-popup__go')!); });

    expect(mockNavigateToPreview).toHaveBeenCalledWith(43, 3, 16, undefined);
    expect(shown).toHaveBeenCalled();
    expect(container.querySelector('.verse-link-popup')).toBeNull();
    window.removeEventListener('navigate-to-bible', shown);
  });

  it('navigates instead of leaving a stuck spinner when the fetch fails', async () => {
    const provider = makeProvider({ getVerse: vi.fn(async () => { throw new Error('nope'); }) } as Partial<IBibleDataProvider>);
    const { getByTestId, container } = render(<Harness provider={provider} />);

    fireEvent.click(getByTestId('link'));
    await settleClick();

    expect(container.querySelector('.verse-link-popup')).toBeNull();
    expect(mockNavigateToPreview).toHaveBeenCalledWith(43, 3, 16);
  });

  it('reuses a verse already fetched for a tooltip', async () => {
    // The cache is shared between the two paths, so a reference previewed on a
    // hybrid device does not get fetched twice.
    setPointer('fine');
    const provider = makeProvider();
    const { getByTestId } = render(<Harness provider={provider} />);
    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();
    setPointer('coarse');

    fireEvent.click(getByTestId('link'));
    await settleClick();

    expect(provider.getVerse).toHaveBeenCalledTimes(1);
  });

  it('still navigates on ctrl-click', async () => {
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);

    fireEvent.click(getByTestId('link'), { ctrlKey: true });
    await settleClick();

    expect(mockAddTabWithPassage).toHaveBeenCalled();
    expect(container.querySelector('.verse-link-popup')).toBeNull();
  });

  it('navigates when there is no provider to preview with', async () => {
    const { getByTestId, container } = render(<Harness />);

    fireEvent.click(getByTestId('link'));
    await settleClick();

    expect(container.querySelector('.verse-link-popup')).toBeNull();
    expect(mockNavigateToPreview).toHaveBeenCalledWith(43, 3, 16, undefined);
  });

  describe('ranges', () => {
    it('shows both verses of a two-verse range', async () => {
      const provider = makeProvider();
      const { container } = render(<Harness provider={provider} />);
      const link = container.querySelector('[data-testid="content"]')!.appendChild(
        Object.assign(document.createElement('a'), {
          className: 'scripture-link',
          href: `#verse-${JOHN_3_16}-${JOHN_3_17}`,
          textContent: 'John 3:16-17',
        }),
      );

      fireEvent.click(link);
      await settleClick();

      expect(provider.getVerseTexts).toHaveBeenCalledWith('KJV', [JOHN_3_16, JOHN_3_17]);
      expect(container.querySelector('.verse-link-popup__text')?.textContent)
        .toBe(`text-${JOHN_3_16} text-${JOHN_3_17}`);
    });

    it('fetches only the first verse of a longer range and marks it elided', async () => {
      // A ten-verse preview would be the passage itself. The ellipsis is what
      // tells the reader the popup is a taste, not the whole thing.
      const provider = makeProvider();
      const { getByTestId, container } = render(<Harness provider={provider} />);

      fireEvent.click(getByTestId('range'));
      await settleClick();

      expect(provider.getVerseTexts).toHaveBeenCalledWith('KJV', [JOHN_3_16]);
      expect(container.querySelector('.verse-link-popup__text')?.textContent).toBe(`text-${JOHN_3_16} …`);
    });

    it('labels a range inside one chapter with a bare end verse', async () => {
      const { getByTestId, container } = render(<Harness provider={makeProvider()} />);

      fireEvent.click(getByTestId('range'));
      await settleClick();

      expect(container.querySelector('.verse-link-popup__ref')?.textContent).toBe('John 3:16-18');
    });

    it('spells out the end of a range that crosses chapters', async () => {
      const { container } = render(<Harness provider={makeProvider()} />);
      const link = container.querySelector('[data-testid="content"]')!.appendChild(
        Object.assign(document.createElement('a'), {
          className: 'scripture-link',
          href: `#verse-${JOHN_3_16}-${JOHN_4_2}`,
          textContent: 'John 3:16 - 4:2',
        }),
      );

      fireEvent.click(link);
      await settleClick();

      expect(container.querySelector('.verse-link-popup__ref')?.textContent).toBe('John 3:16–John 4:2');
    });

    it('treats a range that ends where it starts as a single verse', async () => {
      const provider = makeProvider();
      const { container } = render(<Harness provider={provider} />);
      const link = container.querySelector('[data-testid="content"]')!.appendChild(
        Object.assign(document.createElement('a'), {
          className: 'scripture-link',
          href: `#verse-${JOHN_3_16}-${JOHN_3_16}`,
          textContent: 'John 3:16',
        }),
      );

      fireEvent.click(link);
      await settleClick();

      expect(provider.getVerse).toHaveBeenCalled();
      expect(provider.getVerseTexts).not.toHaveBeenCalled();
      expect(container.querySelector('.verse-link-popup__ref')?.textContent).toBe('John 3:16');
    });

    it('navigates rather than hanging when a range fetch fails', async () => {
      const provider = makeProvider({
        getVerseTexts: vi.fn(async () => { throw new Error('nope'); }),
      } as Partial<IBibleDataProvider>);
      const { getByTestId, container } = render(<Harness provider={provider} />);

      fireEvent.click(getByTestId('range'));
      await settleClick();

      expect(container.querySelector('.verse-link-popup')).toBeNull();
      expect(mockNavigateToPreview).toHaveBeenCalledWith(43, 3, 16);
    });

    it('says so rather than showing an empty box when no verse comes back', async () => {
      // A two-verse range: the placeholder is only reachable here. For a
      // longer range the ellipsis is appended first, so an empty result shows
      // as a bare "…" instead — noted rather than asserted, since which of the
      // two a reader sees is not a decision this test should freeze.
      const provider = makeProvider({ getVerseTexts: vi.fn(async () => ({ verses: {} })) } as Partial<IBibleDataProvider>);
      const { container } = render(<Harness provider={provider} />);
      const link = container.querySelector('[data-testid="content"]')!.appendChild(
        Object.assign(document.createElement('a'), {
          className: 'scripture-link',
          href: `#verse-${JOHN_3_16}-${JOHN_3_17}`,
          textContent: 'John 3:16-17',
        }),
      );

      fireEvent.click(link);
      await settleClick();

      expect(container.querySelector('.verse-link-popup__text')?.textContent).toContain('(no text)');
    });
  });
});

// ---- Dismissal -----------------------------------------------------------

describe('dismissal', () => {
  beforeEach(() => setPointer('coarse'));

  async function openPopup() {
    const view = render(<Harness provider={makeProvider()} />);
    fireEvent.click(view.getByTestId('link'));
    await settleClick();
    expect(view.container.querySelector('.verse-link-popup')).toBeTruthy();
    return view;
  }

  it('closes the popup on a tap outside it', async () => {
    const { container, getByTestId } = await openPopup();

    await act(async () => {
      getByTestId('not-a-link').dispatchEvent(new Event('touchstart', { bubbles: true }));
    });

    expect(container.querySelector('.verse-link-popup')).toBeNull();
  });

  it('closes the popup on a click outside it', async () => {
    const { container, getByTestId } = await openPopup();

    await act(async () => { fireEvent.mouseDown(getByTestId('not-a-link')); });

    expect(container.querySelector('.verse-link-popup')).toBeNull();
  });

  it('stays open when the popup itself is touched', async () => {
    // Otherwise the popup closes before the Go button's click lands.
    const { container } = await openPopup();

    await act(async () => { fireEvent.mouseDown(container.querySelector('.verse-link-popup')!); });

    expect(container.querySelector('.verse-link-popup')).toBeTruthy();
  });

  it('dismisses the hover tooltip on a touch', async () => {
    setPointer('fine');
    const { getByTestId, container } = render(<Harness provider={makeProvider()} />);
    fireEvent.mouseOver(getByTestId('link'));
    await settleHover();

    await act(async () => {
      getByTestId('not-a-link').dispatchEvent(new Event('touchstart', { bubbles: true }));
    });

    expect(container.querySelector('.verse-ref-tooltip')).toBeNull();
  });

  it('renders nothing at all when neither is showing', () => {
    const { container } = render(<Harness provider={makeProvider()} />);

    expect(container.querySelector('.verse-ref-tooltip')).toBeNull();
    expect(container.querySelector('.verse-link-popup')).toBeNull();
  });

  it('leaves no listeners behind after unmount', async () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = await openPopup();

    unmount();

    expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('touchstart', expect.any(Function));
    remove.mockRestore();
  });
});
