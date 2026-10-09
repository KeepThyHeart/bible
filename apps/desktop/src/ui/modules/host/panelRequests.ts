/**
 * Asking a feature module's panel to do something from host code (desktop):
 * "show this panel, studying X". Entry-chunk code; it knows nothing about any
 * feature, only panel type ids.
 *
 * `requestPanel` hands the request to the handler the panel's module registered
 * while it was active; if the module's code has not loaded yet the request waits
 * and `onPanel:<type>` is fired, so the module activates, registers its handler
 * and receives it. `usePanelAvailable` is for host buttons that exist only while
 * the module is on.
 */
import { useSyncExternalStore } from 'react';
import type { IDisposable } from '../../types/Command';
import { fireActivation, modulePoints } from '../moduleHost';

export type PanelRequestHandler = (request: unknown) => void;

const handlers = new Map<string, PanelRequestHandler>();
const pending = new Map<string, unknown>();

/** Module side: take requests for a panel type. Delivers one that arrived before the module was active. */
export function registerPanelRequestHandler(panelType: string, handler: PanelRequestHandler): IDisposable {
  handlers.set(panelType, handler);
  if (pending.has(panelType)) {
    const request = pending.get(panelType);
    pending.delete(panelType);
    handler(request);
  }
  return {
    dispose() {
      if (handlers.get(panelType) === handler) handlers.delete(panelType);
    },
  };
}

/** Host side: show the panel of a type, handing it a request. Does nothing visible when its module is off. */
export function requestPanel(panelType: string, request?: unknown): void {
  const handler = handlers.get(panelType);
  if (handler) {
    handler(request);
    return;
  }
  if (!modulePoints.panelTypes.has(panelType)) return;
  pending.set(panelType, request);
  fireActivation(`onPanel:${panelType}`);
}

/** Whether a panel type is registered right now (its module is on). Re-renders when a module is switched on or off. */
export function usePanelAvailable(panelType: string): boolean {
  useSyncExternalStore(
    (cb) => modulePoints.panelTypes.subscribe(cb),
    () => modulePoints.panelTypes.getSnapshot(),
  );
  return modulePoints.panelTypes.has(panelType);
}
