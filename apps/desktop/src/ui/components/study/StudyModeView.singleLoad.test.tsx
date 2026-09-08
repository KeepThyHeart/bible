/**
 * Study mode paints ONCE, fully adorned.
 *
 * What it did before: the verses appeared, then every row instantly grew a
 * `VerseLinksDisplay` "Loading..." block (a `mt-3 pt-3 border-t` div - a rule and
 * ~2rem under EVERY verse), then each verse resolved at its own moment and
 * either collapsed to nothing or expanded to several wrapped rows, then the
 * reverse-reference lookup landed and added a "Cited in:" row, then the
 * chapter-wide cross-reference effect inserted a row ABOVE all of that and
 * pushed everything down again. Four reflows per navigation, none of them
 * synchronised.
 *
 * And the interlinear gate made it worse rather than better: it replaced the
 * verses with a skeleton, so every `VerseLinksDisplay` unmounted and remounted
 * and re-ran its ~90 IPC calls. Toggling Interlinear doubled the traffic.
 *
 * These tests render StudyModeView with its REAL chapter loader against a
 * counting IPC stub, so both properties are pinned: nothing paints until
 * everything has landed, and toggling Interlinear costs nothing.
 */
import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import StudyModeView from './StudyModeView';
import { DEFAULT_STUDY_OPTIONS } from '../../stores/useBibleStore';
import { bibleAPI } from '../../services/electronAPI';
import { studyOverviewProvider } from '../../services/studyOverviewProvider';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));
vi.mock('./StudyControls', () => ({ default: () => <div data-testid="study-controls" /> }));
vi.mock('./InterlinearDisplay', () => ({ default: () => <div data-testid="interlinear-display" /> }));
vi.mock('../VersePreviewTooltip', () => ({ default: () => null }));
// Imported at module scope by VerseLinksDisplay for its commentary navigation;
// nothing here clicks a commentary chip.
vi.mock('../../stores/useCommentaryStore', () => ({ useCommentaryStore: { getState: () => ({}) } }));
vi.mock('../../stores/useLayoutStore', () => ({ useLayoutStore: { getState: () => ({}) } }));

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getInterlinearWordsForChapter: vi.fn().mockResolvedValue({}),
    getVerseTexts: vi.fn().mockResolvedValue({}),
  },
}));

const mockUseBiblePanel = vi.fn();
vi.mock('../../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: (...args: unknown[]) => mockUseBiblePanel(...args),
}));

/** John 3:14-18. */
const VERSES = [14, 15, 16, 17, 18].map(verse => ({
  verse_id: 43003000 + verse,
  book_number: 43,
  chapter: 3,
  verse,
  text: `Verse ${verse} text`,
  text_html: `Verse ${verse} text`,
}));

function ok<T>(value: T) {
  return Promise.resolve({ ok: true as const, value });
}

let ipcCalls: string[];
/** Held-open promises, so a test can decide when a source lands. */
let releaseVerseLinks: ((value: unknown) => void) | null;

function installElectron(options: { holdVerseLinks?: boolean } = {}): void {
  Object.assign(window.electron, {
    crossReference: {
      getAvailable: () => {
        ipcCalls.push('xref:getAvailable');
        return ok([{ abbreviation: 'TSKxref', name: 'Treasury of Scripture Knowledge' }]);
      },
      getGroupsForRange: () => {
        ipcCalls.push('xref:getGroupsForRange');
        return ok([
          {
            group: { group_id: 1, verse_id: 43003016, verse_id_end: 43003016, phrase: 'loved.', sort_order: 0 },
            entries: [{ entry_id: 1, target_verse_id: 45005008, target_verse_end_id: null }],
          },
        ]);
      },
      getReverseReferencesForRange: () => {
        ipcCalls.push('xref:getReverseReferencesForRange');
        return ok([
          { source_verse_id: 19023001, target_verse_id_start: 43003016, target_verse_id_end: 43003016 },
        ]);
      },
    },
    study: {
      getOverview: () => {
        ipcCalls.push('study:getOverview');
        return ok({ available: false, commentary: [], topics: {}, crossrefs: {}, entities: {} });
      },
      getBatchVerseLinks: (verseIds: number[]) => {
        ipcCalls.push('study:getBatchVerseLinks');
        const value: Record<number, unknown> = {};
        for (const id of verseIds) {
          value[id] = {
            verseId: id,
            commentaries: { direct: [], mentions: [] },
            crossReferences: { modules: [] },
            books: [],
            userContent: { notes: [], journals: [] },
            userRefCount: 0,
          };
        }
        if (options.holdVerseLinks) {
          return new Promise(resolve => {
            releaseVerseLinks = () => resolve({ ok: true, value });
          });
        }
        return ok(value);
      },
    },
  });
}

function setPanelHookState(overrides: { showInterlinear?: boolean } = {}) {
  const options = { ...DEFAULT_STUDY_OPTIONS, showCrossReferences: true, ...overrides };
  mockUseBiblePanel.mockReturnValue({
    getStudyOptions: () => options,
    setStudyOptions: vi.fn(),
    openTabs: [{ tabId: 'tab-1', abbreviation: 'KJV' }],
    activeTabIndex: 0,
    interlinearByModule: new Map([['KJV', true]]),
    studyOptionsByTab: new Map([['tab-1', options]]),
    navigateToVerse: vi.fn(),
  });
}

const Harness: React.FC = () => {
  const selectedVerseRef = useRef<HTMLDivElement>(null);
  return (
    <StudyModeView
      verses={VERSES}
      panelId="panel-1"
      tabId="tab-1"
      moduleId={1}
      currentBookNumber={43}
      currentBookName="John"
      currentChapter={3}
      selectedVerseId={null}
      onVerseClick={vi.fn()}
      selectedVerseRef={selectedVerseRef}
      scrollTrigger={0}
      scrollMode="nearest"
    />
  );
};

describe('Study mode paints once, fully adorned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcCalls = [];
    releaseVerseLinks = null;
    studyOverviewProvider.reset();
    setPanelHookState({ showInterlinear: false });
  });

  it('withholds the verses until every source has landed', async () => {
    installElectron({ holdVerseLinks: true });
    render(<Harness />);

    // Cross-references have resolved but verse links have not. Painting here
    // is exactly the bug: the reader would get bare verses that then grow.
    await vi.waitFor(() => expect(ipcCalls).toContain('xref:getGroupsForRange'));
    expect(screen.queryByTestId('verse-16')).toBeNull();

    await act(async () => {
      releaseVerseLinks?.(null);
    });
    expect(await screen.findByTestId('verse-16')).toBeInTheDocument();
  });

  it('paints the adornments in the same frame as the verse text', async () => {
    installElectron();
    render(<Harness />);

    const verse = await screen.findByTestId('verse-16');
    // The cross-reference row is present the first time the verse exists -
    // it does not arrive afterwards and push the next verse down.
    expect(verse.querySelector('[data-testid="verse-cross-references"]')).not.toBeNull();
    expect(verse.textContent).toContain('loved.');
    expect(verse.textContent).toContain('Rom 5:8');
    // There is no separate "Cited in" row: a row under that label would
    // promise commentary and book citations while actually showing
    // reverse-TSK data, which it cannot deliver.
    expect(verse.querySelector('[data-testid="verse-links-cited-in"]')).toBeNull();
    // ...and TSK appears exactly ONCE under the verse, not as a row here and a
    // chip in the verse-links block as well.
    expect(verse.querySelectorAll('[data-testid^="cross-reference-row-"]')).toHaveLength(1);
    expect(verse.textContent).not.toContain('TSKxref');
  });

  it('never renders a per-verse loading block', async () => {
    installElectron();
    const { container } = render(<Harness />);
    await screen.findByTestId('verse-16');

    expect(container.textContent).not.toContain('verseLinksDisplay.loading');
    // A verse with no links renders nothing at all, not an empty bordered box.
    const verse14 = screen.getByTestId('verse-14');
    expect(verse14.querySelector('[data-testid="verse-links-commentaries"]')).toBeNull();
  });

  it('does not re-fetch anything when Interlinear is toggled', async () => {
    installElectron();
    const { rerender } = render(<Harness />);
    await screen.findByTestId('verse-16');

    const afterFirstLoad = [...ipcCalls];
    expect(afterFirstLoad).toHaveLength(4);
    expect(afterFirstLoad).not.toContain('xref:getReverseReferencesForRange');

    // Turn Interlinear on. This unmounts the verse list while the interlinear
    // fetch is in flight. The chapter load lives above that subtree, so
    // unmounting it must not re-run every per-verse fetch inside it.
    setPanelHookState({ showInterlinear: true });
    await act(async () => {
      rerender(<Harness />);
    });
    await screen.findByTestId('verse-16');

    expect(ipcCalls).toEqual(afterFirstLoad);
    // The interlinear fetch itself is unaffected: still one call per chapter.
    expect(bibleAPI.getInterlinearWordsForChapter).toHaveBeenCalledTimes(1);
  });
});
