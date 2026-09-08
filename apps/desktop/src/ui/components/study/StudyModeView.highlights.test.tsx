/**
 * Highlighting in Study display mode.
 *
 * Study mode rendered verse text as raw `dangerouslySetInnerHTML` on a bare
 * <p> and was the one display mode not wrapped in <HighlightSelector>. The
 * whole highlight feature keys off `.word[data-word-index]` spans inside a
 * `[data-verse-id]` element, so in Study mode there were zero word spans:
 * drag-select found nothing and produced no floating toolbar, and existing
 * highlights never painted. Reading and Standard mode were unaffected, which
 * is why this survived several rounds of review - the existing e2e spec
 * guards nearly every assertion behind `if (count > 0)`, and the component
 * test hardcoded `displayMode: 'standard'`.
 *
 * The interlinear view inside Study mode was a second, narrower instance of
 * the same bug: it replaced the verse text with a per-word stack that emitted
 * no `.word` spans either. Since `showInterlinear` defaults to true for a tab
 * created in Study mode, that was the *default* Study experience. Both paths
 * now render every English word as an addressable span over the same 0-based
 * index space (see `interlinearCells.ts`).
 *
 * These tests assert on the DOM contract the highlight machinery actually
 * depends on, rather than on StudyModeView's internals.
 */
import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StudyModeView from './StudyModeView';
import { DEFAULT_STUDY_OPTIONS } from '../../stores/useBibleStore';
import { useHighlightStore } from '../../stores/useHighlightStore';
import { bibleAPI } from '../../services/electronAPI';
import { UserTextMarkup } from '@bible/core';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));

vi.mock('./StudyControls', () => ({ default: () => <div data-testid="study-controls" /> }));
vi.mock('./FootnoteDisplay', () => ({ default: () => null }));
vi.mock('./CrossReferenceDisplay', () => ({ default: () => null }));
vi.mock('./VerseLinksDisplay', () => ({ default: () => null }));

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

// InterlinearDisplay is deliberately NOT mocked: the point of the interlinear
// block below is that the real component emits the same `.word` contract.

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getInterlinearWordsForChapter: vi.fn().mockResolvedValue({}),
    getVerseTexts: vi.fn().mockResolvedValue({}),
  },
  dictionaryAPI: {
    getEntryByKey: vi.fn().mockResolvedValue(null),
  },
}));

const mockUseBiblePanel = vi.fn();
vi.mock('../../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: (...args: unknown[]) => mockUseBiblePanel(...args),
}));

const MODULE_ID = 7;
const VERSE_ID = 19003001;

const VERSES = [
  {
    verse_id: VERSE_ID,
    book_number: 19,
    chapter: 3,
    verse: 1,
    text: 'Lord how are they increased',
    text_html: 'Lord how are they increased',
    is_paragraph_start: true,
  },
];

function setPanelHookState(showInterlinear: boolean) {
  mockUseBiblePanel.mockReturnValue({
    getStudyOptions: () => ({ ...DEFAULT_STUDY_OPTIONS, showInterlinear }),
    setStudyOptions: vi.fn(),
    openTabs: [{ tabId: 'tab-1', abbreviation: 'KJV' }],
    activeTabIndex: 0,
    interlinearByModule: new Map([['KJV', showInterlinear]]),
    studyOptionsByTab: new Map([['tab-1', { ...DEFAULT_STUDY_OPTIONS, showInterlinear }]]),
  });
}

function Harness(props: { onVerseContextMenu?: (e: React.MouseEvent, v: unknown) => void }) {
  const selectedVerseRef = useRef<HTMLDivElement>(null);
  return (
    <StudyModeView
      verses={VERSES}
      panelId="panel-1"
      tabId="tab-1"
      moduleId={MODULE_ID}
      currentBookNumber={19}
      currentBookName="Psalms"
      currentChapter={3}
      selectedVerseId={null}
      onVerseClick={vi.fn()}
      onVerseContextMenu={props.onVerseContextMenu}
      selectedVerseRef={selectedVerseRef}
      scrollTrigger={0}
      scrollMode="nearest"
    />
  );
}

describe('StudyModeView highlight wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHighlightStore.setState({ highlightsByModule: new Map() });
  });

  describe('with interlinear off (the highlightable path)', () => {
    beforeEach(() => setPanelHookState(false));

    it('renders per-word spans that drag-select can map a DOM Selection onto', () => {
      const { container } = render(<Harness />);
      // The exact contract buildSelectionFromDOM depends on: .word elements
      // carrying a data-word-index, inside an element carrying data-verse-id.
      const words = container.querySelectorAll('.word[data-word-index]');
      expect(words.length).toBe(VERSES[0].text.split(' ').length);
      expect(container.querySelector(`[data-verse-id="${VERSE_ID}"]`)).not.toBeNull();
    });

    it('paints an existing highlight stored for this module', () => {
      useHighlightStore.setState({
        highlightsByModule: new Map([[
          MODULE_ID,
          [new UserTextMarkup({
            markupId: 1,
            moduleId: MODULE_ID,
            verseIdStart: VERSE_ID,
            textStart: 0,
            textEnd: 1,
            color: '#FFF3A3',
            metadata: { markupType: 'highlight', version: 1 },
          })],
        ]]),
      });

      const { container } = render(<Harness />);
      const highlighted = container.querySelectorAll('.word.highlighted');
      expect(highlighted.length).toBeGreaterThan(0);
      // Colour resolves to a palette *name* class, not a raw hex - a raw-hex
      // class would match no CSS rule and paint nothing while still passing a
      // naive "has a class" assertion.
      expect(container.querySelector('[class*="highlight-"]')).not.toBeNull();
    });

    it('forwards right-click on a verse row to the shared context-menu handler', () => {
      const onVerseContextMenu = vi.fn();
      render(<Harness onVerseContextMenu={onVerseContextMenu} />);
      fireEvent.contextMenu(screen.getByTestId('verse-1'));
      expect(onVerseContextMenu).toHaveBeenCalledTimes(1);
      expect(onVerseContextMenu.mock.calls[0][1]).toMatchObject({ verse_id: VERSE_ID });
    });
  });

  // `showInterlinear` defaults to true for a tab created in Study mode, so this
  // is the *default* Study experience. A per-word stack with no `.word` spans
  // at all would make highlighting, underlining and find-in-page completely
  // inert here. It must emit the same contract as the plain path, over the
  // same English word indices.
  describe('with interlinear on', () => {
    beforeEach(() => {
      setPanelHookState(true);
      vi.mocked(bibleAPI.getInterlinearWordsForChapter).mockResolvedValue({
        [VERSE_ID]: [
          // Covers indices 0..1 only; 2..4 are left unclaimed on purpose.
          { wordPositionStart: 0, wordPositionEnd: 1, originalWord: 'יהוה', strongsNumber: 'H3068', gloss: 'Lord how' },
        ],
      } as never);
    });

    async function renderInterlinear(props?: { onVerseContextMenu?: (e: React.MouseEvent, v: unknown) => void }) {
      const result = render(<Harness {...props} />);
      // Prove we are on the interlinear path and not silently falling back to
      // the plain renderer, which would make everything below vacuous.
      await screen.findByTestId('interlinear-container');
      expect(screen.getAllByTestId('strongs-number').length).toBeGreaterThan(0);
      return result;
    }

    it('emits one addressable word span per English word, indices 0..N-1', async () => {
      const { container } = await renderInterlinear();
      const indices = Array.from(container.querySelectorAll('.word[data-word-index]')).map(el =>
        Number(el.getAttribute('data-word-index'))
      );
      // Exact, not `> 0`: five English words, every index present once, in
      // order - which also proves the words no interlinear row claims (2..4)
      // are still rendered rather than dropped.
      expect(indices).toEqual([0, 1, 2, 3, 4]);
      expect(container.querySelector(`[data-verse-id="${VERSE_ID}"]`)).not.toBeNull();
    });

    it('paints a stored highlight on exactly the covered words', async () => {
      useHighlightStore.setState({
        highlightsByModule: new Map([[
          MODULE_ID,
          [new UserTextMarkup({
            markupId: 1,
            moduleId: MODULE_ID,
            verseIdStart: VERSE_ID,
            textStart: 0,
            textEnd: 1,
            color: '#FFF3A3',
            metadata: { markupType: 'highlight', version: 1 },
          })],
        ]]),
      });

      const { container } = await renderInterlinear();
      const highlighted = Array.from(container.querySelectorAll('.word.highlighted')).map(el =>
        Number(el.getAttribute('data-word-index'))
      );
      expect(highlighted).toEqual([0, 1]);
      expect(container.querySelector('.word[data-word-index="0"]')?.className).toContain('highlight-yellow');
      expect(container.querySelector('.word[data-word-index="2"]')?.className).not.toContain('highlighted');
    });

    it('paints a stored underline on exactly the covered words', async () => {
      useHighlightStore.setState({
        highlightsByModule: new Map([[
          MODULE_ID,
          [new UserTextMarkup({
            markupId: 2,
            moduleId: MODULE_ID,
            verseIdStart: VERSE_ID,
            textStart: 3,
            textEnd: 4,
            color: '#FFF3A3',
            metadata: {
              markupType: 'underline',
              underlineStyle: 'solid',
              underlineColor: 'yellow',
              version: 1,
            },
          })],
        ]]),
      });

      const { container } = await renderInterlinear();
      const underlined = Array.from(container.querySelectorAll('.word.underline-solid')).map(el =>
        Number(el.getAttribute('data-word-index'))
      );
      expect(underlined).toEqual([3, 4]);
      expect(container.querySelector('.word[data-word-index="3"]')?.className).toContain('underline-color-yellow');
      expect(container.querySelector('.word[data-word-index="0"]')?.className).not.toContain('underline');
    });

    it('forwards right-click on a verse row to the shared context-menu handler', async () => {
      const onVerseContextMenu = vi.fn();
      await renderInterlinear({ onVerseContextMenu });
      fireEvent.contextMenu(screen.getByTestId('verse-1'));
      expect(onVerseContextMenu).toHaveBeenCalledTimes(1);
      expect(onVerseContextMenu.mock.calls[0][1]).toMatchObject({ verse_id: VERSE_ID });
    });
  });
});
