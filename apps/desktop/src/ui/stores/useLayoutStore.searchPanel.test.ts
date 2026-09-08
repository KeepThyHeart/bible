/**
 * `openSearchResultsPanel` against a REAL `DockviewComponent` in jsdom.
 *
 * Same reasoning as `services/__tests__/layoutPresetIntegration.test.ts`: every
 * interesting behaviour here is about what dockview actually does with the
 * position we hand it - where a `{ direction: 'below', referencePanel }` panel
 * lands, and (the point of the feature) that focusing an existing panel leaves
 * it exactly where the user dragged it. A faked API would assert only that we
 * called ourselves correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DockviewComponent } from 'dockview-react';
import { useLayoutStore, type PanelContentType } from './useLayoutStore';

class ResizeObserverStub {
  observe(): void { /* jsdom has no layout engine */ }
  unobserve(): void { /* noop */ }
  disconnect(): void { /* noop */ }
}

function createDockview(): DockviewComponent {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const dv = new DockviewComponent(el, {
    createComponent: () => ({
      element: document.createElement('div'),
      init: () => undefined,
      dispose: () => undefined,
    }),
  });
  dv.layout(1000, 1000);
  return dv;
}

/** Add a panel the way `DockviewLayout` does, and register it with the store. */
function seedPanel(
  dv: DockviewComponent,
  id: string,
  contentType: PanelContentType,
  title: string,
  position?: Record<string, unknown>,
): void {
  dv.api.addPanel({
    id,
    component: 'panelContent',
    title,
    params: { contentType },
    ...(position ? { position: position as never } : {}),
  });
  useLayoutStore.getState().registerPanel({ panelId: id, contentType, displayName: title });
}

interface GridNode {
  type: string;
  data: GridNode[] | { views?: string[] };
}

/**
 * The panel ids sharing a branch with `panelId` - i.e. the panes it was split
 * against. Read off `toJSON()` because jsdom reports every element at offset 0,
 * so geometry cannot say which pane a new one was stacked under.
 */
function splitSiblingIds(dv: DockviewComponent, panelId: string): string[] {
  const root = (dv.api.toJSON().grid as unknown as { root: GridNode }).root;
  const findParent = (node: GridNode, parent: GridNode | null): GridNode | null => {
    if (node.type === 'leaf') {
      const views = (node.data as { views?: string[] }).views ?? [];
      return views.includes(panelId) ? parent : null;
    }
    for (const child of node.data as GridNode[]) {
      const found = findParent(child, node);
      if (found) return found;
    }
    return null;
  };
  const parent = findParent(root, null);
  if (!parent) return [];
  return (parent.data as GridNode[]).flatMap(child =>
    child.type === 'leaf' ? ((child.data as { views?: string[] }).views ?? []) : [],
  );
}

let dockview: DockviewComponent;

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  dockview = createDockview();
  useLayoutStore.setState({
    panels: new Map(),
    collapsedGroups: [],
    activePanelId: null,
    lastActiveBiblePanelId: null,
  });
  useLayoutStore.getState().setDockviewApi(dockview.api);
});

afterEach(() => {
  useLayoutStore.setState({
    dockviewApi: null,
    isReady: false,
    collapsedGroups: [],
    panels: new Map(),
    activePanelId: null,
    lastActiveBiblePanelId: null,
  });
  dockview.dispose();
});

describe('openSearchResultsPanel', () => {
  it('splits the last-active Bible panel top/bottom with results below', () => {
    seedPanel(dockview, 'bible_a', 'bible', 'Bible');
    seedPanel(dockview, 'study_a', 'study', 'Study', { direction: 'right', referencePanel: 'bible_a' });
    useLayoutStore.getState().setActivePanelId('bible_a');

    const searchId = useLayoutStore.getState().openSearchResultsPanel();
    expect(searchId).toBeTruthy();

    const bibleGroup = dockview.api.getPanel('bible_a')!.group;
    const searchGroup = dockview.api.getPanel(searchId!)!.group;

    // Its own group, stacked under the Bible pane - not tabbed into it, and
    // not into the study group on the right.
    expect(searchGroup.id).not.toBe(bibleGroup.id);
    expect(searchGroup.id).not.toBe(dockview.api.getPanel('study_a')!.group.id);
    expect(searchGroup.api.location.type).toBe('grid');
    // Split against the Bible pane, and *after* it in the branch - which is
    // what `direction: 'below'` means once serialized.
    expect(splitSiblingIds(dockview, searchId!)).toEqual(['bible_a', searchId]);
  });

  it('targets the Bible pane the user was last reading, not the active panel', () => {
    seedPanel(dockview, 'bible_a', 'bible', 'Bible');
    seedPanel(dockview, 'bible_b', 'bible', 'Bible', { direction: 'right', referencePanel: 'bible_a' });
    // The user read pane B, then clicked into the search bar (which lives
    // outside dockview and never becomes the active panel).
    useLayoutStore.getState().setActivePanelId('bible_b');

    const searchId = useLayoutStore.getState().openSearchResultsPanel()!;

    const siblings = splitSiblingIds(dockview, searchId);
    expect(siblings).toContain('bible_b');
    expect(siblings).not.toContain('bible_a');
  });

  it('creates the panel with the generic English title', () => {
    seedPanel(dockview, 'bible_a', 'bible', 'Bible');
    const searchId = useLayoutStore.getState().openSearchResultsPanel();
    expect(dockview.api.getPanel(searchId!)!.title).toBe('Search');
  });

  it('focuses the existing panel instead of creating a second one', () => {
    seedPanel(dockview, 'bible_a', 'bible', 'Bible');
    const first = useLayoutStore.getState().openSearchResultsPanel();
    dockview.api.getPanel('bible_a')!.api.setActive();

    const second = useLayoutStore.getState().openSearchResultsPanel();

    expect(second).toBe(first);
    expect(dockview.api.panels.filter(p => p.id.startsWith('search'))).toHaveLength(1);
    expect(dockview.api.activePanel?.id).toBe(first);
  });

  it('leaves a relocated search panel where the user dragged it', () => {
    seedPanel(dockview, 'bible_a', 'bible', 'Bible');
    seedPanel(dockview, 'study_a', 'study', 'Study', { direction: 'right', referencePanel: 'bible_a' });
    const searchId = useLayoutStore.getState().openSearchResultsPanel()!;

    // Stand in for the drag: move the panel into the study group.
    const studyGroup = dockview.api.getPanel('study_a')!.group;
    dockview.api.getPanel(searchId)!.api.moveTo({ group: studyGroup });
    expect(dockview.api.getPanel(searchId)!.group.id).toBe(studyGroup.id);

    // A brand-new search must reuse it in place - this is the whole of
    // "the app remembers where I put the search results".
    const again = useLayoutStore.getState().openSearchResultsPanel();

    expect(again).toBe(searchId);
    expect(dockview.api.getPanel(searchId)!.group.id).toBe(studyGroup.id);
    expect(dockview.api.panels.filter(p => p.id.startsWith('search'))).toHaveLength(1);
  });

  it('re-creates the panel at the default position after it is closed', () => {
    seedPanel(dockview, 'bible_a', 'bible', 'Bible');
    const first = useLayoutStore.getState().openSearchResultsPanel()!;

    dockview.api.getPanel(first)!.api.close();
    useLayoutStore.getState().unregisterPanel(first);
    expect(dockview.api.getPanel(first)).toBeUndefined();

    const second = useLayoutStore.getState().openSearchResultsPanel();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(dockview.api.getPanel(second!)!.group.id)
      .not.toBe(dockview.api.getPanel('bible_a')!.group.id);
  });

  it('falls back to dockview default placement when no Bible pane is open', () => {
    seedPanel(dockview, 'notes_a', 'notes', 'Notes');

    const searchId = useLayoutStore.getState().openSearchResultsPanel();

    expect(searchId).toBeTruthy();
    // Nothing to split against, so it joins the active group rather than
    // vanishing or throwing.
    expect(dockview.api.getPanel(searchId!)!.group.id)
      .toBe(dockview.api.getPanel('notes_a')!.group.id);
  });

  it('returns null when dockview is not ready', () => {
    useLayoutStore.setState({ dockviewApi: null });
    expect(useLayoutStore.getState().openSearchResultsPanel()).toBeNull();
  });
});
