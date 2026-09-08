/**
 * Interlinear should default ON for a brand-new Study-mode tab - but there are
 * two separate sources of truth that both have to agree:
 *   - `studyOptionsByTab` (tabOptionsSlice.getStudyOptions) gates the actual
 *     interlinear content in StudyModeView.
 *   - `BibleTab.showInterlinear` drives the toolbar toggle icon
 *     (ChapterToggleButtons.tsx).
 * Seeding only one of them means the icon and the content disagree, and the
 * user's first click on the toggle appears to turn interlinear *off*.
 *
 * A restored session must NOT be overridden by this default: a passage the
 * user explicitly turned interlinear off for has to come back off.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn(),
    getBookName: vi.fn().mockResolvedValue('John'),
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useBibleStore } from '../useBibleStore';
import type { BibleTab } from '../bible/types';

const PANEL = 'test_panel_interlinear_default';

const KJV = {
  abbreviation: 'KJV',
  name: 'King James Version',
  database_path: 'bible_kjv.db',
  module_id: 1,
};

describe('Study mode interlinear default', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], sessionPanelStates: new Map() });
    useBibleStore.getState().initPanel(PANEL);
  });

  it('turns interlinear on — content gate and toolbar toggle both — for a new Study-mode tab', () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version', 'study');

    const ps = useBibleStore.getState().getPanelState(PANEL);
    const tab = ps.openTabs[0];

    // Toolbar toggle icon (ChapterToggleButtons reads tab.showInterlinear directly).
    expect(tab.showInterlinear).toBe(true);
    // Content gate (StudyModeView reads getStudyOptions().showInterlinear).
    expect(useBibleStore.getState().getStudyOptions(PANEL, tab.tabId).showInterlinear).toBe(true);
  });

  it('leaves interlinear off for a new Standard-mode tab', () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version', 'standard');

    const ps = useBibleStore.getState().getPanelState(PANEL);
    const tab = ps.openTabs[0];

    expect(!!tab.showInterlinear).toBe(false);
    expect(useBibleStore.getState().getStudyOptions(PANEL, tab.tabId).showInterlinear).toBe(false);
  });

  it('leaves interlinear off for a new Reading-mode tab', () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version', 'reading');

    const ps = useBibleStore.getState().getPanelState(PANEL);
    const tab = ps.openTabs[0];

    expect(!!tab.showInterlinear).toBe(false);
    expect(useBibleStore.getState().getStudyOptions(PANEL, tab.tabId).showInterlinear).toBe(false);
  });

  /*
    Creating a tab in Study mode is not how anyone reaches Study mode. Tabs are
    created in `DEFAULT_DISPLAY_MODE` (standard) and switched with the toolbar's
    display-mode dropdown, which goes through `setDisplayMode` - and that must
    seed the interlinear default too, not write nothing but the mode. Otherwise
    the default above is unreachable in practice: readers switch to Study mode,
    get plain verses, and the only control that would fix it is the chapter-top
    checkbox, which is easy to miss - so interlinear looks broken.
  */
  it('turns interlinear on the first time a passage is switched into Study mode', () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version', 'standard');
    const tabId = useBibleStore.getState().getPanelState(PANEL).openTabs[0].tabId;
    expect(useBibleStore.getState().getStudyOptions(PANEL, tabId).showInterlinear).toBe(false);

    useBibleStore.getState().setDisplayMode(PANEL, tabId, 'study');

    const tab = useBibleStore.getState().getPanelState(PANEL).openTabs[0];
    expect(tab.showInterlinear).toBe(true);
    expect(useBibleStore.getState().getStudyOptions(PANEL, tabId).showInterlinear).toBe(true);
  });

  it('leaves Standard and Reading alone when the mode changes', () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version', 'standard');
    const tabId = useBibleStore.getState().getPanelState(PANEL).openTabs[0].tabId;

    useBibleStore.getState().setDisplayMode(PANEL, tabId, 'reading');

    const tab = useBibleStore.getState().getPanelState(PANEL).openTabs[0];
    expect(tab.showInterlinear).toBeUndefined();
    expect(useBibleStore.getState().getStudyOptions(PANEL, tabId).showInterlinear).toBe(false);
  });

  it('does not turn interlinear back on for a passage the reader turned it off for', () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version', 'standard');
    const tabId = useBibleStore.getState().getPanelState(PANEL).openTabs[0].tabId;

    useBibleStore.getState().setDisplayMode(PANEL, tabId, 'study');
    useBibleStore.getState().setStudyOptions(PANEL, tabId, { showInterlinear: false });
    // Away and back: the seed must not fire a second time.
    useBibleStore.getState().setDisplayMode(PANEL, tabId, 'standard');
    useBibleStore.getState().setDisplayMode(PANEL, tabId, 'study');

    expect(useBibleStore.getState().getPanelState(PANEL).openTabs[0].showInterlinear).toBe(false);
    expect(useBibleStore.getState().getStudyOptions(PANEL, tabId).showInterlinear).toBe(false);
  });

  it('seeds the default for a restored passage that never recorded a preference', async () => {
    const restoredTab: BibleTab = {
      tabId: 'kjv-undecided',
      abbreviation: 'KJV',
      name: 'King James Version',
      displayMode: 'standard',
      moduleId: 1,
      book: 43,
      chapter: 3,
      bookName: 'John',
      selectedVerseId: 43003016,
      history: [],
      historyIndex: 0,
      // No showInterlinear at all - the reader has never expressed a view.
    };

    useBibleStore.setState({ sessionPanelStates: new Map([[PANEL, { tab: restoredTab }]]) });
    await useBibleStore.getState().restorePanelFromSession(PANEL);

    // Restore seeds the options map, so the seed condition has to read the
    // passage record rather than "is there a map entry".
    useBibleStore.getState().setDisplayMode(PANEL, 'kjv-undecided', 'study');

    expect(useBibleStore.getState().getStudyOptions(PANEL, 'kjv-undecided').showInterlinear).toBe(true);
  });

  it('does not override a restored session where the user had interlinear off', async () => {
    const restoredTab: BibleTab = {
      tabId: 'kjv-restored',
      abbreviation: 'KJV',
      name: 'King James Version',
      displayMode: 'study',
      moduleId: 1,
      book: 43,
      chapter: 3,
      bookName: 'John',
      selectedVerseId: 43003016,
      history: [],
      historyIndex: 0,
      showInterlinear: false, // explicitly turned off by the user before saving
    };

    useBibleStore.setState({
      sessionPanelStates: new Map([[PANEL, { tab: restoredTab }]]),
    });

    await useBibleStore.getState().restorePanelFromSession(PANEL);

    expect(useBibleStore.getState().getStudyOptions(PANEL, 'kjv-restored').showInterlinear).toBe(false);
  });

  /*
    The gap the two cases below cover: `setDisplayMode` seeds the interlinear
    default, but a session restore never goes through it. A passage saved
    *already in Study mode* by a build that predates the tri-state comes back
    with `showInterlinear: undefined`, which must not collapse to `false` -
    that would mean Study mode with plain verses and an unticked checkbox, and
    no gesture that would ever seed it.
  */
  it('turns interlinear on for a restored passage that was already in Study mode with no preference', async () => {
    const restoredTab: BibleTab = {
      tabId: 'kjv-study-undecided',
      abbreviation: 'KJV',
      name: 'King James Version',
      displayMode: 'study',
      moduleId: 1,
      book: 43,
      chapter: 3,
      bookName: 'John',
      selectedVerseId: 43003016,
      history: [],
      historyIndex: 0,
      // Saved before the switch existed.
    };

    useBibleStore.setState({ sessionPanelStates: new Map([[PANEL, { tab: restoredTab }]]) });
    await useBibleStore.getState().restorePanelFromSession(PANEL);

    expect(useBibleStore.getState().getStudyOptions(PANEL, 'kjv-study-undecided').showInterlinear).toBe(true);
  });

  it('writes the seeded preference back onto the passage, so the next save records it', async () => {
    const restoredTab: BibleTab = {
      tabId: 'kjv-study-writeback',
      abbreviation: 'KJV',
      name: 'King James Version',
      displayMode: 'study',
      moduleId: 1,
      book: 43,
      chapter: 3,
      bookName: 'John',
      selectedVerseId: 43003016,
      history: [],
      historyIndex: 0,
    };

    useBibleStore.setState({ sessionPanelStates: new Map([[PANEL, { tab: restoredTab }]]) });
    await useBibleStore.getState().restorePanelFromSession(PANEL);

    expect(useBibleStore.getState().getPanelState(PANEL).openTabs[0].showInterlinear).toBe(true);
  });

  it('leaves a restored non-Study passage undecided rather than seeding it', async () => {
    const restoredTab: BibleTab = {
      tabId: 'kjv-standard-undecided',
      abbreviation: 'KJV',
      name: 'King James Version',
      displayMode: 'standard',
      moduleId: 1,
      book: 43,
      chapter: 3,
      bookName: 'John',
      selectedVerseId: 43003016,
      history: [],
      historyIndex: 0,
    };

    useBibleStore.setState({ sessionPanelStates: new Map([[PANEL, { tab: restoredTab }]]) });
    await useBibleStore.getState().restorePanelFromSession(PANEL);

    // Still undecided on the record, so switching into Study mode later seeds it.
    expect(useBibleStore.getState().getPanelState(PANEL).openTabs[0].showInterlinear).toBeUndefined();
    expect(useBibleStore.getState().getStudyOptions(PANEL, 'kjv-standard-undecided').showInterlinear).toBe(false);
  });

  it('restores a session where the user had interlinear on', async () => {
    const restoredTab: BibleTab = {
      tabId: 'kjv-restored-on',
      abbreviation: 'KJV',
      name: 'King James Version',
      displayMode: 'study',
      moduleId: 1,
      book: 43,
      chapter: 3,
      bookName: 'John',
      selectedVerseId: 43003016,
      history: [],
      historyIndex: 0,
      showInterlinear: true,
    };

    useBibleStore.setState({
      sessionPanelStates: new Map([[PANEL, { tab: restoredTab }]]),
    });

    await useBibleStore.getState().restorePanelFromSession(PANEL);

    expect(useBibleStore.getState().getStudyOptions(PANEL, 'kjv-restored-on').showInterlinear).toBe(true);
  });
});
