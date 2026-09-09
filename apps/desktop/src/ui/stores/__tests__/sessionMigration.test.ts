/**
 * Gating tests for Bible pane session migration.
 *
 * A v1 session describes a passage as a sub-tab inside one Bible panel;
 * migration turns it into a top-level dockview panel. Session restore is the
 * highest-consequence part of that: a user must not lose open passages, and no
 * shape of saved data may blank the window. These tests pin all three rules the
 * migration is written to - never lose a passage, never crash, stay idempotent.
 */
import { describe, it, expect } from 'vitest';
import {
  biblePanelIdsFromLayout,
  migrateBibleSession,
  FALLBACK_PRIMARY_BIBLE_PANEL_ID,
} from '../bible/sessionMigration';
import { BIBLE_SESSION_VERSION } from '../bible/types';

/** A passage as a v1 session wrote it. */
function v1Tab(over: Record<string, unknown> = {}) {
  return {
    tabId: 'kjv-1',
    abbreviation: 'KJV',
    name: 'King James Version',
    displayMode: 'reading',
    moduleId: 1,
    book: 43,
    chapter: 3,
    bookName: 'John',
    selectedVerseId: 43003016,
    history: [{ verseId: 43003016, bookNumber: 43, chapter: 3, bookName: 'John' }],
    historyIndex: 0,
    showInterlinear: true,
    showNotes: true,
    ...over,
  };
}

describe('migrateBibleSession — v1 (sub-tabs) to v2 (panels)', () => {
  it('expands every sub-tab into its own panel', () => {
    const raw = {
      openTabs: [
        v1Tab({ tabId: 'kjv-1' }),
        v1Tab({ tabId: 'esv-1', abbreviation: 'ESV', book: 45, chapter: 8, bookName: 'Romans' }),
        v1Tab({ tabId: 'kjv-2', book: 1, chapter: 1, bookName: 'Genesis' }),
      ],
      activeTabIndex: 0,
      currentBook: 43,
      currentChapter: 3,
      selectedVerseId: 43003016,
    };

    const result = migrateBibleSession(raw, ['bible_default']);

    expect(Object.keys(result.panels)).toHaveLength(3);
    expect(result.report.sourceVersion).toBe(1);
    expect(result.report.legacyTabsExpanded).toBe(2);
    expect(result.report.fellBackToDefaults).toBe(false);
    // The two non-active passages are panels the layout still has to create.
    expect(result.pending).toHaveLength(2);
    expect(result.pending.map(p => p.title)).toEqual(['Romans 8', 'Genesis 1']);
    expect(result.pending.map(p => p.subtitle)).toEqual(['ESV', 'KJV']);
  });

  it('gives the primary panel the passage that was in front', () => {
    const raw = {
      openTabs: [
        v1Tab({ tabId: 'kjv-1' }),
        v1Tab({ tabId: 'esv-1', abbreviation: 'ESV', book: 45, chapter: 8, bookName: 'Romans' }),
      ],
      activeTabIndex: 1,
    };

    const result = migrateBibleSession(raw, ['bible_default']);

    expect(result.panels['bible_default'].tab.tabId).toBe('esv-1');
    expect(result.report.restoredPanelIds).toEqual(['bible_default']);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].title).toBe('John 3');
  });

  it('preserves display mode, history, selected verse and toggles per passage', () => {
    const raw = {
      openTabs: [
        v1Tab({ displayMode: 'study', historyIndex: 3, showInterlinear: true, showNotes: false }),
      ],
      activeTabIndex: 0,
    };

    const { tab } = migrateBibleSession(raw, ['bible_default']).panels['bible_default'];

    expect(tab.displayMode).toBe('study');
    expect(tab.selectedVerseId).toBe(43003016);
    expect(tab.history).toHaveLength(1);
    expect(tab.historyIndex).toBe(3);
    expect(tab.showInterlinear).toBe(true);
    expect(tab.showNotes).toBe(false);
    expect(tab.moduleId).toBe(1);
  });

  /*
    `showInterlinear` is tri-state: absent means "never decided", which is what
    lets the first switch into Study mode seed interlinear-on without
    overriding a reader who turned it off. Normalising absent to `false` here
    would make every restored passage look like a deliberate "off".
  */
  it('keeps an unrecorded interlinear preference unrecorded', () => {
    const raw = {
      openTabs: [v1Tab({ showInterlinear: undefined, showCommentaryLinks: undefined })],
      activeTabIndex: 0,
    };

    const { tab } = migrateBibleSession(raw, ['bible_default']).panels['bible_default'];

    expect(tab.showInterlinear).toBeUndefined();
    // The commentary-links row, by contrast, is on unless it was switched off:
    // it was showing in every session written before the switch existed.
    expect(tab.showCommentaryLinks).toBe(true);
  });

  it('preserves an explicit "no commentary links"', () => {
    const raw = {
      openTabs: [v1Tab({ showCommentaryLinks: false })],
      activeTabIndex: 0,
    };

    const { tab } = migrateBibleSession(raw, ['bible_default']).panels['bible_default'];

    expect(tab.showCommentaryLinks).toBe(false);
  });

  it('falls back to the panel-level passage for tabs missing their own', () => {
    // Sessions predating per-tab navigation state stored only `current*`.
    const raw = {
      openTabs: [{ tabId: 'kjv-1', abbreviation: 'KJV', name: 'KJV', displayMode: 'reading' }],
      activeTabIndex: 0,
      currentBook: 45,
      currentChapter: 8,
      selectedVerseId: 45008028,
    };

    const { tab } = migrateBibleSession(raw, ['bible_default']).panels['bible_default'];

    expect(tab.book).toBe(45);
    expect(tab.chapter).toBe(8);
    expect(tab.selectedVerseId).toBe(45008028);
  });

  it('attaches the primary passage to a known id when the layout has no Bible panel', () => {
    const result = migrateBibleSession({ openTabs: [v1Tab()], activeTabIndex: 0 }, []);

    expect(Object.keys(result.panels)).toEqual([FALLBACK_PRIMARY_BIBLE_PANEL_ID]);
  });
});

describe('migrateBibleSession — v2 (already one panel per passage)', () => {
  const v2 = {
    version: BIBLE_SESSION_VERSION,
    panels: {
      bible_default: { tab: v1Tab(), isParallelViewMode: false, parallelVersions: [] },
      bible_abc123: {
        tab: v1Tab({ tabId: 'esv-1', abbreviation: 'ESV', book: 45, chapter: 8, bookName: 'Romans' }),
        isParallelViewMode: true,
        parallelVersions: ['KJV', 'ESV'],
      },
    },
  };

  it('restores in place and reports only genuinely missing panels', () => {
    const result = migrateBibleSession(v2, ['bible_default']);

    expect(result.report.sourceVersion).toBe(2);
    expect(result.report.legacyTabsExpanded).toBe(0);
    expect(result.report.restoredPanelIds).toEqual(['bible_default']);
    expect(result.report.createdPanelIds).toEqual(['bible_abc123']);
    expect(result.panels['bible_abc123'].isParallelViewMode).toBe(true);
    expect(result.panels['bible_abc123'].parallelVersions).toEqual(['KJV', 'ESV']);
  });

  it('is idempotent: re-running on its own output changes nothing', () => {
    const ids = ['bible_default', 'bible_abc123'];
    const once = migrateBibleSession(v2, ids);
    const twice = migrateBibleSession(
      { version: BIBLE_SESSION_VERSION, panels: once.panels },
      ids
    );

    expect(twice.panels).toEqual(once.panels);
    expect(twice.pending).toHaveLength(0);
    expect(twice.report.legacyTabsExpanded).toBe(0);
  });

  it('does not re-expand the v1 mirror that v2 data still carries', () => {
    // The serializer writes legacy `openTabs` alongside `panels` for downgrade
    // safety. Reading it as v1 would duplicate the primary passage.
    const withMirror = { ...v2, openTabs: [v1Tab(), v1Tab({ tabId: 'kjv-9' })], activeTabIndex: 0 };

    const result = migrateBibleSession(withMirror, ['bible_default']);

    expect(Object.keys(result.panels).sort()).toEqual(['bible_abc123', 'bible_default']);
  });
});

describe('migrateBibleSession — degrades to defaults instead of crashing', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'not a session'],
    ['a number', 42],
    ['an empty object', {}],
    ['no passages', { openTabs: [] }],
    ['openTabs of the wrong type', { openTabs: 'nope' }],
    ['tabs with no translation', { openTabs: [{ book: 43 }, null, 7] }],
    ['v2 with a broken panels map', { version: BIBLE_SESSION_VERSION, panels: { a: null, b: {} } }],
    ['v2 with panels of the wrong type', { version: BIBLE_SESSION_VERSION, panels: 'nope' }],
  ])('%s yields no panels and flags the fallback', (_label, raw) => {
    const result = migrateBibleSession(raw, ['bible_default']);

    expect(result.panels).toEqual({});
    expect(result.pending).toEqual([]);
    expect(result.report.fellBackToDefaults).toBe(true);
  });

  it('keeps the usable passages when only some entries are broken', () => {
    const raw = {
      openTabs: [null, v1Tab(), { nonsense: true }],
      activeTabIndex: 0,
    };

    const result = migrateBibleSession(raw, ['bible_default']);

    expect(Object.keys(result.panels)).toHaveLength(1);
    expect(result.panels['bible_default'].tab.abbreviation).toBe('KJV');
  });

  it('clamps an out-of-range active index rather than producing an undefined passage', () => {
    const raw = { openTabs: [v1Tab()], activeTabIndex: 12 };

    const result = migrateBibleSession(raw, ['bible_default']);

    expect(result.panels['bible_default'].tab.tabId).toBe('kjv-1');
    expect(result.pending).toHaveLength(0);
  });

  it('synthesises a tab id when the saved one is missing', () => {
    const raw = { openTabs: [{ abbreviation: 'KJV', book: 43, chapter: 3 }], activeTabIndex: 0 };

    const { tab } = migrateBibleSession(raw, ['bible_default']).panels['bible_default'];

    expect(tab.tabId).toBeTruthy();
    expect(tab.displayMode).toBe('standard');
  });
});

describe('biblePanelIdsFromLayout', () => {
  it('returns Bible panel ids in layout order', () => {
    const layout = {
      panels: {
        bible_default: { params: { contentType: 'bible' } },
        commentary_default: { params: { contentType: 'commentary' } },
        bible_abc: { params: { contentType: 'bible' } },
      },
    };

    expect(biblePanelIdsFromLayout(layout)).toEqual(['bible_default', 'bible_abc']);
  });

  it('returns nothing for a layout it cannot read', () => {
    expect(biblePanelIdsFromLayout(undefined)).toEqual([]);
    expect(biblePanelIdsFromLayout({})).toEqual([]);
    expect(biblePanelIdsFromLayout({ panels: { a: null, b: { params: null } } })).toEqual([]);
  });
});
