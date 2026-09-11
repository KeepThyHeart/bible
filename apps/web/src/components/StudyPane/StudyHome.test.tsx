/**
 * Component tests for StudyHome (Study pane → Interlinear section).
 *
 * The bug these are mostly about: the section used to print the interlinear
 * rows' own glosses whenever it had no verse text to align against. That is
 * the module's wording in the module's order — "only born" where the KJV reads
 * "only begotten", the same Greek word listed twice, and an English-less row
 * for every article whose gloss is null. The interlinear is supposed to *add*
 * an original-language line under the translation's words, never to restate
 * them.
 *
 * So the fixtures below deliberately give the rows glosses that DIFFER from
 * the verse text: a renderer that reads the glosses fails them visibly.
 *
 * Pattern: studyStore / bibleStore / settingsStore are mocked via `useStore`,
 * which simply invokes the selector.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import type { InterlinearWordData } from '../../types';
import { resetInterlinearWarnings } from '../../utils/interlinearRows';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Store state ---------------------------------------------------------
let mockInterlinearLoading = false;
let mockInterlinearData: {
  words?: Array<Partial<InterlinearWordData>>;
  strongsEntries?: Record<string, { briefMeaning?: string }>;
} | null = null;
let mockFootnotes: Array<{ marker: string; text: string }> = [];
let mockVerseId: number | null = 43003016;
/** Verse text studyStore fetched itself (Bible pane on another chapter). */
let mockFetchedVerseHtml: string | null = null;
let mockVerseHtmlLoading = false;

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

vi.mock('../../stores/studyStore', () => ({
  studyStore: {
    get interlinearData() { return mockInterlinearData; },
    get interlinearLoading() { return mockInterlinearLoading; },
    get footnotes() { return mockFootnotes; },
    get verseId() { return mockVerseId; },
    get verseHtmlLoading() { return mockVerseHtmlLoading; },
    getVerseHtml: () => mockFetchedVerseHtml,
    // See StudyTopics.test.tsx — loading is consumer-driven.
    ensureInterlinear: vi.fn(),
  },
}));

/** Verses the Bible pane's active tab is currently showing. */
let mockActiveTabVerses: Array<{ verse_id: number; text_html?: string }> = [];
vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({ verses: mockActiveTabVerses }),
  },
}));

let mockInterlinearLayout: 'inline' | 'stacked' = 'stacked';
vi.mock('../../stores/settingsStore', () => ({
  settingsStore: {
    get interlinearLayout() { return mockInterlinearLayout; },
    setInterlinearLayout: vi.fn(),
  },
}));

import { StudyHome } from './StudyHome';

/** John 3:16 as the KJV actually reads, tokenised 0..12 by the cell builder. */
const JOHN_3_16 =
  'For God so loved the world, that he gave his only begotten Son';

function row(overrides: Partial<InterlinearWordData>): InterlinearWordData {
  return {
    verseId: 43003016,
    position: 0,
    positionEnd: 0,
    originalWord: '',
    transliteration: '',
    strongsNumber: '',
    morphology: '',
    gloss: '',
    language: 'greek',
    ...overrides,
  };
}

/**
 * Rows shaped like the ones the product owner saw: an article with no gloss at
 * all, and a gloss ("only born") that is not what the translation says.
 */
function johnRows(): InterlinearWordData[] {
  return [
    row({ position: 0, positionEnd: 0, gloss: 'For', originalWord: 'γαρ', strongsNumber: 'G1063' }),
    // No gloss: it claims nothing, so it must not produce an English-less column.
    row({ position: 0, positionEnd: 0, gloss: '', originalWord: 'ὁ', strongsNumber: 'G3588' }),
    row({ position: 1, positionEnd: 1, gloss: 'God', originalWord: 'θεος', strongsNumber: 'G2316' }),
    row({ position: 3, positionEnd: 3, gloss: 'loved', originalWord: 'ηγαπησεν', strongsNumber: 'G25' }),
    // The module says "only born"; the KJV says "only begotten".
    row({ position: 10, positionEnd: 11, gloss: 'only born', originalWord: 'μονογενη', strongsNumber: 'G3439' }),
  ];
}

/** Put the verse in the Bible pane's active tab. */
function openChapterInBiblePane(textHtml = JOHN_3_16): void {
  mockActiveTabVerses = [{ verse_id: 43003016, text_html: textHtml }];
}

describe('StudyHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInterlinearWarnings();
    mockInterlinearLoading = false;
    mockInterlinearData = null;
    mockFootnotes = [];
    mockVerseId = 43003016;
    mockActiveTabVerses = [];
    mockFetchedVerseHtml = null;
    mockVerseHtmlLoading = false;
    mockInterlinearLayout = 'stacked';
  });

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  it('renders loading indicator when interlinearLoading is true', () => {
    mockInterlinearLoading = true;
    const { container } = render(<StudyHome />);
    expect(container.querySelector('.study-home__loading')).toBeTruthy();
    expect(screen.getByText('studyHome.loading')).toBeTruthy();
  });

  it('does not render the study-home container while loading', () => {
    mockInterlinearLoading = true;
    const { container } = render(<StudyHome />);
    expect(container.querySelector('.study-home')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Empty / unavailable state
  // ------------------------------------------------------------------
  it('renders empty message when no interlinear data is available', () => {
    const { container } = render(<StudyHome />);
    expect(container.querySelector('.study-home__empty')).toBeTruthy();
    expect(screen.getByText('studyHome.interlinearUnavailable', { exact: false })).toBeTruthy();
  });

  it('renders empty message when no words match the current verseId', () => {
    openChapterInBiblePane();
    mockInterlinearData = {
      words: [row({ verseId: 1001001, gloss: 'beginning', strongsNumber: 'H7225' })],
      strongsEntries: {},
    };
    const { container } = render(<StudyHome />);
    expect(container.querySelector('.study-home__empty')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // The English is the translation's own — the reported bug
  // ------------------------------------------------------------------
  it("renders the translation's words, not the module's glosses", () => {
    openChapterInBiblePane();
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };

    const { container } = render(<StudyHome />);
    const text = container.textContent ?? '';

    expect(text).toContain('only begotten');
    expect(text).not.toContain('only born');
  });

  it('renders every English word of the verse exactly once, in translation order', () => {
    openChapterInBiblePane();
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };

    const { container } = render(<StudyHome />);
    const rendered = Array.from(container.querySelectorAll('.verse__interlinear-gloss'))
      .map(el => el.textContent?.trim())
      .join(' ');

    expect(rendered).toBe(JOHN_3_16);
  });

  it('does not repeat an original-language word the translation uses once', () => {
    openChapterInBiblePane();
    mockInterlinearData = {
      words: [
        row({ position: 3, positionEnd: 3, gloss: 'loved', originalWord: 'ηγαπησεν', strongsNumber: 'G25' }),
      ],
      strongsEntries: {},
    };
    const { container } = render(<StudyHome />);
    const originals = Array.from(container.querySelectorAll('.verse__interlinear-original'))
      .map(el => el.textContent);
    expect(originals).toEqual(['ηγαπησεν']);
  });

  it('gives a null-gloss article row no English-less column of its own', () => {
    openChapterInBiblePane();
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };

    const { container } = render(<StudyHome />);
    const glosses = Array.from(container.querySelectorAll('.verse__interlinear-gloss'));

    // Every column carries English...
    for (const el of glosses) {
      expect(el.textContent?.trim()).not.toBe('');
    }
    // ...and the article's Strong's number rides along on the word it overlaps.
    const first = container.querySelector('.verse__interlinear-word');
    const chips = Array.from(first!.querySelectorAll('.verse__strongs-link')).map(el => el.textContent);
    expect(chips).toEqual(['G1063', 'G3588']);
  });

  // ------------------------------------------------------------------
  // Verse text the Study pane fetched for itself
  // ------------------------------------------------------------------
  it("uses studyStore's fetched verse text when the Bible pane is on another chapter", () => {
    mockActiveTabVerses = [{ verse_id: 41001001, text_html: 'The beginning of the gospel' }];
    mockFetchedVerseHtml = JOHN_3_16;
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };

    const { container } = render(<StudyHome />);
    const rendered = Array.from(container.querySelectorAll('.verse__interlinear-gloss'))
      .map(el => el.textContent?.trim())
      .join(' ');

    expect(rendered).toBe(JOHN_3_16);
    expect(container.textContent).not.toContain('only born');
  });

  it('shows the loading indicator while the verse text is being fetched', () => {
    mockVerseHtmlLoading = true;
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };

    const { container } = render(<StudyHome />);
    expect(container.querySelector('.study-home__loading')).toBeTruthy();
    expect(container.querySelector('.verse__body--interlinear')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Fail-soft
  // ------------------------------------------------------------------
  it('falls back to the plain verse text when the rows carry no positionEnd', () => {
    // The shape of a cached /api/interlinear response from before positionEnd
    // existed. Reading a missing end as a one-word span would silently put the
    // wrong Greek under most of the verse.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openChapterInBiblePane();
    mockInterlinearData = {
      words: johnRows().map(w => {
        const { positionEnd: _dropped, ...rest } = w;
        return rest as InterlinearWordData;
      }),
      strongsEntries: {},
    };

    const { container } = render(<StudyHome />);

    expect(container.querySelector('.study-home__plain-verse')?.textContent).toBe(JOHN_3_16);
    expect(container.querySelector('.verse__body--interlinear')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('43003016'));
    warn.mockRestore();
  });

  it('does not show the layout toggle when it is showing plain text', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    openChapterInBiblePane();
    mockInterlinearData = {
      words: [row({ position: 0, gloss: 'For', originalWord: 'γαρ', strongsNumber: 'G1063', positionEnd: undefined })],
      strongsEntries: {},
    };
    const { container } = render(<StudyHome />);
    expect(container.querySelector('.study-home__section-controls')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Last resort: no verse text at all
  // ------------------------------------------------------------------
  it('marks the glosses as lexicon information when there is no verse text', () => {
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };

    const { container } = render(<StudyHome />);
    expect(container.querySelector('.study-home__lexicon')).toBeTruthy();
    expect(screen.getByText('studyHome.verseTextUnavailable', { exact: false })).toBeTruthy();

    // The original word leads; the gloss is present but labelled as the
    // lexicon's, never in the slot where the translation's word belongs.
    const gloss = container.querySelector('.study-home__lexicon-gloss');
    expect(gloss?.getAttribute('title')).toBe('studyHome.lexiconGloss');
    expect(container.querySelector('.verse__interlinear-gloss')).toBeNull();
  });

  it('falls back to the Strong\'s brief meaning when a row has no gloss', () => {
    mockInterlinearData = {
      words: [row({ originalWord: 'ὁ', strongsNumber: 'G3588', gloss: '' })],
      strongsEntries: { G3588: { briefMeaning: 'the' } },
    };
    const { container } = render(<StudyHome />);
    expect(container.querySelector('.study-home__lexicon-gloss')?.textContent).toBe('the');
  });

  // ------------------------------------------------------------------
  // Strongs interaction callbacks
  // ------------------------------------------------------------------
  it('calls onStrongsClick with the Strongs number when clicked', () => {
    openChapterInBiblePane();
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };
    const onStrongsClick = vi.fn();
    const { container } = render(<StudyHome onStrongsClick={onStrongsClick} />);
    fireEvent.click(container.querySelector('.verse__strongs-link')!);
    expect(onStrongsClick).toHaveBeenCalledWith('G1063');
  });

  it('calls onStrongsClick from the no-verse-text fallback too', () => {
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };
    const onStrongsClick = vi.fn();
    const { container } = render(<StudyHome onStrongsClick={onStrongsClick} />);
    fireEvent.click(container.querySelector('.verse__strongs-link')!);
    expect(onStrongsClick).toHaveBeenCalledWith('G1063');
  });

  it('does not throw when onStrongsClick is not provided', () => {
    openChapterInBiblePane();
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };
    const { container } = render(<StudyHome />);
    expect(() => fireEvent.click(container.querySelector('.verse__strongs-link')!)).not.toThrow();
  });

  it('calls onStrongsHover on mouseEnter', () => {
    openChapterInBiblePane();
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };
    const onStrongsHover = vi.fn();
    const { container } = render(<StudyHome onStrongsHover={onStrongsHover} />);
    fireEvent.mouseEnter(container.querySelector('.verse__strongs-link')!);
    expect(onStrongsHover).toHaveBeenCalledWith('G1063', expect.any(Object));
  });

  it('calls onStrongsLeave on mouseLeave', () => {
    openChapterInBiblePane();
    mockInterlinearData = { words: johnRows(), strongsEntries: {} };
    const onStrongsLeave = vi.fn();
    const { container } = render(<StudyHome onStrongsLeave={onStrongsLeave} />);
    fireEvent.mouseLeave(container.querySelector('.verse__strongs-link')!);
    expect(onStrongsLeave).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Footnotes rendering
  // ------------------------------------------------------------------
  it('does not render footnotes section when footnotes array is empty', () => {
    const { container } = render(<StudyHome />);
    expect(container.querySelector('.study-home__footnotes')).toBeNull();
  });

  it('renders footnotes when footnotes are present', () => {
    mockFootnotes = [
      { marker: 'a', text: 'Some ancient manuscripts say...' },
      { marker: 'b', text: 'Or: alternatively rendered as...' },
    ];
    const { container } = render(<StudyHome />);
    const footnoteEls = container.querySelectorAll('.study-home__footnote');
    expect(footnoteEls.length).toBe(2);
  });

  it('renders footnote marker and text', () => {
    mockFootnotes = [{ marker: 'a', text: 'Some ancient manuscripts say...' }];
    const { container } = render(<StudyHome />);
    const marker = container.querySelector('.study-home__footnote-marker');
    const text = container.querySelector('.study-home__footnote-text');
    expect(marker?.textContent).toBe('[a]');
    expect(text?.textContent).toBe('Some ancient manuscripts say...');
  });

  it('renders footnotes header when footnotes are present', () => {
    mockFootnotes = [{ marker: 'a', text: 'Note text' }];
    render(<StudyHome />);
    expect(screen.getByText('studyHome.footnotes')).toBeTruthy();
  });
});
