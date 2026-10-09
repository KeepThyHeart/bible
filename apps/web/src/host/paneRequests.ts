/**
 * Opening a right pane (desktop) or full-screen phone view from anywhere in the
 * host, optionally handing it a request (a Strong's number to study). Entry-chunk
 * code: it imports only the event bus.
 *
 * `openPane` shows and expands the pane through the existing `pane:show` and
 * `pane:expand` events and tells the phone layout through `pane:open`. A
 * request is delivered to the handler the pane's module registered while it
 * was active; if the module's code has not loaded yet, the request waits (the
 * pane opening activates the module, which registers its handler).
 */
import { eventBus } from '../events/eventBus';

export type PaneRequestHandler = (request: unknown) => void;

const handlers = new Map<string, PaneRequestHandler>();
const pending = new Map<string, unknown>();

/** Module side: take requests for a pane. Delivers one that arrived before the module was active. Dispose to stop. */
export function registerPaneRequestHandler(paneId: string, handler: PaneRequestHandler): { dispose(): void } {
  handlers.set(paneId, handler);
  if (pending.has(paneId)) {
    const request = pending.get(paneId);
    pending.delete(paneId);
    handler(request);
  }
  return {
    dispose() {
      if (handlers.get(paneId) === handler) handlers.delete(paneId);
    },
  };
}

/** Show a pane (right pane on desktop, full-screen view on the phone), optionally starting something in it. */
export function openPane(paneId: string, request?: unknown): void {
  if (request !== undefined) {
    const handler = handlers.get(paneId);
    if (handler) handler(request);
    else pending.set(paneId, request);
  }
  eventBus.emit('pane:show', { paneId });
  eventBus.emit('pane:expand');
  eventBus.emit('pane:open', { paneId });
}
