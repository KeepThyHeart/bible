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
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { VerseRenderer } from './VerseRenderer';
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
});
