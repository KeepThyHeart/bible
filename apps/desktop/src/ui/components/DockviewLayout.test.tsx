import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import DockviewLayout from './DockviewLayout';

// Mock dockview-react
const mockAddPanel = vi.fn().mockReturnValue({
  id: 'test-panel',
  api: { setActive: vi.fn() },
  group: { id: 'group-1' },
  params: { contentType: 'bible' },
  title: 'Bible',
});

const mockFromJSON = vi.fn();
const mockOnDidRemovePanel = vi.fn().mockReturnValue({ dispose: vi.fn() });
const mockOnDidLayoutChange = vi.fn().mockReturnValue({ dispose: vi.fn() });
const mockOnDidActivePanelChange = vi.fn().mockReturnValue({ dispose: vi.fn() });
// KAN QA 4.5: Advanced Pane Manager drag gate - DockviewLayout subscribes to
// all three unconditionally, so the mock api needs them even though no test
// in this file drives a drag/drop.
const mockOnWillDragPanel = vi.fn().mockReturnValue({ dispose: vi.fn() });
const mockOnWillDragGroup = vi.fn().mockReturnValue({ dispose: vi.fn() });
const mockOnWillDrop = vi.fn().mockReturnValue({ dispose: vi.fn() });

const mockDockviewApi = {
  addPanel: mockAddPanel,
  fromJSON: mockFromJSON,
  panels: [] as any[],
  onDidRemovePanel: mockOnDidRemovePanel,
  onDidLayoutChange: mockOnDidLayoutChange,
  onDidActivePanelChange: mockOnDidActivePanelChange,
  onWillDragPanel: mockOnWillDragPanel,
  onWillDragGroup: mockOnWillDragGroup,
  onWillDrop: mockOnWillDrop,
  getGroup: vi.fn().mockReturnValue(undefined),
};

let capturedOnReady: ((event: any) => void) | null = null;

vi.mock('dockview-react', () => ({
  DockviewReact: (props: any) => {
    // Capture onReady so tests can trigger it
    capturedOnReady = props.onReady;
    return <div data-testid="dockview-react" />;
  },
  // DockviewLayout passes this straight through as the `theme` prop.
  themeLight: { name: 'light', className: 'dockview-theme-light' },
}));

// Mock stores
const mockSetDockviewApi = vi.fn();
const mockRegisterPanel = vi.fn();
const mockUnregisterPanel = vi.fn();
const mockSetCollapsedGroups = vi.fn();
const mockRestoreCollapsedGroups = vi.fn();
const mockSetActivePanelId = vi.fn();
const mockExpandCollapsedGroups = vi.fn();

// KAN QA 4.3 added real `useLayoutStore(selector)` hook usage in
// DockviewLayout (collapsedGroups / expandCollapsedGroups, for the reveal
// bar). The hook has to behave like the real zustand one - calling the
// selector against a fake state object - rather than unconditionally
// returning `undefined`, or `collapsedGroups.length` in the component blows
// up once `apiRef.current` is set.
const mockLayoutState = { collapsedGroups: [] as unknown[], expandCollapsedGroups: mockExpandCollapsedGroups };

vi.mock('../stores/useLayoutStore', () => ({
  useLayoutStore: Object.assign(
    (selector: (state: typeof mockLayoutState) => unknown) => selector(mockLayoutState),
    {
      getState: () => ({
        setDockviewApi: mockSetDockviewApi,
        registerPanel: mockRegisterPanel,
        unregisterPanel: mockUnregisterPanel,
        setCollapsedGroups: mockSetCollapsedGroups,
        setActivePanelId: mockSetActivePanelId,
        restoreCollapsedGroups: mockRestoreCollapsedGroups,
      }),
      setState: vi.fn(),
    },
  ),
}));

// KAN QA 4.4 moved `layoutPresetService` from a lazy `import()` (deferred
// until the effect runs, well after this file's own top-level `const`s were
// initialized) to a static import at the top of DockviewLayout.tsx. That
// static import is now resolved eagerly while this test file's own
// `import DockviewLayout from './DockviewLayout'` is still being linked -
// before any later top-level `const` in *this* file has run - so the mock
// functions the factory closes over must be declared via `vi.hoisted()`
// rather than a plain `const`, or the factory sees them in the temporal dead
// zone ("Cannot access '...' before initialization").
const { mockPresetServiceReset, mockNotifyManualLayoutChange } = vi.hoisted(() => ({
  mockPresetServiceReset: vi.fn(),
  mockNotifyManualLayoutChange: vi.fn(),
}));
vi.mock('../commands/layoutCommands', () => ({
  layoutPresetService: { reset: mockPresetServiceReset, notifyManualLayoutChange: mockNotifyManualLayoutChange },
}));

const mockMarkDirty = vi.fn();
vi.mock('../stores/useSessionStore', () => ({
  useSessionStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    {
      getState: () => ({ markDirty: mockMarkDirty }),
    },
  ),
}));

// Mock sub-components
vi.mock('./PanelContentRenderer', () => ({ default: () => <div /> }));
vi.mock('./DockviewTabRenderer', () => ({ default: () => <div /> }));
vi.mock('./DockviewHeaderActions', () => ({ default: () => <div /> }));
vi.mock('./DockviewWatermark', () => ({ default: () => <div /> }));
// CollapsedPanesRevealBar (KAN QA 4.3) and AdvancedPaneManagerGateDialog
// (KAN QA 4.5) both call useI18n(), which throws outside <ContextProvider> -
// none of the tests in this file render one, so these are mocked out like
// the other DockviewLayout children above.
vi.mock('./CollapsedPanesRevealBar', () => ({ default: () => <div /> }));
vi.mock('./AdvancedPaneManagerGateDialog', () => ({ default: () => <div /> }));

describe('DockviewLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnReady = null;
    mockDockviewApi.panels = [];
    mockFromJSON.mockImplementation(() => {});
  });

  it('renders DockviewReact component', () => {
    render(<DockviewLayout />);
    expect(screen.getByTestId('dockview-react')).toBeInTheDocument();
  });

  it('captures onReady callback', () => {
    render(<DockviewLayout />);
    expect(capturedOnReady).toBeTruthy();
  });

  it('creates default layout when onReady fires without saved layout', () => {
    render(<DockviewLayout />);
    // Trigger onReady - this updates state, which triggers the useEffect
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });

    expect(mockSetDockviewApi).toHaveBeenCalledWith(mockDockviewApi);
    expect(mockAddPanel).toHaveBeenCalled();
    expect(mockRegisterPanel).toHaveBeenCalled();
  });

  it('opens Bible, Study, Commentary and Dictionary on first run', () => {
    // Opening every pane here would produce a row of empty tabs on a fresh
    // profile, so only these four open by default; Books and Notes remain
    // reachable via the "+" menu. Dictionary earns its slot: a Strong's-number
    // click is the commonest way out of the Bible text, and with no Dictionary
    // pane that click would have to create one - labelled "Books", with the
    // lexicon behind its book half.
    render(<DockviewLayout />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });

    const expected = ['bible_default', 'study_default', 'commentary_default', 'dictionary_default'];

    const panelIds = mockAddPanel.mock.calls.map(([options]) => options.id);
    expect(panelIds).toEqual(expected);

    const registeredIds = mockRegisterPanel.mock.calls.map(([panel]) => panel.panelId);
    expect(registeredIds).toEqual(expected);
  });

  it('gives the Dictionary panel the dictionary content type, in the study group', () => {
    // It is a first-class pane slot, not a second door into the Books pane:
    // `PanelContentRenderer` routes 'dictionary' to BookPane with
    // `initialActivePane='dictionary'`, and the tab reads "Dictionary".
    render(<DockviewLayout />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });

    const call = mockAddPanel.mock.calls.find(([options]) => options.id === 'dictionary_default');
    expect(call?.[0].params).toMatchObject({ contentType: 'dictionary' });
    expect(call?.[0].title).toBe('Dictionary');
    expect(call?.[0].position).toMatchObject({ direction: 'within' });
  });

  it('splits the Bible pane and the study group 50/50', () => {
    // Dockview distributes an unsized `direction: 'right'` split evenly, so
    // the Bible pane keeps half the workbench width.
    render(<DockviewLayout />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });

    const studyCall = mockAddPanel.mock.calls.find(([options]) => options.id === 'study_default');
    expect(studyCall?.[0].position).toMatchObject({ direction: 'right' });
    expect(studyCall?.[0].position.initialWidth).toBeUndefined();
  });

  it('restores saved layout when provided', () => {
    const savedLayout = { grid: {}, panels: [] };
    render(<DockviewLayout savedLayout={savedLayout} />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });

    expect(mockFromJSON).toHaveBeenCalledWith(savedLayout);
  });

  it('falls back to default layout when restore fails', () => {
    mockFromJSON.mockImplementation(() => { throw new Error('Invalid layout'); });
    const savedLayout = { grid: {}, panels: [] };
    render(<DockviewLayout savedLayout={savedLayout} />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });

    expect(mockFromJSON).toHaveBeenCalled();
    expect(mockAddPanel).toHaveBeenCalled();
  });

  it('registers panel removal listener', () => {
    render(<DockviewLayout />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });
    expect(mockOnDidRemovePanel).toHaveBeenCalled();
  });

  it('registers layout change listener for dirty marking', () => {
    render(<DockviewLayout />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });
    expect(mockOnDidLayoutChange).toHaveBeenCalled();
  });

  it('skips layout creation if panels already exist', () => {
    mockDockviewApi.panels = [{ id: 'existing', params: { contentType: 'bible' }, title: 'Bible' }] as any;
    render(<DockviewLayout />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });
    expect(mockAddPanel).not.toHaveBeenCalled();
    expect(mockFromJSON).not.toHaveBeenCalled();
  });

  it('registers panels from restored layout', () => {
    const restoredPanels = [
      { id: 'bible_default', params: { contentType: 'bible' }, title: 'Bible' },
      { id: 'commentary_default', params: { contentType: 'commentary' }, title: 'Commentary' },
    ];
    mockFromJSON.mockImplementation(() => {
      (mockDockviewApi.panels as any[]).push(...restoredPanels);
    });
    const savedLayout = { grid: {}, panels: [] };
    render(<DockviewLayout savedLayout={savedLayout} />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });

    expect(mockRegisterPanel).toHaveBeenCalledTimes(2);
  });

  // --- Historical-bug recovery: corrupted `contentComponent` from a since-
  // fixed layout-preset bug (see LayoutStateSanitizer.ts). ---------------

  function corruptedSavedLayout() {
    return {
      grid: {
        root: {
          type: 'branch',
          size: 1000,
          data: [
            {
              type: 'leaf',
              size: 500,
              data: { id: 'g1', views: ['bible_default'], activeView: 'bible_default' },
            },
          ],
        },
        width: 1000,
        height: 1000,
        orientation: 'HORIZONTAL',
      },
      panels: {
        bible_default: {
          id: 'bible_default',
          contentComponent: 'unknown', // the corrupted shape
          title: 'Bible',
          params: { contentType: 'bible' },
        },
      },
    };
  }

  it('repairs a corrupted saved layout (contentComponent: unknown) before handing it to dockview', () => {
    mockFromJSON.mockImplementation(() => {
      (mockDockviewApi.panels as any[]).push({ id: 'bible_default', params: { contentType: 'bible' }, title: 'Bible' });
    });
    const savedLayout = corruptedSavedLayout();
    render(<DockviewLayout savedLayout={savedLayout} />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });

    expect(mockFromJSON).toHaveBeenCalledTimes(1);
    const passedLayout = mockFromJSON.mock.calls[0][0];
    // The blob handed to dockview must carry the repaired contentComponent -
    // not the literal 'unknown' from the saved session.
    expect(passedLayout.panels.bible_default.contentComponent).toBe('panelContent');
    expect(mockRegisterPanel).toHaveBeenCalledWith(
      expect.objectContaining({ panelId: 'bible_default', contentType: 'bible' }),
    );
  });

  it('falls back to the default layout when a saved layout has no recoverable panels', () => {
    const savedLayout = {
      grid: {
        root: {
          type: 'branch',
          size: 1000,
          data: [
            {
              type: 'leaf',
              size: 500,
              data: { id: 'g1', views: ['garbage-panel'], activeView: 'garbage-panel' },
            },
          ],
        },
        width: 1000,
        height: 1000,
        orientation: 'HORIZONTAL',
      },
      panels: {
        'garbage-panel': {
          id: 'garbage-panel',
          contentComponent: 'unknown',
          title: 'Garbage',
          // No usable contentType in params, and an id with no recognizable prefix.
          params: { contentType: 'not-a-real-type' },
        },
      },
    };
    render(<DockviewLayout savedLayout={savedLayout} />);
    act(() => {
      capturedOnReady!({ api: mockDockviewApi });
    });

    // Nothing recoverable survived sanitization, so dockview never sees the
    // corrupted blob - the default layout is created instead.
    expect(mockFromJSON).not.toHaveBeenCalled();
    expect(mockAddPanel).toHaveBeenCalled();
  });
});
