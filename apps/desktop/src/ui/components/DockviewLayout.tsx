import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
  DockviewReact,
  DockviewReadyEvent,
  DockviewApi,
  themeLight,
  type IDockviewPanelProps,
  type SerializedDockview,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import PanelContentRenderer from './PanelContentRenderer';
import DockviewTabRenderer from './DockviewTabRenderer';
import DockviewHeaderActions from './DockviewHeaderActions';
import DockviewWatermark from './DockviewWatermark';
import CollapsedPanesRevealBar from './CollapsedPanesRevealBar';
import AdvancedPaneManagerGateDialog from './AdvancedPaneManagerGateDialog';
import { useLayoutStore, type PanelContentType } from '../stores/useLayoutStore';
import { destroyPanelState } from '../stores/helpers/panelDisposal';
import { layoutPresetService } from '../commands/layoutCommands';
import { useSessionStore } from '../stores/useSessionStore';
import { useBibleStore } from '../stores/useBibleStore';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { zeroSizedGroupIds } from '../services/PresetApplier';
import { sanitizeDockviewState, type LayoutRepairLogEntry } from '../services/LayoutStateSanitizer';
import { exceedsDragThreshold, gateDragEvent } from '../services/AdvancedPaneManagerGate';

/**
 * Recreate the Bible panels that a restored session describes but the layout
 * does not contain.
 *
 * Before the tab restructure a single Bible panel held several passages as
 * sub-tabs; those passages are now top-level panels, so an upgrading user's
 * extra passages have to be materialised here rather than restored by dockview.
 * Each one docks into the group of an existing Bible panel so passages stay
 * together instead of scattering across the workbench.
 */
function flushPendingBiblePanels(api: DockviewApi): void {
  // allow-getstate: dockview event callback - runs outside React render
  const pending = useBibleStore.getState().takePendingPanelCreations();
  if (pending.length === 0) return;

  const existingBible = api.panels.find(
    p => (p.params as { contentType?: string } | undefined)?.contentType === 'bible'
  );
  const position = existingBible?.group
    ? { referenceGroup: existingBible.group, direction: 'within' }
    : undefined;

  for (const panel of pending) {
    // No contentKey: the passage itself is staged in the Bible store under this
    // panel id, and is richer than a contentKey can express (history, toggles).
    const created = useLayoutStore.getState().addPanel( // allow-getstate: dockview event callback - runs outside React render
      'bible', undefined, panel.title, position, panel.subtitle, panel.panelId
    );
    if (!created) {
      console.error('[DockviewLayout] Could not recreate restored Bible panel', panel.panelId);
    }
  }
}

/**
 * Log what `sanitizeDockviewState` repaired or dropped, so a report of a blank
 * pane on startup is diagnosable in the field. Uses `window.electron.log` when
 * available (packaged app / e2e), falling back to `console.warn` (unit tests,
 * or a sandboxed preload where the log bridge failed to attach).
 */
function logLayoutRepairs(repairs: LayoutRepairLogEntry[]): void {
  if (repairs.length === 0) return;
  const summary = repairs
    .map(r => `${r.panelId}: ${r.action}${r.contentType ? ` -> ${r.contentType}` : ''}${r.viaPanelIdInference ? ' (inferred from id)' : ''}`)
    .join('; ');
  const message = `[DockviewLayout] Repaired saved layout (historical layout-preset bug recovery): ${summary}`;
  if (window.electron?.log?.warn) {
    window.electron.log.warn(message);
  } else {
    console.warn(message);
  }
}

/**
 * Component registry for dockview.
 * Maps component IDs (used in addPanel calls) to React components.
 */
const components: Record<string, React.FC<IDockviewPanelProps<any>>> = {
  panelContent: PanelContentRenderer,
};

/**
 * First-run layout (used whenever there is no saved dockview state):
 * Bible on the left, Study + Commentary + Dictionary tabs on the right,
 * split 50/50.
 *
 * Only the panes that are immediately useful are opened, and Dictionary is one
 * of them: looking a word up is a core Bible-study gesture, and clicking a
 * Strong's number is the app's most common route out of the Bible text. It used
 * to have no slot of its own, so that click had to *create* a pane - one
 * labelled "Books", a surface most readers never open deliberately - and the
 * lexicon arrived in a pane named after a feature they had never opened. Books
 * and Notes do stay
 * one click away via the "+" menu; opening every pane here just produced a row
 * of empty tabs on first launch. The named layout presets in ../presets are
 * unaffected; they're applied only on explicit user choice.
 */
function createDefaultLayout(api: DockviewApi): void {
  const store = useLayoutStore.getState(); // allow-getstate: event handler - imperative store access outside render

  // Create Bible panel (left group)
  const biblePanel = api.addPanel({
    id: 'bible_default',
    component: 'panelContent',
    title: 'Bible',
    params: { contentType: 'bible' as PanelContentType },
  });

  store.registerPanel({
    panelId: 'bible_default',
    contentType: 'bible',
    displayName: 'Bible',
  });

  // Create Study panel (right group, split to the right - first tab).
  // Dockview distributes the split evenly, giving the Bible pane half the
  // workbench width.
  const studyPanel = api.addPanel({
    id: 'study_default',
    component: 'panelContent',
    title: 'Study',
    params: { contentType: 'study' as PanelContentType },
    position: {
      direction: 'right',
      referencePanel: biblePanel,
    },
  });

  store.registerPanel({
    panelId: 'study_default',
    contentType: 'study',
    displayName: 'Study',
  });

  // Create Commentary panel (tab within the right group alongside Study)
  api.addPanel({
    id: 'commentary_default',
    component: 'panelContent',
    title: 'Commentary',
    params: { contentType: 'commentary' as PanelContentType },
    position: {
      referenceGroup: studyPanel.group,
      direction: 'within',
    },
  });

  store.registerPanel({
    panelId: 'commentary_default',
    contentType: 'commentary',
    displayName: 'Commentary',
  });

  // Create Dictionary panel (tab within the right group). Same content type
  // the "+" menu and the Study Mode preset use, so a Strong's-number click
  // finds a real pane rather than conjuring one (see `revealDictionaryPanel`).
  api.addPanel({
    id: 'dictionary_default',
    component: 'panelContent',
    title: 'Dictionary',
    params: { contentType: 'dictionary' as PanelContentType },
    position: {
      referenceGroup: studyPanel.group,
      direction: 'within',
    },
  });

  store.registerPanel({
    panelId: 'dictionary_default',
    contentType: 'dictionary',
    displayName: 'Dictionary',
  });

  // Activate the Study panel as the default visible tab in the right group
  studyPanel.api.setActive();
}

interface DockviewLayoutProps {
  /** Serialized layout to restore (from session data) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  savedLayout?: Record<string, any> | null;
}

/**
 * Main dockview layout wrapper.
 *
 * Handles:
 * - Initializing dockview with default or saved layout
 * - Registering the dockview API in useLayoutStore
 * - Providing component and tab renderers
 * - Tracking panel add/remove for the layout store registry
 */
const DockviewLayout: React.FC<DockviewLayoutProps> = ({ savedLayout }) => {
  const apiRef = useRef<DockviewApi | null>(null);
  const restoredFromSavedRef = useRef(false);
  // Incremented each time onReady fires; drives the layout-init effect.
  const [apiVersion, setApiVersion] = useState(0);

  // Opt-in gate for pane drag-and-drop (KAN QA 4.5). See
  // services/AdvancedPaneManagerGate.ts and AdvancedPaneManagerGateDialog.
  const [showAdvancedGateModal, setShowAdvancedGateModal] = useState(false);

  // Pointer tracking for the gate's movement threshold. dockview starts the
  // native HTML5 drag itself, and the browser's own threshold is only a pixel
  // or two - so the gate needs an origin of its own to measure against.
  const workbenchRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** A drag was canceled below the threshold; keep watching this gesture. */
  const pendingGateRef = useRef(false);

  /**
   * Cancel a gated drag, and decide whether it has earned the modal yet.
   *
   * Sub-threshold drags are canceled silently and *armed*: because the native
   * drag never started, pointermove keeps firing for the same button-down
   * gesture, so the watcher below can raise the dialog the moment the movement
   * becomes deliberate. Without that, an 8px threshold against the browser's
   * ~3px native one would mean the dialog essentially never appeared.
   */
  const handleGatedDrag = useCallback((nativeEvent: DragEvent, cancel: () => void) => {
    const origin = dragOriginRef.current;
    const current = { x: nativeEvent.clientX, y: nativeEvent.clientY };
    const intercepted = gateDragEvent(
      usePreferencesStore.getState().advancedPaneManagerEnabled, // allow-getstate: dockview event callback - runs outside React render
      cancel,
      () => {
        pendingGateRef.current = false;
        setShowAdvancedGateModal(true);
      },
      { origin, current },
    );
    pendingGateRef.current = intercepted && !exceedsDragThreshold(origin, current);
  }, []);

  // Track the pointer for `handleGatedDrag`. Capture phase, because dockview's
  // own tab handlers sit between here and the event target. pointermove/up go
  // on the window: a drag gesture routinely leaves the workbench element.
  useEffect(() => {
    const workbench = workbenchRef.current;
    if (!workbench) return;

    const onPointerDown = (e: PointerEvent) => {
      dragOriginRef.current = { x: e.clientX, y: e.clientY };
      pendingGateRef.current = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pendingGateRef.current) return;
      if (exceedsDragThreshold(dragOriginRef.current, { x: e.clientX, y: e.clientY })) {
        pendingGateRef.current = false;
        setShowAdvancedGateModal(true);
      }
    };
    const endGesture = () => {
      dragOriginRef.current = null;
      pendingGateRef.current = false;
    };

    workbench.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', endGesture, true);
    window.addEventListener('pointercancel', endGesture, true);

    return () => {
      workbench.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', endGesture, true);
      window.removeEventListener('pointercancel', endGesture, true);
    };
  }, []);

  // Reading Mode (the only preset that collapses a group) - drives the
  // vertical reveal bar pinned to the right edge. See CollapsedPanesRevealBar.
  const collapsedGroups = useLayoutStore(s => s.collapsedGroups);
  const expandCollapsedGroups = useLayoutStore(s => s.expandCollapsedGroups);

  // Name the hidden panes when that's cheaply available from dockview's live
  // group data; the bar falls back to a generic label when it isn't (e.g. the
  // group id no longer resolves, which shouldn't happen but isn't fatal).
  const hiddenPaneTitles = useMemo(() => {
    const api = apiRef.current;
    if (!api || collapsedGroups.length === 0) return [];
    const titles: string[] = [];
    for (const { groupId } of collapsedGroups) {
      const group = api.getGroup(groupId);
      if (!group) continue;
      for (const panel of group.panels) {
        if (panel.title) titles.push(panel.title);
      }
    }
    return titles;
  }, [collapsedGroups]);

  // onReady: store the API ref and bump version to trigger the effect.
  // Layout creation is done in the effect (not here) so that React
  // StrictMode remounts work - effects re-run on remount, but onReady
  // may not fire again if dockview skips it on the second instance.
  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    setApiVersion(v => v + 1);
  }, []);

  // Initialize layout when dockview API is ready.
  // Runs when apiVersion changes (new dockview instance) or savedLayout arrives.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    // Store API reference globally
    useLayoutStore.getState().setDockviewApi(api); // allow-getstate: dockview event callback - runs outside React render

    // A new workbench invalidates anything the preset service remembered: its
    // stored arrangements name groups that no longer exist.
    useLayoutStore.getState().setCollapsedGroups([]); // allow-getstate: dockview event callback - runs outside React render
    layoutPresetService.reset();

    // Listen for panel removals to keep registry in sync, and to discard the
    // content state that belonged to the pane.
    //
    // This is the ONLY event that means a pane is really gone. Clearing
    // content stores from a component's unmount cleanup would also fire on an
    // ordinary tab switch inside BookPane, on a StrictMode double-invoke, and
    // whenever a preset rebuilds the grid - deleting open tabs and then
    // autosaving them away. Unmount therefore only *detaches*; the real
    // disposal happens here. See stores/helpers/panelDisposal.ts.
    const removeDisposable = api.onDidRemovePanel((panel) => {
      // Read the content type before unregistering - unregisterPanel drops the
      // registry entry that carries it.
      const contentType = useLayoutStore.getState().getPanel(panel.id)?.contentType; // allow-getstate: dockview event callback - runs outside React render
      destroyPanelState(panel.id, contentType);
      useLayoutStore.getState().unregisterPanel(panel.id); // allow-getstate: dockview event callback - runs outside React render
    });

    // Mark session dirty when layout changes, and tell the preset service a
    // layout change happened so it can drop the "current preset" checkmark
    // once the user manually rearranges things (drag, split, resize). This is
    // deliberately the *same* coarse event markDirty uses - the alternative
    // (narrower events like onDidMovePanel) doesn't cover every way a preset's
    // arrangement can be disturbed. The service itself guards against
    // un-checking the preset it just applied: applying a preset also goes
    // through `api.fromJSON`, which fires this same event, so
    // `LayoutPresetService` sets a re-entrancy flag around its own
    // `apply()`/`undo()` calls and `notifyManualLayoutChange()` is a no-op
    // while that flag is set. See LayoutPresetService.ts.
    const changeDisposable = api.onDidLayoutChange(() => {
      useSessionStore.getState().markDirty(); // allow-getstate: dockview event callback - runs outside React render
      layoutPresetService.notifyManualLayoutChange();
    });

    // Track the active panel so navigation actions (e.g. search) can target
    // whichever Bible pane the user is actually looking at instead of always
    // the first-created one. See useLayoutStore's activePanelId /
    // lastActiveBiblePanelId and sharedSlice.navigateToVerseInPrimary.
    const activePanelDisposable = api.onDidActivePanelChange((panel) => {
      useLayoutStore.getState().setActivePanelId(panel?.id ?? null); // allow-getstate: dockview event callback - runs outside React render
    });

    // Advanced Pane Manager opt-in gate (KAN QA 4.5): dragging a pane is an
    // "advanced" operation off by default. onWillDragPanel/onWillDragGroup
    // fire before the drag visibly starts and are cancelable via
    // event.nativeEvent.preventDefault() - preferred over letting the drag
    // start and rejecting the drop, which is what onWillDrop would mean here.
    // Read the preference fresh from the store on every attempt (not once at
    // effect-setup time) since the user can flip it from Preferences or from
    // the gate dialog itself without a new dockview instance being created.
    // `handleGatedDrag` also applies the movement threshold - see above.
    const willDragPanelDisposable = api.onWillDragPanel((event) => {
      handleGatedDrag(event.nativeEvent, () => event.nativeEvent.preventDefault());
    });
    const willDragGroupDisposable = api.onWillDragGroup((event) => {
      handleGatedDrag(event.nativeEvent, () => event.nativeEvent.preventDefault());
    });
    // Backstop for any drop path that doesn't route through the will-drag
    // events above (e.g. a drag that originated outside dockview's own tab/
    // group handles). Cancels the drop itself rather than the drag start.
    const willDropDisposable = api.onWillDrop((event) => {
      handleGatedDrag(event.nativeEvent, () => event.preventDefault());
    });

    // Create or restore layout (only if this instance has no panels yet)
    if (api.panels.length === 0) {
      if (savedLayout) {
        // Historical-bug recovery: a since-fixed layout-preset bug could leave
        // panels with a corrupted `contentComponent` in saved sessions. Repair
        // (or drop) those before handing the layout to dockview, rather than
        // letting them render as blank panes. See LayoutStateSanitizer.ts -
        // this is a no-op for every layout not affected by that bug.
        const sanitized = sanitizeDockviewState(savedLayout as SerializedDockview);
        logLayoutRepairs(sanitized.repairs);

        if (sanitized.layout === null) {
          console.warn('[DockviewLayout] Saved layout had no recoverable panels after repair; using default layout');
          createDefaultLayout(api);
        } else {
          try {
            api.fromJSON(sanitized.layout);
            for (const panel of api.panels) {
              const params = panel.params as { contentType?: PanelContentType; contentKey?: string } | undefined;
              if (params?.contentType) {
                useLayoutStore.getState().registerPanel({ // allow-getstate: dockview event callback - runs outside React render
                  panelId: panel.id,
                  contentType: params.contentType,
                  contentKey: params.contentKey,
                  displayName: panel.title || params.contentType,
                });
              }
            }
            // A group serialized at zero size was collapsed by Reading Mode. The
            // constraint that let it be zero-width is not part of the
            // serialization, so without this the restored session springs back to
            // dockview's 100px minimum - the sliver Reading Mode exists to avoid.
            const collapsed = zeroSizedGroupIds(sanitized.layout)
              .map(groupId => ({ groupId, axis: 'width' as const }));
            if (collapsed.length > 0) {
              useLayoutStore.getState().restoreCollapsedGroups(collapsed); // allow-getstate: dockview event callback - runs outside React render
            }
            restoredFromSavedRef.current = true;
          } catch (err) {
            console.error('[DockviewLayout] Failed to restore layout, using default:', err);
            createDefaultLayout(api);
          }
        }
      } else {
        createDefaultLayout(api);
      }
    }

    // Session restore stages extra Bible passages for creation. It may finish
    // before or after this effect (a session with no saved dockview state hits
    // the default-layout path immediately), so flush now and stay subscribed.
    flushPendingBiblePanels(api);
    const unsubscribePending = useBibleStore.subscribe((state) => {
      if (state.pendingPanelCreations.length > 0) flushPendingBiblePanels(api);
    });

    return () => {
      unsubscribePending();
      removeDisposable.dispose();
      changeDisposable.dispose();
      activePanelDisposable.dispose();
      willDragPanelDisposable.dispose();
      willDragGroupDisposable.dispose();
      willDropDisposable.dispose();
      // Don't null apiRef.current here. In React StrictMode, the component
      // remounts and onReady may not fire again (dockview reuses its instance).
      // Keeping the ref valid ensures the effect can re-set the store API on remount.
      restoredFromSavedRef.current = false;
      useLayoutStore.setState({ dockviewApi: null, isReady: false, activePanelId: null, lastActiveBiblePanelId: null });
    };
  }, [apiVersion, savedLayout, handleGatedDrag]);

  return (
    /* A flex ROW, not a positioning context for an overlay. The collapsed-panes
       rail is a real sibling of the dockview container so the panes end where
       it begins instead of running underneath it - the same arrangement the web
       app's `.main-layout` uses. `.app-workbench-row` (dockview-overrides.css)
       carries the row itself plus the RTL flip that keeps the rail on the
       physical right edge, which is the only edge dockview's grid ever
       collapses towards. */
    <div ref={workbenchRef} className="app-workbench-row relative w-full h-full flex">
      {/* min-w-0 lets this shrink by the rail's width; without it the flex
          item's min-content floor would push the rail off the edge. */}
      <div className="relative flex-1 min-w-0 h-full">
        <DockviewReact
          theme={themeLight}
          className="dockview-theme-light"
          onReady={onReady}
          components={components}
          defaultTabComponent={DockviewTabRenderer}
          rightHeaderActionsComponent={DockviewHeaderActions}
          watermarkComponent={DockviewWatermark}
        />
      </div>
      {/* Persistent restore affordance for Reading Mode's collapsed study
          group - see CollapsedPanesRevealBar for why this coexists with the
          horizontal "Show hidden panes" button in DockviewHeaderActions. */}
      <CollapsedPanesRevealBar
        collapsedGroups={collapsedGroups}
        hiddenTitles={hiddenPaneTitles}
        onExpand={expandCollapsedGroups}
      />
      {showAdvancedGateModal && (
        <AdvancedPaneManagerGateDialog
          onCancel={() => setShowAdvancedGateModal(false)}
          onConfirm={() => {
            // allow-getstate: event handler - imperative store update, not a render
            usePreferencesStore.getState().setAdvancedPaneManagerEnabled(true);
            setShowAdvancedGateModal(false);
          }}
        />
      )}
    </div>
  );
};

export default DockviewLayout;
