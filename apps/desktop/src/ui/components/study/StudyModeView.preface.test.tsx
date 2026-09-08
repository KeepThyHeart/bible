/**
 * Study mode's verse-0 (chapter preface) and section-heading handling.
 *
 * Mirrors the same real-world data shape as Standard/Reading mode:
 * verse.verse === 0 is a legacy literal preface verse (no verse-number
 * affordance, italic/secondary styling); verse.formatting.sectionHeading is
 * Module Format v2's carrier for Psalm superscriptions, attached to the verse
 * that follows rather than stored as its own verse.
 */
import { createRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('dockview-react', () => ({}));

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn(),
    getBookName: vi.fn().mockResolvedValue('Psalms'),
    getChapter: vi.fn().mockResolvedValue([]),
    getVerse: vi.fn().mockResolvedValue(null),
    getInterlinearWordsForChapter: vi.fn().mockResolvedValue({}),
    getVerseTexts: vi.fn().mockResolvedValue({}),
    hasInterlinearData: vi.fn().mockResolvedValue(false),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../stores/helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));

vi.mock('./StudyControls', () => ({ default: () => <div data-testid="study-controls" /> }));
vi.mock('./FootnoteDisplay', () => ({ default: () => <div data-testid="footnotes" /> }));
vi.mock('./CrossReferenceDisplay', () => ({ default: () => <div data-testid="cross-refs" /> }));
vi.mock('./InterlinearDisplay', () => ({ default: () => <div data-testid="interlinear" /> }));
vi.mock('./VerseLinksDisplay', () => ({ default: () => <div data-testid="verse-links" /> }));

// Study mode now withholds the verses until the chapter's study data lands
// (one paint, fully adorned - see useChapterStudyData). None of that data is
// under test here, so resolve it synchronously rather than making every
// assertion await a microtask.
vi.mock('./useChapterStudyData', () => ({
  useChapterStudyData: () => ({
    crossRefsByVerse: new Map(),
    linksByVerse: new Map(),
    resolved: true,
  }),
}));


import StudyModeView from './StudyModeView';
import { useBibleStore } from '../../stores/useBibleStore';

const PANEL = 'bible_default';
const TAB = 'KJV-tab';

function seedPanel(): void {
  useBibleStore.setState({ panels: new Map(), availableBibles: [], interlinearByModule: new Map() });
  useBibleStore.getState().initPanel(PANEL);
  useBibleStore.setState({
    panels: new Map(useBibleStore.getState().panels).set(PANEL, {
      ...useBibleStore.getState().getPanelState(PANEL),
      openTabs: [{
        tabId: TAB,
        abbreviation: 'KJV',
        name: 'King James Version',
        displayMode: 'study',
        book: 19,
        chapter: 3,
        bookName: 'Psalms',
        selectedVerseId: 19003001,
        history: [],
        historyIndex: 0,
      }],
      activeTabIndex: 0,
    }),
  });
}

describe('StudyModeView verse-0 / section-heading handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedPanel();
  });

  it('renders a normal verse with its number', () => {
    render(
      <StudyModeView
        verses={[{
          verse_id: 19003001,
          book_number: 19,
          chapter: 3,
          verse: 1,
          text: 'Lord, how are they increased that trouble me!',
        }]}
        panelId={PANEL}
        tabId={TAB}
        moduleId={1}
        currentBookNumber={19}
        currentBookName="Psalms"
        currentChapter={3}
        selectedVerseId={null}
        onVerseClick={vi.fn()}
        selectedVerseRef={createRef<HTMLDivElement>()}
        scrollTrigger={0}
        scrollMode="nearest"
      />,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('top-aligns the verse number against a multi-line verse', () => {
    render(
      <StudyModeView
        verses={[{
          verse_id: 19003001,
          book_number: 19,
          chapter: 3,
          verse: 1,
          text: 'Lord, how are they increased that trouble me!',
        }]}
        panelId={PANEL}
        tabId={TAB}
        moduleId={1}
        currentBookNumber={19}
        currentBookName="Psalms"
        currentChapter={3}
        selectedVerseId={null}
        onVerseClick={vi.fn()}
        selectedVerseRef={createRef<HTMLDivElement>()}
        scrollTrigger={0}
        scrollMode="nearest"
      />,
    );

    // jsdom cannot measure layout, so pin the class: without it the flex
    // default `stretch` centers the number in a tall row.
    const row = screen.getByText('1').parentElement!;
    expect(row.className).toContain('items-start');
  });

  it('verse 0 (chapter preface) renders with no verse-number and preface styling', () => {
    render(
      <StudyModeView
        verses={[{
          verse_id: 19003000,
          book_number: 19,
          chapter: 3,
          verse: 0,
          text: 'A Psalm of David.',
        }]}
        panelId={PANEL}
        tabId={TAB}
        moduleId={1}
        currentBookNumber={19}
        currentBookName="Psalms"
        currentChapter={3}
        selectedVerseId={null}
        onVerseClick={vi.fn()}
        selectedVerseRef={createRef<HTMLDivElement>()}
        scrollTrigger={0}
        scrollMode="nearest"
      />,
    );

    expect(screen.queryByText('0')).not.toBeInTheDocument();
    // Verse text now renders through HighlightedVerse, which wraps each word in
    // its own `.word` span so drag-select can map a DOM Selection onto word
    // indices. That splits the text across elements, so match on the container's
    // textContent rather than expecting a single text node.
    const textEl = screen
      .getByTestId('verse-0')
      .querySelector<HTMLElement>('.verse-content');
    expect(textEl?.textContent).toBe('A Psalm of David.');
    // Walk up to the flex-1 wrapper that carries the preface styling.
    const wrapper = textEl?.closest('.italic');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain('text-text-secondary');
  });

  it('renders formatting.sectionHeading as a heading block above the verse', () => {
    render(
      <StudyModeView
        verses={[{
          verse_id: 19003001,
          book_number: 19,
          chapter: 3,
          verse: 1,
          text: 'Lord, how are they increased that trouble me!',
          formatting: { sectionHeading: 'A Psalm of David, when he fled from Absalom his son.' },
        }]}
        panelId={PANEL}
        tabId={TAB}
        moduleId={1}
        currentBookNumber={19}
        currentBookName="Psalms"
        currentChapter={3}
        selectedVerseId={null}
        onVerseClick={vi.fn()}
        selectedVerseRef={createRef<HTMLDivElement>()}
        scrollTrigger={0}
        scrollMode="nearest"
      />,
    );

    expect(screen.getByText('A Psalm of David, when he fled from Absalom his son.')).toBeInTheDocument();
    // Still a real, numbered verse - the heading rides on it rather than replacing it.
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
