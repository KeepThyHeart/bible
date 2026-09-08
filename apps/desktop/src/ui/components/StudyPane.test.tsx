/**
 * Component tests for the Study pane.
 *
 * `useStudyPanel` is mocked so each test can put the pane in an exact state;
 * the store logic behind it has its own suite in
 * `stores/__tests__/useStudyStore.test.ts`.
 *
 * The i18n stub echoes keys, so assertions on user-visible copy check the key.
 * The exceptions are strings routed through `tf()`, which falls back to its
 * English source when a key is missing - "Combined Summary" and the provenance
 * notice both read correctly here for that reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import StudyPane from './StudyPane';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { resetModuleProvenanceCache } from './commentary/useModuleProvenance';
import { enString, enT } from '../testing/enCatalog';
import { useStudyStore } from '../stores/useStudyStore';

// Mock useStudyPanel
const mockUseStudyPanel = vi.fn();
vi.mock('../stores/hooks/useStudyPanel', () => ({
  useStudyPanel: (...args: unknown[]) => mockUseStudyPanel(...args),
}));

// Mock stores
vi.mock('../stores/useStudyStore', () => ({
  useStudyStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    {
      getState: vi.fn().mockReturnValue({
        initPanel: vi.fn(),
        destroyPanel: vi.fn(),
      }),
    },
  ),
}));

vi.mock('../stores/useTopicsStore', () => ({
  useTopicsStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    {
      getState: vi.fn().mockReturnValue({
        navigateToTopic: vi.fn(),
      }),
    },
  ),
}));

vi.mock('../stores/useLayoutStore', () => ({
  useLayoutStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    {
      getState: vi.fn().mockReturnValue({
        dockviewApi: null,
      }),
    },
  ),
}));

// The Bible store is read through a selector (to find the pane's anchor verse),
// so the stub has to actually run it against a controllable state.
const bibleStoreState = vi.hoisted(() => ({
  current: { panels: new Map<string, unknown>() } as {
    panels: Map<string, { selectedVerseId: number | null; currentBook: number; currentChapter: number }>;
  },
}));

vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    (selector?: (state: unknown) => unknown) =>
      selector ? selector(bibleStoreState.current) : bibleStoreState.current,
    {
      getState: vi.fn().mockReturnValue({
        navigateToVerseInPrimary: vi.fn(),
      }),
    },
  ),
}));

// Mock APIs and utilities
vi.mock('../services/electronAPI', () => ({
  bibleAPI: { getBookNames: vi.fn().mockResolvedValue([]) },
  commentaryAPI: { getCommentaryInfo: vi.fn().mockResolvedValue({ author: 'Matthew Henry' }) },
}));

vi.mock('../services/ipcResult', () => ({
  unwrap: vi.fn().mockImplementation((val: any) => val),
}));

vi.mock('../utils/verseReference', () => ({
  loadBookNamesCache: vi.fn(),
  formatVerseReference: (id: number) => `Verse ${id}`,
  formatVerseRange: (start: number, end: number) => `${start}-${end}`,
}));

vi.mock('../utils/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

vi.mock('../utils/commentaryLinkProcessor', () => ({
  reprocessCommentaryLinks: (html: string) => html,
}));

// Only `VerseIdHelper` is stubbed. `collapseReferencesStructured` is the thing
// under test in the cross-references case, so it comes through for real.
vi.mock('@bible/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bible/core')>()),
  VerseIdHelper: { parse: (id: number) => ({ bookNumber: Math.floor(id / 1000000) }) },
}));

// Mock sub-components
vi.mock('./shared/PaneNavHeader', () => ({ default: (props: any) => (
  <div data-testid="pane-nav-header">
    <button data-testid="back-btn" onClick={props.onBack} disabled={!props.canGoBack}>Back</button>
    <button data-testid="forward-btn" onClick={props.onForward} disabled={!props.canGoForward}>Forward</button>
  </div>
) }));
vi.mock('./shared/SuggestionBanner', () => ({ default: (props: any) => (
  <div data-testid="suggestion-banner">
    <button onClick={props.onGo}>Go</button>
    <button onClick={props.onDismiss}>Dismiss</button>
  </div>
) }));
vi.mock('./shared/TopicSearchBar', () => ({ default: () => <div data-testid="topic-search-bar" /> }));
vi.mock('./VersePreviewTooltip', () => ({ default: () => null }));
vi.mock('../hooks/useScriptureTooltip', () => ({
  useScriptureTooltip: () => ({ tooltipState: { visible: false, verseId: 0, position: { x: 0, y: 0 } }, closeTooltip: vi.fn(), tooltipMouseEnter: vi.fn() }),
}));

const JOHN_3_16 = 43003016;

/** A digest entry in the shape the SYNTHESIS module actually ships. */
const SYNTHESIS_MARKDOWN = [
  'John 3:16 Commentary Synthesis',
  '==============================',
  '',
  'Overall Verse Notes',
  '-------------------',
  '  * Luther called it the Bible in miniature.',
].join('\n');

interface ElectronStubOptions {
  commentaries?: Array<{ abbreviation: string; name: string }>;
  entriesByModule?: Record<string, Array<{ entry_id: number; entry_level: string; content: string }>>;
  xrefModules?: Array<{ abbreviation: string; name: string }>;
  xrefGroups?: unknown[];
}

function stubElectron(options: ElectronStubOptions = {}): void {
  const commentaries = options.commentaries ?? [];
  const entriesByModule = options.entriesByModule ?? {};
  const xrefModules = options.xrefModules ?? [];
  const xrefGroups = options.xrefGroups ?? [];
  // The shared vitest setup already defines `window.electron` as a
  // non-configurable property, so assign onto it rather than redefining it.
  (window as unknown as { electron: unknown }).electron = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    diagnostics: { reportRendererError: vi.fn() },
    window: { detachPane: vi.fn() },
    topical: { getTopicsForVerse: vi.fn().mockResolvedValue([]) },
    commentary: {
      getAvailableCommentaries: vi.fn().mockResolvedValue(commentaries),
      getEntriesForVerse: vi.fn().mockImplementation((abbr: string) =>
        Promise.resolve(entriesByModule[abbr] ?? [])),
      getCommentaryInfo: vi.fn().mockImplementation((abbr: string) =>
        Promise.resolve({ full_name: commentaries.find(c => c.abbreviation === abbr)?.name ?? abbr })),
    },
    crossReference: {
      getAvailable: vi.fn().mockResolvedValue(xrefModules),
      getGroupsForVerse: vi.fn().mockResolvedValue(xrefGroups),
    },
  };
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: { t: (key: string, params?: Record<string, unknown>) => enT(key, params), currentLocale: 'en' as const, onDidChangeLocale: () => ({ dispose: vi.fn() }), resolve: (v: unknown) => String(v), loadCatalog: vi.fn(), setLocale: vi.fn() } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const defaultPanelState = {
  currentVerseId: null,
  pinned: false,
  suggestionVerseId: null,
  canGoBack: false,
  canGoForward: false,
  currentNavEntry: null,
  sectionsCollapsed: {},
  navigateToVerse: vi.fn(),
  clearVerse: vi.fn(),
  seedInitialVerse: vi.fn(),
  dismissSuggestion: vi.fn(),
  acceptSuggestion: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  togglePin: vi.fn(),
  openCommentaryDetail: vi.fn(),
  toggleSection: vi.fn(),
};

describe('StudyPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModuleProvenanceCache();
    bibleStoreState.current = { panels: new Map() };
    stubElectron();
    mockUseStudyPanel.mockReturnValue(defaultPanelState);
  });

  it('renders empty state when no verse selected', () => {
    renderWithProviders(<StudyPane panelId="study_default" />);
    expect(screen.getByText(enString('studyPane.title'))).toBeInTheDocument();
    expect(screen.getByText(enString('studyPane.emptyHint'))).toBeInTheDocument();
  });

  it('renders nav header', () => {
    renderWithProviders(<StudyPane panelId="study_default" />);
    expect(screen.getByTestId('pane-nav-header')).toBeInTheDocument();
  });

  it('shows topic search bar in empty state', () => {
    renderWithProviders(<StudyPane panelId="study_default" />);
    expect(screen.getByTestId('topic-search-bar')).toBeInTheDocument();
  });

  it('shows verse banner when verse is selected', () => {
    mockUseStudyPanel.mockReturnValue({
      ...defaultPanelState,
      currentVerseId: JOHN_3_16,
    });
    renderWithProviders(<StudyPane panelId="study_default" />);
    expect(screen.getByText(enT('studyPane.studyingVerse', { reference: `Verse ${JOHN_3_16}` }))).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockUseStudyPanel.mockReturnValue({
      ...defaultPanelState,
      currentVerseId: JOHN_3_16,
    });
    renderWithProviders(<StudyPane panelId="study_default" />);
    expect(screen.getByText(enString('studyPane.loadingData'))).toBeInTheDocument();
  });

  it('shows suggestion banner when suggestion verse is set', () => {
    mockUseStudyPanel.mockReturnValue({
      ...defaultPanelState,
      suggestionVerseId: 43003017,
    });
    renderWithProviders(<StudyPane panelId="study_default" />);
    expect(screen.getByTestId('suggestion-banner')).toBeInTheDocument();
  });

  it('dismisses suggestion when dismiss is clicked', async () => {
    const user = userEvent.setup();
    const mockDismiss = vi.fn();
    mockUseStudyPanel.mockReturnValue({
      ...defaultPanelState,
      suggestionVerseId: 43003017,
      dismissSuggestion: mockDismiss,
    });
    renderWithProviders(<StudyPane panelId="study_default" />);
    await user.click(screen.getByText('Dismiss'));
    expect(mockDismiss).toHaveBeenCalled();
  });

  it('passes panelId to useStudyPanel', () => {
    renderWithProviders(<StudyPane panelId="custom-study" />);
    expect(mockUseStudyPanel).toHaveBeenCalledWith('custom-study');
  });

  // Chrome text (section labels, badges, hints, buttons) must go through
  // `uiScaled()` rather than hardcoding fontSize as a bare px string, or it
  // would never respond to the Typography section's "UI text" slider or the
  // "Global Font Scale" slider. `uiScaled()` expresses the size as
  // `calc(Npx * var(--ui-font-scale, 1) * var(--global-font-scale, 1))` -
  // these assertions check the rendered inline style references both
  // variables (and not a bare px value) rather than re-asserting the exact
  // pixel number, so they don't churn if the literal's base size is tuned.
  describe('chrome text scales with typography preferences', () => {
    it('empty-state title and hint are not hardcoded px', () => {
      renderWithProviders(<StudyPane panelId="study_default" />);

      const title = screen.getByText(enString('studyPane.title'));
      const hint = screen.getByText(enString('studyPane.emptyHint'));

      expect(title.style.fontSize).toContain('var(--ui-font-scale');
      expect(title.style.fontSize).toContain('var(--global-font-scale');
      expect(hint.style.fontSize).toContain('var(--ui-font-scale');
      expect(hint.style.fontSize).not.toMatch(/^\d+px$/);
    });

    it('the loading indicator is not hardcoded px', () => {
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, currentVerseId: JOHN_3_16 });
      renderWithProviders(<StudyPane panelId="study_default" />);

      const loading = screen.getByText(enString('studyPane.loadingData'));
      expect(loading.style.fontSize).toContain('var(--ui-font-scale');
    });

    it('empty-section notes ("noTopics"/"noCommentaries"/"noCrossReferences") are not hardcoded px', async () => {
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, currentVerseId: JOHN_3_16 });
      renderWithProviders(<StudyPane panelId="study_default" />);

      const noTopics = await screen.findByText(enString('studyPane.noTopics'));
      const noCommentaries = screen.getByText(enString('studyPane.noCommentaries'));
      const noCrossReferences = screen.getByText(enString('studyPane.noCrossReferences'));

      for (const el of [noTopics, noCommentaries, noCrossReferences]) {
        expect(el.style.fontSize).toContain('var(--ui-font-scale');
        expect(el.style.fontSize).toContain('var(--global-font-scale');
      }
    });

    it('the "studying verse" banner label is not hardcoded px', () => {
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, currentVerseId: JOHN_3_16 });
      renderWithProviders(<StudyPane panelId="study_default" />);

      const label = screen.getByText(enT('studyPane.studyingVerse', { reference: `Verse ${JOHN_3_16}` }));
      expect(label.style.fontSize).toContain('var(--ui-font-scale');
    });
  });

  // -- Fresh-open default verse ---------------------------------------------

  describe('fresh open', () => {
    it('offers the Bible pane’s selected verse as the seed', () => {
      bibleStoreState.current = {
        panels: new Map([['_default', { selectedVerseId: JOHN_3_16, currentBook: 43, currentChapter: 3 }]]),
      };
      const seedInitialVerse = vi.fn();
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, seedInitialVerse });

      renderWithProviders(<StudyPane panelId="study_default" />);

      expect(seedInitialVerse).toHaveBeenCalledWith(JOHN_3_16);
    });

    it('falls back to the first verse of the chapter on screen', () => {
      bibleStoreState.current = {
        panels: new Map([['_default', { selectedVerseId: null, currentBook: 43, currentChapter: 3 }]]),
      };
      const seedInitialVerse = vi.fn();
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, seedInitialVerse });

      renderWithProviders(<StudyPane panelId="study_default" />);

      expect(seedInitialVerse).toHaveBeenCalledWith(43003001);
    });

    it('seeds nothing, and does not crash, with no Bible pane open', () => {
      const seedInitialVerse = vi.fn();
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, seedInitialVerse });

      renderWithProviders(<StudyPane panelId="study_default" />);

      expect(seedInitialVerse).toHaveBeenCalledWith(null);
      expect(screen.getByText(enString('studyPane.emptyHint'))).toBeInTheDocument();
    });

    /**
     * A popped-out Study pane is exactly the "no Bible pane open" case above,
     * so without special handling it would come up on the empty hint. The
     * verse travels in the pop-out payload instead, and is taken over the
     * remembered one: every detached window mounts under the same `_default`
     * panel id, so what `seedInitialVerse` would restore there belongs to the
     * *previous* pop-out.
     */
    it('opens on the verse handed over by the pop-out', () => {
      const navigateToVerse = vi.fn();
      const seedInitialVerse = vi.fn();
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, navigateToVerse, seedInitialVerse });
      vi.mocked(useStudyStore.getState).mockReturnValue({
        initPanel: vi.fn(),
        destroyPanel: vi.fn(),
        getPanelState: () => ({ currentVerseId: null }),
      } as never);

      renderWithProviders(<StudyPane panelId="_default" initialVerseId={JOHN_3_16} />);

      expect(navigateToVerse).toHaveBeenCalledWith(JOHN_3_16);
      expect(seedInitialVerse).not.toHaveBeenCalled();
    });

    it('leaves a handed-over pane alone once it has a verse of its own', () => {
      const navigateToVerse = vi.fn();
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, navigateToVerse });
      vi.mocked(useStudyStore.getState).mockReturnValue({
        initPanel: vi.fn(),
        destroyPanel: vi.fn(),
        getPanelState: () => ({ currentVerseId: 43003001 }),
      } as never);

      renderWithProviders(<StudyPane panelId="_default" initialVerseId={JOHN_3_16} />);

      expect(navigateToVerse).not.toHaveBeenCalled();
    });
  });

  // -- Sections -------------------------------------------------------------

  describe('sections', () => {
    beforeEach(() => {
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, currentVerseId: JOHN_3_16 });
    });

    it('shows collapsible sections when data is loaded', async () => {
      renderWithProviders(<StudyPane panelId="study_default" />);
      await screen.findByText(enString('studyPane.topicsTitle'));
      expect(screen.getByText(enString('studyPane.commentariesTitle'))).toBeInTheDocument();
      expect(screen.getByText(enString('studyPane.crossReferencesTitle'))).toBeInTheDocument();
    });

    // Sitting above every section would read as a search of the whole pane
    // rather than of topics alone.
    it('puts the topic search box inside the Topics section, not above the pane', async () => {
      const { container } = renderWithProviders(<StudyPane panelId="study_default" />);
      const topicsHeading = await screen.findByText(enString('studyPane.topicsTitle'));

      const searchBar = screen.getByTestId('topic-search-bar');
      const topicsSection = topicsHeading.closest('section');
      expect(topicsSection).not.toBeNull();
      expect(topicsSection!.contains(searchBar)).toBe(true);

      // And nowhere else: exactly one instance, inside that section.
      expect(container.querySelectorAll('[data-testid="topic-search-bar"]')).toHaveLength(1);
    });

    it('orders cross-references before topics, matching the web pane', async () => {
      const { container } = renderWithProviders(<StudyPane panelId="study_default" />);
      await screen.findByText(enString('studyPane.topicsTitle'));

      const headings = Array.from(container.querySelectorAll('section > button')).map(
        (b) => b.textContent ?? ''
      );
      expect(headings[0]).toContain(enString('studyPane.crossReferencesTitle'));
      expect(headings[1]).toContain(enString('studyPane.topicsTitle'));
    });

    it('renders cross-references the way the web pane does', async () => {
      // Deliberately out of canonical order, with two adjacent verses that
      // should collapse into one range and a repeated book that should not
      // repeat its name.
      stubElectron({
        xrefModules: [{ abbreviation: 'TSK', name: 'Treasury of Scripture Knowledge' }],
        xrefGroups: [{
          group: { group_id: 1, verse_id: JOHN_3_16, phrase: 'Verily.', sort_order: 0 },
          entries: [
            { entry_id: 1, target_verse_id: 43001051, target_verse_end_id: null },
            { entry_id: 2, target_verse_id: 40005018, target_verse_end_id: null },
            { entry_id: 3, target_verse_id: 47001019, target_verse_end_id: null },
            { entry_id: 4, target_verse_id: 47001020, target_verse_end_id: null },
            { entry_id: 5, target_verse_id: 66003014, target_verse_end_id: null },
          ],
        }],
      });

      const { container } = renderWithProviders(<StudyPane panelId="study_default" />);
      const phrase = await screen.findByText('"Verily"');

      // Keyword on the same line as the references, trailing period gone.
      const row = phrase.parentElement!;
      expect(row.textContent).toBe('"Verily" — Mt 5:18; Jn 1:51; 2Co 1:19-20; Re 3:14');
      expect(container.textContent).not.toContain('2 Corinthians');
    });

    it('shows every reference, with no "+N more" toggle', async () => {
      // 20 non-adjacent verses in Ps 119, so nothing collapses into a range.
      // The inline row under a verse in the Bible text caps a group at 12; this
      // pane is the one the reader opened TO read cross-references, so it does
      // not hide eight of them behind a counter.
      stubElectron({
        xrefModules: [{ abbreviation: 'TSK', name: 'Treasury of Scripture Knowledge' }],
        xrefGroups: [{
          group: { group_id: 1, verse_id: JOHN_3_16, phrase: 'Verily.', sort_order: 0 },
          entries: Array.from({ length: 20 }, (_, i) => ({
            entry_id: i + 1,
            target_verse_id: 19119001 + i * 2,
            target_verse_end_id: null,
          })),
        }],
      });

      renderWithProviders(<StudyPane panelId="study_default" />);
      const phrase = await screen.findByText('"Verily"');

      const row = phrase.parentElement!;
      const refs = Array.from(row.querySelectorAll('button'));
      expect(refs).toHaveLength(20);
      expect(refs.some((b) => (b.textContent ?? '').includes('more'))).toBe(false);
      expect(refs[19].textContent).toBe('39');
    });

    it('shows an empty note per section rather than nothing', async () => {
      renderWithProviders(<StudyPane panelId="study_default" />);
      expect(await screen.findByText(enString('studyPane.noTopics'))).toBeInTheDocument();
      expect(screen.getByText(enString('studyPane.noCommentaries'))).toBeInTheDocument();
      expect(screen.getByText(enString('studyPane.noCrossReferences'))).toBeInTheDocument();
    });
  });

  // -- The auto-generated digest --------------------------------------------

  describe('combined summary', () => {
    beforeEach(() => {
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, currentVerseId: JOHN_3_16 });
      stubElectron({
        commentaries: [{ abbreviation: 'SYNTHESIS', name: 'Commentary Synthesis' }],
        entriesByModule: {
          SYNTHESIS: [{ entry_id: 1, entry_level: 'verse', content: SYNTHESIS_MARKDOWN }],
        },
      });
    });

    it('names the digest "Combined Summary", not its database name', async () => {
      renderWithProviders(<StudyPane panelId="study_default" />);
      expect(await screen.findByText('Combined Summary')).toBeInTheDocument();
      expect(screen.queryByText('Commentary Synthesis')).not.toBeInTheDocument();
    });

    it('renders the digest Markdown as formatted HTML', async () => {
      const { container } = renderWithProviders(<StudyPane panelId="study_default" />);

      await waitFor(() => {
        expect(container.querySelector('.pane-content-commentary h2')).toBeTruthy();
      });

      const rendered = container.querySelector('.pane-content-commentary')!;
      expect(rendered.querySelector('h2')!.textContent).toBe('Overall Verse Notes');
      expect(rendered.querySelector('li')).toBeTruthy();
      // None of the raw Markdown markers reach the reader.
      expect(rendered.textContent).not.toContain('===');
      expect(rendered.textContent).not.toContain('* Luther');
    });

    it('discloses that the summary was machine generated', async () => {
      renderWithProviders(<StudyPane panelId="study_default" />);
      expect(await screen.findByTestId('module-disclaimer')).toBeInTheDocument();
      expect(
        screen.getByText('This is an auto-generated summary of a range of public-domain commentaries.')
      ).toBeInTheDocument();
    });

    it('keeps the digest out of the plain commentary list', async () => {
      renderWithProviders(<StudyPane panelId="study_default" />);
      expect(await screen.findByText('Combined Summary')).toBeInTheDocument();
      expect(screen.getByText(enString('studyPane.noCommentaries'))).toBeInTheDocument();
    });
  });

  describe('other commentaries', () => {
    it('lists a human-authored module with a marker-free preview', async () => {
      mockUseStudyPanel.mockReturnValue({ ...defaultPanelState, currentVerseId: JOHN_3_16 });
      stubElectron({
        commentaries: [{ abbreviation: 'MHC', name: 'Matthew Henry' }],
        entriesByModule: {
          MHC: [{ entry_id: 7, entry_level: 'verse', content: '<p>Here is <b>plain</b> HTML.</p>' }],
        },
      });

      renderWithProviders(<StudyPane panelId="study_default" />);

      expect(await screen.findByText('Matthew Henry')).toBeInTheDocument();
      expect(screen.getByText(/Here is plain HTML\./)).toBeInTheDocument();
    });
  });
});
