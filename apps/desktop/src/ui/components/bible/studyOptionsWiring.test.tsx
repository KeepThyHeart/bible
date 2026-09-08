/**
 * The chapter-top Interlinear and Footnotes checkboxes write per-panel,
 * per-passage study options; Study mode is what reads them.
 *
 * `StudyModeView` must call `useBiblePanel()` with the real dockview panel id.
 * Calling it with no argument defaults to `DEFAULT_PANEL_ID` - a panel that
 * only exists in detached windows - so it would look up the options of a
 * panel nobody had written to, always get the defaults back, and both
 * toggles would appear to do nothing. These tests pin the wiring from a real
 * dockview panel id through the store to the view.
 */
import { createRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('dockview-react', () => ({}));

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn(),
    getBookName: vi.fn().mockResolvedValue('John'),
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

// Study-mode children stand in for the real ones: what matters here is only
// *whether* each section is rendered, which is the option under test.
vi.mock('../study/StudyControls', () => ({ default: () => <div data-testid="study-controls" /> }));
vi.mock('../study/FootnoteDisplay', () => ({ default: () => <div data-testid="footnotes" /> }));
vi.mock('../study/CrossReferenceDisplay', () => ({ default: () => <div data-testid="cross-refs" /> }));
vi.mock('../study/InterlinearDisplay', () => ({ default: () => <div data-testid="interlinear" /> }));
// Echoes the one prop under test here, so the "Show Commentary Links"
// checkbox can be followed from the store all the way to the row it governs.
vi.mock('../study/VerseLinksDisplay', () => ({
  default: ({ showCommentaryLinks }: { showCommentaryLinks?: boolean }) => (
    <div data-testid="verse-links" data-commentary-links={String(showCommentaryLinks)} />
  ),
}));

// Study mode now withholds the verses until the chapter's study data lands
// (one paint, fully adorned - see useChapterStudyData). None of that data is
// under test here, so resolve it synchronously rather than making every
// assertion await a microtask.
vi.mock('../study/useChapterStudyData', () => ({
  useChapterStudyData: () => ({
    crossRefsByVerse: new Map(),
    linksByVerse: new Map(),
    resolved: true,
  }),
}));


import StudyModeView from '../study/StudyModeView';
import { useBibleStore } from '../../stores/useBibleStore';

const PANEL = 'bible_default';
const TAB = 'KJV-tab';

const VERSES = [{
  verse_id: 43003016,
  book_number: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world',
}];

function seedPanel(): void {
  useBibleStore.setState({ panels: new Map(), availableBibles: [], interlinearByModule: new Map() });
  useBibleStore.getState().initPanel(PANEL);  // allow-getstate: test setup/assertion
  useBibleStore.setState({
    panels: new Map(useBibleStore.getState().panels).set(PANEL, {  // allow-getstate: test setup/assertion
      ...useBibleStore.getState().getPanelState(PANEL),
      openTabs: [{
        tabId: TAB,
        abbreviation: 'KJV',
        name: 'King James Version',
        displayMode: 'study',
        book: 43,
        chapter: 3,
        bookName: 'John',
        selectedVerseId: 43003016,
        history: [],
        historyIndex: 0,
      }],
      activeTabIndex: 0,
    }),
  });
}

function renderStudyView() {
  return render(
    <StudyModeView
      verses={VERSES}
      panelId={PANEL}
      tabId={TAB}
      moduleId={1}
      currentBookNumber={43}
      currentBookName="John"
      currentChapter={3}
      selectedVerseId={43003016}
      onVerseClick={vi.fn()}
      selectedVerseRef={createRef<HTMLDivElement>()}
      scrollTrigger={0}
      scrollMode="nearest"
    />,
  );
}

describe('Study mode reads the toggles written for its own panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedPanel();
  });

  it('shows footnotes by default', () => {
    renderStudyView();
    expect(screen.getByTestId('footnotes')).toBeInTheDocument();
  });

  it('hides footnotes once the Footnotes checkbox is switched off for this panel', () => {
    useBibleStore.getState().setStudyOptions(PANEL, TAB, { showFootnotes: false });  // allow-getstate: test setup/assertion

    renderStudyView();

    expect(screen.queryByTestId('footnotes')).not.toBeInTheDocument();
  });

  it('turns footnotes back on when the checkbox is switched on again', () => {
    useBibleStore.getState().setStudyOptions(PANEL, TAB, { showFootnotes: false });  // allow-getstate: test setup/assertion
    useBibleStore.getState().setStudyOptions(PANEL, TAB, { showFootnotes: true });

    renderStudyView();

    expect(screen.getByTestId('footnotes')).toBeInTheDocument();
  });

  it('scopes the Interlinear checkbox to the panel it was set on', () => {
    useBibleStore.getState().setStudyOptions(PANEL, TAB, { showInterlinear: true });  // allow-getstate: test setup/assertion

    // The interlinear line itself also needs word data from the module, which
    // this module does not have - the option is what is under test.
    expect(useBibleStore.getState().getStudyOptions(PANEL, TAB).showInterlinear).toBe(true);  // allow-getstate: test setup/assertion
    expect(useBibleStore.getState().getStudyOptions('_default', TAB).showInterlinear).toBe(false);
  });

  it('shows the commentary-links row by default', () => {
    renderStudyView();
    expect(screen.getByTestId('verse-links')).toHaveAttribute('data-commentary-links', 'true');
  });

  it('hides the commentary-links row once the checkbox is switched off', () => {
    useBibleStore.getState().setStudyOptions(PANEL, TAB, { showCommentaryLinks: false });  // allow-getstate: test setup/assertion

    renderStudyView();

    expect(screen.getByTestId('verse-links')).toHaveAttribute('data-commentary-links', 'false');
  });

  // The session persists `tab.showInterlinear` / `tab.showNotes` /
  // `tab.showCommentaryLinks`, not the options map, so a checkbox change that
  // stopped at the map was forgotten on restart. This is the regression that
  // guards the write-through.
  it('writes the checkboxes through to the passage record the session saves', () => {
    useBibleStore.getState().setStudyOptions(PANEL, TAB, {  // allow-getstate: test setup/assertion
      showInterlinear: true,
      showFootnotes: false,
      showCommentaryLinks: false,
    });

    const tab = useBibleStore.getState().getPanelState(PANEL).openTabs.find(t => t.tabId === TAB);  // allow-getstate: test setup/assertion
    expect(tab?.showInterlinear).toBe(true);
    expect(tab?.showNotes).toBe(false);
    expect(tab?.showCommentaryLinks).toBe(false);
  });
});
