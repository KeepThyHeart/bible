/**
 * React hook that bridges `postMessage` between an extension iframe and the
 * host renderer.
 *
 * The iframe runs `@bible/extension-ui` which sends `RpcRequest` envelopes
 * via `window.parent.postMessage`. This hook:
 *
 *   1. Listens for `message` events on the window.
 *   2. Validates the sender is the expected iframe (origin check).
 *   3. Dispatches recognised RPC methods (navigate, popup, theme).
 *   4. Sends `RpcResponse` / `RpcEvent` envelopes back to the iframe.
 *
 * The hook intentionally handles a small, fixed set of renderer-side
 * methods. Extension business logic goes through the worker's RPC channel,
 * not through the iframe bridge.
 */

import { useEffect, useCallback } from 'react';
import { useBibleStore } from '../../stores/useBibleStore';
import { usePreferencesStore } from '../../stores/usePreferencesStore';

// -- Inlined envelope types (kept in sync with @bible/core RpcEnvelope) ---

interface RpcRequest {
  kind: 'request';
  id: string;
  method: string;
  args: unknown[];
}

interface RpcResponse {
  kind: 'response';
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
}

interface RpcEvent {
  kind: 'event';
  channel: string;
  payload: unknown;
}

function isRpcRequest(v: unknown): v is RpcRequest {
  return typeof v === 'object' && v !== null && (v as { kind?: string }).kind === 'request';
}

// -- Hook -----------------------------------------------------------------

interface UseIframeBridgeOpts {
  extensionId: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

export function useIframeBridge({ extensionId, iframeRef }: UseIframeBridgeOpts): void {
  const sendToIframe = useCallback((envelope: RpcResponse | RpcEvent) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    // Post to the iframe's origin. Because `sandbox` strips same-origin,
    // the iframe's actual origin is opaque ('null'). We must use '*' as
    // the target origin. Security is enforced by validating the *source*
    // of incoming messages, not the target of outgoing ones.
    iframe.contentWindow.postMessage(envelope, '*');
  }, [iframeRef]);

  // -- Handle incoming requests from the iframe -------------------------

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Because the iframe has sandbox="allow-scripts" without
      // allow-same-origin, its origin is 'null'. We can't do a strict
      // origin check. Instead, verify the source is our iframe's window.
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isRpcRequest(event.data)) return;

      const req = event.data;
      handleRequest(req, extensionId).then(
        (result) => {
          sendToIframe({ kind: 'response', id: req.id, result });
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          sendToIframe({
            kind: 'response',
            id: req.id,
            error: { code: 'BridgeError', message },
          });
        },
      );
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [sendToIframe, iframeRef, extensionId]);

  // -- Forward host events to the iframe --------------------------------

  // Theme changes.
  useEffect(() => {
    let prevTheme = usePreferencesStore.getState().theme; // allow-getstate: effect/init - read latest theme snapshot
    const unsub = usePreferencesStore.subscribe((state) => {
      if (state.theme !== prevTheme) {
        prevTheme = state.theme;
        sendToIframe({
          kind: 'event',
          channel: 'theme.changed',
          payload: { mode: state.theme },
        });
      }
    });
    return unsub;
  }, [sendToIframe]);
}

// -- Request dispatch -----------------------------------------------------

async function handleRequest(req: RpcRequest, extensionId: string): Promise<unknown> {
  switch (req.method) {
    case 'network.fetch': {
      // The iframe's CSP does not allow it to reach any remote host
      // directly, so this is its only egress. Note that
      // `extensionId` comes from the closure that mounted *this* iframe - the
      // request payload never names an extension, so a panel cannot ask to
      // spend another extension's network grant.
      const url = req.args[0];
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error('network.fetch: url must be a non-empty string');
      }
      const init = req.args[1];
      if (init !== undefined && (typeof init !== 'object' || init === null)) {
        throw new Error('network.fetch: init must be an object when provided');
      }
      const uiFetch = (
        window as unknown as {
          electron?: {
            extensions?: {
              uiFetch?: (id: string, url: string, init?: unknown) => Promise<unknown>;
            };
          };
        }
      ).electron?.extensions?.uiFetch;
      if (!uiFetch) {
        throw new Error('network.fetch: extensions:uiFetch IPC is not available');
      }
      return uiFetch(extensionId, url, init);
    }

    case 'bible.navigateToVerse': {
      const verseId = req.args[0];
      if (typeof verseId !== 'number') throw new Error('verseId must be a number');
      useBibleStore.getState().navigateToVerseInPrimary(verseId); // allow-getstate: event handler - imperative navigation, no subscription needed
      return undefined;
    }

    case 'ui.getTheme': {
      const theme = usePreferencesStore.getState().theme; // allow-getstate: effect/init - read latest theme snapshot
      return { mode: theme };
    }

    case 'ui.showVersePopup': {
      // Future: wire to the host's verse popup overlay.
      // For now, accept silently - the host decides whether to show.
      return undefined;
    }

    case 'ui.hideVersePopup': {
      return undefined;
    }

    default:
      throw new Error(`Unknown iframe bridge method: ${req.method}`);
  }
}
