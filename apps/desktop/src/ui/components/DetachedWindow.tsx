import React, { useState, useEffect, useRef } from 'react';
import { i18nService } from '../services/I18nService';
import BiblePane from './BiblePane';
import CommentaryPane from './CommentaryPane';
import BookPane from './BookPane';
import UserNotesPane from './notes/UserNotesPane';
import PrayerTab from './notes/tabs/PrayerTab';
import StudyPane from './StudyPane';
import TopicsPane from './TopicsPane';
import ExtensionPanelHost from './extensions/ExtensionPanelHost';
import { useBibleStore } from '../stores/useBibleStore';
import { DEFAULT_PANEL_ID } from '../stores/helpers/panelStateHelpers';
import { PANE_NAME_KEYS, type NamedPaneType } from '../utils/paneNames';

/**
 * Component map - maps component names to actual components
 *
 * This allows the WindowManager to specify which component to render
 * without needing to know React implementation details.
 *
 * Every `component` value in `electron/config/paneConfig.ts` must appear as a
 * key here - a pane type whose component is missing renders the "Unknown
 * component" error screen instead of the pane. `paneConfig.test.ts` asserts the
 * two sides agree.
 */
export const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
  BiblePane: BiblePane,
  CommentaryPane: CommentaryPane,
  // No `DictionaryPane` entry: a dictionary is detached as a Books window
  // (`POP_OUT_PANE_TYPE` in DockviewTabRenderer, and `popOutModuleToWindow`, both
  // send it there), because `BookPane` is the component behind both kinds.
  // `paneKind` in the payload is what makes it a dictionary window.
  BookPane: BookPane,
  UserNotesPane: UserNotesPane,
  PrayerTab: PrayerTab,
  StudyPane: StudyPane,
  TopicsPane: TopicsPane,
  // Every extension panel detaches into this one component - the panel is an
  // iframe on the extension's own origin, so the host has nothing type-
  // specific to render. `extensionId` and `panelTypeId` arrive as props from
  // the detach payload.
  //
  // The load-bearing detail is on the *main* side: `registerExtUiProtocol`
  // takes a session, and a detached BrowserWindow gets its own. Without the
  // handler registered on that session the iframe loads nothing and fails
  // silently. See `WindowManager`.
  ExtensionPanelHost: ExtensionPanelHost,
};

export interface InitializePanePayload {
  paneType: string;
  /** Window title computed by the main process, when it supplies one. */
  title?: string;
  windowId: string;
  componentName?: string;
  state?: unknown;
}

/**
 * The title this pane's window should carry, e.g. "John 4" or "Study".
 *
 * The native window title is set by the main process from `paneConfig`; the
 * page's own `document.title` is what a screen reader, the task switcher and
 * automation read, and it used to stay at the generic "Detached Pane". The
 * main process may hand its title over as `payload.title`; otherwise it is
 * derived from what the pane was given, falling back to the pane's name.
 */
export function detachedPaneTitle(payload: InitializePanePayload): string | undefined {
  if (payload.title) return payload.title;
  const st = (payload.state && typeof payload.state === 'object' ? payload.state : {}) as Record<string, any>;
  const passage = st.currentBookName && st.currentChapter ? `${st.currentBookName} ${st.currentChapter}` : undefined;
  const named = passage ?? st.verseName ?? st.topicName ?? st.noteName;
  if (typeof named === 'string' && named) return named;
  const key = payload.paneType in PANE_NAME_KEYS ? PANE_NAME_KEYS[payload.paneType as NamedPaneType] : undefined;
  const name = key ? i18nService.t(key) : undefined;
  return name && name !== key ? name : undefined;
}

/**
 * Detached Window Component
 *
 * This is the root component for all detached windows.
 * It receives initialization data via IPC and renders the appropriate pane component.
 *
 * Lives in its own module (rather than inline in `detached.tsx`) so it can be
 * rendered in tests - `detached.tsx` calls `ReactDOM.createRoot` at module
 * scope, which makes it unimportable.
 */
export function DetachedWindow() {
  const [payload, setPayload] = useState<InitializePanePayload | null>(null);

  useEffect(() => {
    // Listen for initialization from main process
    window.electron.window.onInitializePane((data: InitializePanePayload) => {
      setPayload(data);
    });
  }, []);

  // Keep the page title in step with the pane. The product suffix is whatever
  // follows the first " - " in the HTML's own title, so it stays localized/branded.
  // A Bible window's passage changes as the reader navigates (Next Chapter), and the pane's heading
  // reads this window's own panel state, so the title follows that rather than the handover payload
  // (which is also what the pane was seeded from, so the two cannot disagree once it has loaded).
  const livePassage = useBibleStore((s) => {
    const ps = s.panels.get(DEFAULT_PANEL_ID);
    return ps && ps.openTabs.length > 0 && ps.currentBookName && ps.currentChapter
      ? `${ps.currentBookName} ${ps.currentChapter}`
      : undefined;
  });
  const suffixRef = useRef<string | null>(null);
  const isBible = payload?.paneType === 'bible' || (payload?.componentName ?? 'BiblePane') === 'BiblePane';

  useEffect(() => {
    if (!payload) return;
    const title = (isBible ? livePassage : undefined) ?? detachedPaneTitle(payload);
    if (!title) return;
    // Read the suffix once: after the first write the title uses an em dash, not " - ".
    if (suffixRef.current === null) {
      suffixRef.current = document.title.includes(' - ') ? document.title.split(' - ').slice(1).join(' - ') : '';
    }
    const suffix = suffixRef.current;
    document.title = suffix ? `${title} \u2014 ${suffix}` : title;
  }, [payload, isBible, livePassage]);

  // Loading state.
  //
  // Gated on the payload's arrival alone, not on a truthy `state`: any pane
  // popped out without serialized state (Books, Dictionary, and Notes with no
  // saved nav state all hand over `{}` or nothing) must render empty rather
  // than park on this screen forever.
  if (!payload) {
    return (
      <div
        data-testid="detached-loading"
        className="flex items-center justify-center h-screen bg-background-secondary"
      >
        <div className="text-center">
          <div className="text-lg font-semibold text-text-primary mb-2">{i18nService.t('detachedWindow.loadingPane')}</div>
          <div className="text-sm text-text-secondary">{i18nService.t('detachedWindow.initializing')}</div>
        </div>
      </div>
    );
  }

  // Component name comes directly from the initialization data
  // (set by WindowManager based on paneConfig).
  const componentName = payload.componentName || 'BiblePane';
  const Component = COMPONENT_MAP[componentName];

  if (!Component) {
    return (
      <div
        data-testid="detached-error"
        className="flex items-center justify-center h-screen bg-background-secondary"
      >
        <div className="text-center">
          <div className="text-lg font-semibold text-red-600 mb-2">{i18nService.t('detachedWindow.error')}</div>
          <div className="text-sm text-text-secondary">
            {i18nService.t('detachedWindow.unknownComponent', { v1: componentName })}
          </div>
        </div>
      </div>
    );
  }

  // Spread the handed-over state as props. `isDetached` tells the pane to seed
  // itself from those props rather than from the (empty) store in this window.
  const paneState = (payload.state && typeof payload.state === 'object') ? payload.state : {};

  return (
    <div className="h-screen" data-testid="detached-pane" data-pane-type={payload.paneType}>
      <Component {...paneState} isDetached={true} windowId={payload.windowId} />
    </div>
  );
}

export default DetachedWindow;
