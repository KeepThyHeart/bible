import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import DockviewLayout from './DockviewLayout';

// Reveal safety net (task 0080): when Study becomes the visible app again, dockview is
// re-laid out at its measured size (inside runInternal), and never while hidden.
const { studyState, runInternal, mockLayout } = vi.hoisted(() => ({
  studyState: { active: false, listeners: new Set<() => void>() },
  runInternal: vi.fn((fn: () => unknown) => fn()),
  mockLayout: vi.fn(),
}));

vi.mock('../apps/appHost', async () => {
  const React = await import('react');
  return {
    useIsAppActive: () =>
      React.useSyncExternalStore(
        (l: () => void) => { studyState.listeners.add(l); return () => { studyState.listeners.delete(l); }; },
        () => studyState.active,
      ),
  };
});

const mockApi = {
  addPanel: vi.fn().mockReturnValue({ id: 'p', api: { setActive: vi.fn() }, group: { id: 'g' }, params: {}, title: 't' }),
  fromJSON: vi.fn(),
  layout: mockLayout,
  panels: [] as unknown[],
  onDidRemovePanel: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidLayoutChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidActivePanelChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onWillDragPanel: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onWillDragGroup: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onWillDrop: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  getGroup: vi.fn().mockReturnValue(undefined),
};
let onReady: ((e: unknown) => void) | null = null;

vi.mock('dockview-react', () => ({
  DockviewReact: (props: { onReady: (e: unknown) => void }) => { onReady = props.onReady; return <div data-testid="dv" />; },
  themeLight: { name: 'light', className: 'dockview-theme-light' },
}));
vi.mock('../stores/useLayoutStore', () => ({
  useLayoutStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ collapsedGroups: [], expandCollapsedGroups: vi.fn() }),
    {
      getState: () => ({
        setDockviewApi: vi.fn(), registerPanel: vi.fn(), unregisterPanel: vi.fn(), setCollapsedGroups: vi.fn(),
        setActivePanelId: vi.fn(), restoreCollapsedGroups: vi.fn(),
      }),
      setState: vi.fn(),
    },
  ),
}));
vi.mock('../commands/layoutCommands', () => ({
  layoutPresetService: { reset: vi.fn(), notifyManualLayoutChange: vi.fn(), runInternal },
}));
vi.mock('../stores/useSessionStore', () => ({
  useSessionStore: Object.assign(vi.fn(), { getState: () => ({ markDirty: vi.fn() }) }),
}));
vi.mock('./PanelContentRenderer', () => ({ default: () => <div /> }));
vi.mock('./DockviewTabRenderer', () => ({ default: () => <div /> }));
vi.mock('./DockviewHeaderActions', () => ({ default: () => <div /> }));
vi.mock('./DockviewWatermark', () => ({ default: () => <div /> }));
vi.mock('./CollapsedPanesRevealBar', () => ({ default: () => <div /> }));
vi.mock('./AdvancedPaneManagerGateDialog', () => ({ default: () => <div /> }));

function setActive(active: boolean): void {
  studyState.active = active;
  act(() => { for (const l of [...studyState.listeners]) l(); });
}

describe('DockviewLayout reveal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    studyState.active = false;
    studyState.listeners.clear();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 1; });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  });
  afterEach(() => vi.restoreAllMocks());

  it('never lays out while hidden, then once at the measured size on becoming active', () => {
    render(<DockviewLayout />);
    act(() => { onReady!({ api: mockApi }); });
    expect(mockLayout).not.toHaveBeenCalled();
    setActive(true);
    expect(mockLayout).toHaveBeenCalledTimes(1);
    expect(mockLayout).toHaveBeenCalledWith(800, 600, true);
    expect(runInternal).toHaveBeenCalledTimes(1);
  });

  it('skips the layout when the container has no size', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0);
    render(<DockviewLayout />);
    act(() => { onReady!({ api: mockApi }); });
    setActive(true);
    expect(mockLayout).not.toHaveBeenCalled();
  });
});
