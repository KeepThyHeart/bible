import React, { useState, useEffect } from 'react';
import { i18nService } from '../services/I18nService';
import BiblePane from './BiblePane';
import CommentaryPane from './CommentaryPane';
import BookPane from './BookPane';
import UserNotesPane from './notes/UserNotesPane';
import PrayerTab from './notes/tabs/PrayerTab';
import StudyPane from './StudyPane';
import TopicsPane from './TopicsPane';
import ExtensionPanelHost from './extensions/ExtensionPanelHost';

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
  windowId: string;
  componentName?: string;
  state?: unknown;
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
