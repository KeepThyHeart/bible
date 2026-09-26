// @vitest-environment jsdom
// ^ These components sanitize module HTML, and DOMPurify mangles its own
// output under the happy-dom this suite otherwise runs on — it drops the first
// node of a fragment. Browsers are unaffected; see src/utils/sanitize.test.ts.
/**
 * Component tests for VerseRenderer.
 *
 * Pattern: Store-connected presentational component.
 * settingsStore, searchStore, and commentaryStore are mocked so tests can control
 * the wordsOfChristInRed flag without needing a live store. useStore is mocked to
 * call the selector immediately (no subscription overhead).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import type { VerseData, InterlinearWordData } from '../../types';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Store state ---------------------------------------------------------
let mockWordsOfChristInRed = false;
let mockInterlinearLayout: 'inline' | 'stacked' = 'inline';

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

vi.mock('../../stores/settingsStore', () => ({
  settingsStore: {
    get wordsOfChristInRed() { return mockWordsOfChristInRed; },
    get interlinearLayout() { return mockInterlinearLayout; },
  },
}));

const mockPerformSearch = vi.fn();
const mockSetRightPaneMode = vi.fn();

vi.mock('../../stores/searchStore', () => ({
  searchStore: {
    performSearch: (q: string) => mockPerformSearch(q),
  },
}));

vi.mock('../../stores/commentaryStore', () => ({
  commentaryStore: {
    setRightPaneMode: (m: string) => mockSetRightPaneMode(m),
  },
}));

import { VerseRenderer, HIGHLIGHT_HOLD_MS } from './VerseRenderer';
import { resetInterlinearWarnings } from '../../utils/interlinearRows';

// ---- helpers -------------------------------------------------------------
function makeVerse(overrides: Partial<VerseData> = {}): VerseData {
  return {
    verse_id: 43003016,
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

const defaultProps = {
  isHighlighted: false,
  showVerseNumbers: true,
  displayMode: 'standard' as const,
  onVerseClick: vi.fn(),
};

describe('VerseRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWordsOfChristInRed = false;
    mockInterlinearLayout = 'inline';
  });

  // ------------------------------------------------------------------
  // Basic rendering
  // ------------------------------------------------------------------
  it('renders verse text in standard mode', () => {
    const verse = makeVerse({ text_html: 'For God so loved the world' });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} />);
    expect(container.querySelector('.verse')).toBeTruthy();
    expect(container.innerHTML).toContain('For God so loved the world');
  });

  it('renders verse number when showVerseNumbers is true', () => {
    const verse = makeVerse({ verse: 16 });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} showVerseNumbers />);
    // Standard/study mode uses verse__number-left
    expect(container.querySelector('.verse__number-left')?.textContent).toBe('16');
  });

  it('does not render verse number when showVerseNumbers is false', () => {
    const verse = makeVerse();
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} showVerseNumbers={false} />);
    expect(container.querySelector('.verse__number-left')).toBeNull();
    expect(container.querySelector('.verse__number')).toBeNull();
  });

  it('applies verse--study class when isHighlighted is true', () => {
    const verse = makeVerse();
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} isHighlighted />);
    expect(container.querySelector('.verse--study')).toBeTruthy();
  });

  it('applies verse--preview class when isSelected and not highlighted', () => {
    const verse = makeVerse();
    const { container } = render(
      <VerseRenderer verse={verse} {...defaultProps} isHighlighted={false} isSelected />,
    );
    expect(container.querySelector('.verse--preview')).toBeTruthy();
  });

  it('does not apply verse--preview class when both isHighlighted and isSelected are true', () => {
    const verse = makeVerse();
    const { container } = render(
      <VerseRenderer verse={verse} {...defaultProps} isHighlighted isSelected />,
    );
    expect(container.querySelector('.verse--preview')).toBeNull();
  });

  it('applies verse--block class in standard mode', () => {
    const verse = makeVerse();
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} displayMode="standard" />);
    expect(container.querySelector('.verse--block')).toBeTruthy();
  });

  it('applies verse--block class in study mode', () => {
    const verse = makeVerse();
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} displayMode="study" />);
    expect(container.querySelector('.verse--block')).toBeTruthy();
  });

  it('does not apply verse--block class in reading mode', () => {
    const verse = makeVerse();
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} displayMode="reading" />);
    expect(container.querySelector('.verse--block')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Preface verse (verse 0)
  // ------------------------------------------------------------------
  it('applies verse--preface class for verse 0', () => {
    const verse = makeVerse({ verse: 0, verse_id: 43003000 });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} />);
    expect(container.querySelector('.verse--preface')).toBeTruthy();
  });

  it('does not render verse number for preface verse', () => {
    const verse = makeVerse({ verse: 0, verse_id: 43003000 });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} showVerseNumbers />);
    expect(container.querySelector('.verse__number-left')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Section heading
  // ------------------------------------------------------------------
  it('renders section heading when provided', () => {
    const verse = makeVerse({ section_heading: 'God so loved the world' });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} />);
    expect(container.querySelector('.verse__section-heading')?.textContent).toBe('God so loved the world');
  });

  it('does not render section heading element when absent', () => {
    const verse = makeVerse({ section_heading: undefined });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} />);
    expect(container.querySelector('.verse__section-heading')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Reading mode
  // ------------------------------------------------------------------
  it('renders inline span in reading mode', () => {
    const verse = makeVerse();
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} displayMode="reading" />);
    // Reading mode renders a <span class="verse"> not a <div class="verse">
    const el = container.querySelector('.verse');
    expect(el?.tagName.toLowerCase()).toBe('span');
  });

  it('renders paragraph break when is_paragraph_start is true in reading mode', () => {
    const verse = makeVerse({ is_paragraph_start: true });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} displayMode="reading" />);
    expect(container.querySelector('.verse__paragraph-break')).toBeTruthy();
  });

  it('uses sup verse number in reading mode', () => {
    const verse = makeVerse({ verse: 16 });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} displayMode="reading" showVerseNumbers />);
    expect(container.querySelector('.verse__number')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Christ words
  // ------------------------------------------------------------------
  it('preserves christ-words span when wordsOfChristInRed is true', () => {
    mockWordsOfChristInRed = true;
    const verse = makeVerse({ text_html: '<span class="christ-words">I am</span>' });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} />);
    expect(container.innerHTML).toContain('class="christ-words"');
  });

  it('strips christ-words class when wordsOfChristInRed is false', () => {
    mockWordsOfChristInRed = false;
    const verse = makeVerse({ text_html: '<span class="christ-words">I am</span>' });
    const { container } = render(<VerseRenderer verse={verse} {...defaultProps} />);
    expect(container.innerHTML).not.toContain('class="christ-words"');
    expect(container.innerHTML).toContain('I am');
  });

  // ------------------------------------------------------------------
  // Click handler
  // ------------------------------------------------------------------
  it('calls onVerseClick with verse_id on click', () => {
    const onVerseClick = vi.fn();
    const verse = makeVerse({ verse_id: 43003016 });
    const { container } = render(
      <VerseRenderer verse={verse} {...defaultProps} onVerseClick={onVerseClick} />,
    );
    fireEvent.click(container.querySelector('.verse')!);
    // Second argument is the shift-click "extend the passage" flag.
    expect(onVerseClick).toHaveBeenCalledWith(43003016, false);
  });

  it('reports a shift-click as a selection extension', () => {
    const onVerseClick = vi.fn();
    const verse = makeVerse({ verse_id: 43003016 });
    const { container } = render(
      <VerseRenderer verse={verse} {...defaultProps} onVerseClick={onVerseClick} />,
    );
    fireEvent.click(container.querySelector('.verse')!, { shiftKey: true });
    expect(onVerseClick).toHaveBeenCalledWith(43003016, true);
  });

  it('suppresses the browser text selection on shift-mousedown only', () => {
    // Shift-click must not extend the native selection: a non-empty
    // window.getSelection() makes Ctrl+C do a native text copy instead of
    // opening the copy dialog. A plain click is left alone so dragging out a
    // phrase still works.
    const verse = makeVerse({ verse_id: 43003016 });
    const { container } = render(
      <VerseRenderer verse={verse} {...defaultProps} onVerseClick={vi.fn()} />,
    );
    const el = container.querySelector('.verse')!;
    expect(fireEvent.mouseDown(el, { shiftKey: true })).toBe(false); // defaultPrevented
    expect(fireEvent.mouseDown(el)).toBe(true);
  });

  it('marks a verse inside a shift-click range', () => {
    const verse = makeVerse({ verse_id: 43003016 });
    const { container } = render(
      <VerseRenderer verse={verse} {...defaultProps} onVerseClick={vi.fn()} isInRange={true} />,
    );
    expect(container.querySelector('.verse--in-range')).toBeTruthy();
  });

  it('does not mark the anchor verse as merely in-range', () => {
    const verse = makeVerse({ verse_id: 43003016 });
    const { container } = render(
      <VerseRenderer
        verse={verse}
        {...defaultProps}
        onVerseClick={vi.fn()}
        isHighlighted={true}
        isInRange={true}
      />,
    );
    expect(container.querySelector('.verse--in-range')).toBeNull();
    expect(container.querySelector('.verse--study')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Footnotes
  // ------------------------------------------------------------------
  it('renders footnote markers and footnote block in study mode with showNotes', () => {
    const verse = makeVerse({
      footnotes: [{ position: 0, marker: 'a', text: 'A footnote' }],
    });
    const { container } = render(
      <VerseRenderer verse={verse} {...defaultProps} displayMode="study" showNotes />,
    );
    expect(container.querySelector('.verse__footnotes')).toBeTruthy();
    expect(container.querySelector('.verse__footnote-marker')).toBeTruthy();
    expect(container.textContent).toContain('A footnote');
  });

  it('does not render footnotes when showNotes is false', () => {
    const verse = makeVerse({
      footnotes: [{ position: 0, marker: 'a', text: 'A footnote' }],
    });
    const { container } = render(
      <VerseRenderer verse={verse} {...defaultProps} displayMode="study" showNotes={false} />,
    );
    expect(container.querySelector('.verse__footnotes')).toBeNull();
  });

  it('does not render footnotes outside study mode', () => {
    const verse = makeVerse({
      footnotes: [{ position: 0, marker: 'a', text: 'A footnote' }],
    });
    const { container } = render(
      <VerseRenderer verse={verse} {...defaultProps} displayMode="standard" showNotes />,
    );
    expect(container.querySelector('.verse__footnotes')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Interlinear mode
  //
  // Rendering is cell-based: the English tokens come from the verse text and
  // the interlinear rows annotate them, so word order follows the translation
  // and words no row claims are still shown.
  // ------------------------------------------------------------------
  function makeInterlinearWord(overrides: Partial<InterlinearWordData> = {}): InterlinearWordData {
    return {
      verseId: 43003016,
      position: 1,
      positionEnd: 1,
      originalWord: 'θεός',
      transliteration: 'theos',
      strongsNumber: 'G2316',
      morphology: 'N',
      gloss: 'God',
      language: 'greek',
      ...overrides,
    };
  }

  it('renders stacked interlinear words in study mode', () => {
    mockInterlinearLayout = 'stacked';
    const { container } = render(
      <VerseRenderer
        verse={makeVerse()}
        {...defaultProps}
        displayMode="study"
        interlinearWords={[makeInterlinearWord()]}
      />,
    );
    expect(container.querySelector('.verse__body--interlinear')).toBeTruthy();
    expect(container.querySelector('.verse__interlinear-word')).toBeTruthy();
    expect(container.textContent).toContain('God');
    expect(container.textContent).toContain('θεός');
  });

  it('renders the inline layout by default', () => {
    const { container } = render(
      <VerseRenderer
        verse={makeVerse()}
        {...defaultProps}
        displayMode="study"
        interlinearWords={[makeInterlinearWord()]}
      />,
    );
    expect(container.querySelector('.verse__body--interlinear-inline')).toBeTruthy();
    expect(container.querySelector('.verse__body--interlinear')).toBeNull();
    // Prose order, with the Greek in a parenthetical after the word it backs
    expect(container.textContent).toContain('For God');
    expect(container.querySelector('.verse__interlinear-annotation')?.textContent)
      .toContain('θεός');
  });

  it('keeps English words no interlinear row claims', () => {
    // Only "God" is claimed; the rest of the verse must still be rendered.
    const { container } = render(
      <VerseRenderer
        verse={makeVerse()}
        {...defaultProps}
        displayMode="study"
        interlinearWords={[makeInterlinearWord()]}
      />,
    );
    const text = container.textContent ?? '';
    for (const word of ['For', 'God', 'so', 'loved', 'the', 'world']) {
      expect(text).toContain(word);
    }
  });

  it('renders words in English order regardless of row order', () => {
    mockInterlinearLayout = 'stacked';
    const { container } = render(
      <VerseRenderer
        verse={makeVerse()}
        {...defaultProps}
        displayMode="study"
        interlinearWords={[
          makeInterlinearWord({ position: 3, positionEnd: 3, gloss: 'loved', strongsNumber: 'G25' }),
          makeInterlinearWord({ position: 1, positionEnd: 1, gloss: 'God' }),
        ]}
      />,
    );
    const glosses = Array.from(container.querySelectorAll('.verse__interlinear-gloss'))
      .map(el => el.textContent?.trim());
    expect(glosses.indexOf('God')).toBeLessThan(glosses.indexOf('loved'));
  });

  it('renders Strongs link and calls onStrongsClick on click', () => {
    const onStrongsClick = vi.fn();
    const { container } = render(
      <VerseRenderer
        verse={makeVerse()}
        {...defaultProps}
        displayMode="study"
        interlinearWords={[makeInterlinearWord()]}
        onStrongsClick={onStrongsClick}
      />,
    );
    fireEvent.click(container.querySelector('.verse__strongs-link')!);
    expect(onStrongsClick).toHaveBeenCalledWith('G2316');
  });

  it('opens the Strongs definition from the original-language word', () => {
    // The Hebrew/Greek word is the most obvious thing to click in an
    // interlinear, so it must not be inert.
    mockInterlinearLayout = 'stacked';
    const onStrongsClick = vi.fn();
    const { container } = render(
      <VerseRenderer
        verse={makeVerse()}
        {...defaultProps}
        displayMode="study"
        interlinearWords={[makeInterlinearWord()]}
        onStrongsClick={onStrongsClick}
      />,
    );
    fireEvent.click(container.querySelector('.verse__interlinear-original--clickable')!);
    expect(onStrongsClick).toHaveBeenCalledWith('G2316');
  });

  it('opens the Strongs definition from the transliteration', () => {
    const onStrongsClick = vi.fn();
    const { container } = render(
      <VerseRenderer
        verse={makeVerse()}
        {...defaultProps}
        displayMode="study"
        interlinearWords={[makeInterlinearWord()]}
        onStrongsClick={onStrongsClick}
      />,
    );
    fireEvent.click(container.querySelector('.verse__interlinear-translit--clickable')!);
    expect(onStrongsClick).toHaveBeenCalledWith('G2316');
  });

  it('falls back to the plain verse when rows carry no positionEnd', () => {
    // The shape of an /api/interlinear response cached before `positionEnd`
    // existed — possible for a day after a deploy, since the endpoint is served
    // with max-age=3600 + stale-while-revalidate=86400. Reading the missing end
    // as a one-word span would put the wrong Greek under most of the verse, and
    // would still partition the word space, so nothing downstream would notice.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetInterlinearWarnings();
    const stale = { ...makeInterlinearWord({ position: 1, gloss: 'God' }) };
    delete (stale as { positionEnd?: number }).positionEnd;

    const { container } = render(
      <VerseRenderer
        verse={makeVerse()}
        {...defaultProps}
        displayMode="study"
        interlinearWords={[stale]}
      />,
    );

    expect(container.querySelector('.verse__body--interlinear')).toBeNull();
    expect(container.querySelector('.verse__body--interlinear-inline')).toBeNull();
    expect(container.querySelector('.verse__body')?.textContent).toBe('For God so loved the world');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('positionEnd'));
    warn.mockRestore();
  });

  it('calls searchStore.performSearch on interlinear gloss click', () => {
    mockInterlinearLayout = 'stacked';
    const { container } = render(
      <VerseRenderer
        verse={makeVerse()}
        {...defaultProps}
        displayMode="study"
        interlinearWords={[makeInterlinearWord()]}
      />,
    );
    fireEvent.click(container.querySelector('.verse__interlinear-gloss--clickable')!);
    expect(mockPerformSearch).toHaveBeenCalledWith('G2316');
    expect(mockSetRightPaneMode).toHaveBeenCalledWith('search');
  });

  // ------------------------------------------------------------------
  // Following along (`isFollowLive` / `followHighlight`)
  // ------------------------------------------------------------------
  describe('following along', () => {
    it('marks the followed verse without changing how it renders', () => {
      const verse = makeVerse({ text_html: 'For God so loved the world' });
      const { container } = render(<VerseRenderer verse={verse} {...defaultProps} isFollowLive />);
      expect(container.querySelector('.verse--follow-live')).toBeTruthy();
      expect(container.innerHTML).toContain('For God so loved the world');
    });

    it('does not mark a verse the presenter is not on', () => {
      const verse = makeVerse();
      const { container } = render(<VerseRenderer verse={verse} {...defaultProps} />);
      expect(container.querySelector('.verse--follow-live')).toBeNull();
    });

    it('renders the presenter\'s highlighted words on the followed verse', () => {
      const verse = makeVerse({ verse_id: 43003016, text_html: 'For God so loved the world' });
      const { container } = render(
        <VerseRenderer
          verse={verse}
          {...defaultProps}
          isFollowLive
          followHighlight={{ verseIdStart: 43003016, textStart: 1, textEnd: 2 }}
        />,
      );
      const words = container.querySelectorAll('.verse__follow-word');
      expect(words.length).toBe(6); // "For God so loved the world"
      expect(words[1].className).toContain('verse__follow-word--hl');
      expect(words[2].className).toContain('verse__follow-word--hl');
      expect(words[0].className).not.toContain('verse__follow-word--hl');
      expect(container.textContent).toContain('For God so loved the world');
    });

    it('falls back to the plain render when there is no highlight, even while followed', () => {
      const verse = makeVerse({ text_html: 'For God so loved the world' });
      const { container } = render(
        <VerseRenderer verse={verse} {...defaultProps} isFollowLive followHighlight={null} />,
      );
      expect(container.querySelector('.verse__follow-word')).toBeNull();
      expect(container.innerHTML).toContain('For God so loved the world');
    });

    it('respects the red-letter setting for the followed verse the same as everywhere else', () => {
      mockWordsOfChristInRed = true;
      const verse = makeVerse({
        verse_id: 43003016,
        text_html: '<span class="christ-words">It is finished</span>',
      });
      const { container } = render(
        <VerseRenderer
          verse={verse}
          {...defaultProps}
          isFollowLive
          followHighlight={{ verseIdStart: 43003016, textStart: 0, textEnd: 0 }}
        />,
      );
      expect(container.querySelector('.verse__follow-word--christ')).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------
  // Present mode: the send rail and the word highlight
  // ------------------------------------------------------------------
  describe('presenting', () => {
    it('draws no send button outside a session', () => {
      const { container } = render(<VerseRenderer verse={makeVerse()} {...defaultProps} />);
      expect(container.querySelector('.verse__send')).toBeNull();
    });

    it('sends the verse from the left-rail button without selecting it', () => {
      const onSend = vi.fn();
      const { container } = render(
        <VerseRenderer verse={makeVerse()} {...defaultProps}
          sendRail={{ sent: false, onSend, label: 'Send verse 16' }} />,
      );
      fireEvent.click(container.querySelector('.verse__send')!);
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(defaultProps.onVerseClick).not.toHaveBeenCalled();
    });

    it('marks the sent verse, and its button no longer sends', () => {
      const onSend = vi.fn();
      const { container } = render(
        <VerseRenderer verse={makeVerse()} {...defaultProps} isHighlighted
          sendRail={{ sent: true, onSend, label: 'Verse 16 is on screen' }} />,
      );
      // Sent and selected at once: both classes present, and the stylesheet
      // makes the sent one win.
      const row = container.querySelector('.verse')!;
      expect(row.className).toContain('verse--sent');
      expect(row.className).toContain('verse--study');
      const button = container.querySelector('.verse__send--sent') as HTMLElement;
      expect(button.getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(button);
      expect(onSend).not.toHaveBeenCalled();
    });

    describe('word highlight', () => {
      beforeEach(() => { vi.useFakeTimers(); });
      afterEach(() => { vi.useRealTimers(); });

      const words = (container: Element) => container.querySelectorAll<HTMLElement>('[data-w]');

      function setup(draft: { verseId: number; start: number; end: number } | null, isHighlighted = true) {
        const onHold = vi.fn();
        const onTap = vi.fn();
        const utils = render(
          <VerseRenderer verse={makeVerse()} {...defaultProps} isHighlighted={isHighlighted}
            wordHighlight={{ draft, sent: false, onHold, onTap }} />,
        );
        return { ...utils, onHold, onTap };
      }

      it('makes words addressable only in the active verse', () => {
        expect(words(setup(null, true).container).length).toBe(6);
      });

      it('leaves other verses exactly as they were', () => {
        const { container } = setup(null, false);
        expect(words(container).length).toBe(0);
        expect(container.innerHTML).toContain('For God so loved the world');
      });

      it('starts a highlight on a press-and-hold, not on a plain tap', () => {
        const { container, onHold } = setup(null);
        const word = words(container)[2];
        fireEvent.pointerDown(word, { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
        fireEvent.pointerUp(word);
        vi.advanceTimersByTime(1000);
        expect(onHold).not.toHaveBeenCalled();

        fireEvent.pointerDown(word, { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(HIGHLIGHT_HOLD_MS + 10);
        expect(onHold).toHaveBeenCalledWith(2);
      });

      it('does not start a highlight when the pointer drifts (a scroll)', () => {
        const { container, onHold } = setup(null);
        const word = words(container)[2];
        fireEvent.pointerDown(word, { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
        fireEvent.pointerMove(word, { clientX: 5, clientY: 60 });
        vi.advanceTimersByTime(1000);
        expect(onHold).not.toHaveBeenCalled();
      });

      it('swallows the click that ends a hold so the verse is not deselected', () => {
        const { container } = setup(null);
        const word = words(container)[2];
        fireEvent.pointerDown(word, { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(HIGHLIGHT_HOLD_MS + 10);
        fireEvent.pointerUp(word);
        fireEvent.click(word);
        expect(defaultProps.onVerseClick).not.toHaveBeenCalled();
      });

      it('lets an ordinary tap select the verse as usual while no highlight exists', () => {
        const { container, onTap } = setup(null);
        fireEvent.click(words(container)[2]);
        expect(defaultProps.onVerseClick).toHaveBeenCalledTimes(1);
        expect(onTap).not.toHaveBeenCalled();
      });

      it('routes a tap to the highlight once one exists, and shows the lit words', () => {
        const { container, onTap } = setup({ verseId: 43003016, start: 1, end: 2 });
        const lit = container.querySelectorAll('.verse__pword--draft');
        expect(lit.length).toBe(2);
        fireEvent.click(words(container)[4]);
        expect(onTap).toHaveBeenCalledWith(4);
        expect(defaultProps.onVerseClick).not.toHaveBeenCalled();
      });
    });
  });
});
