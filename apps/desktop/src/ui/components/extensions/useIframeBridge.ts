/**
 * React hook that bridges `postMessage` between an extension iframe and the
 * host renderer.
 *
 * The iframe runs `@bible/extension-ui` which sends `RpcRequest` envelopes
 * via `window.parent.postMessage`. The transport, source check, envelope
 * validation, deny-by-default `uikit.*` allowlist and error mapping live in
 * `IframeRpcBridge` (`@bible/core/browser`), shared with the web app, and the
 * iframe plus the bridge lifecycle live in `ExtensionPanelHost` (`@bible/ui`).
 * `useDesktopBridgeParts` supplies what is desktop-specific:
 *
 *   1. the handler map (IPC, Zustand stores, iframe geometry);
 *   2. the host-assembled context (identity from mount props, manifest/grants
 *      from `getAccess`), never from anything the iframe says;
 *   3. host -> panel pushes (worker messages, theme, active verse).
 *
 * The hook intentionally handles a small, fixed set of renderer-side
 * methods. Extension business logic goes through the worker's RPC channel,
 * not through the iframe bridge.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  IframeRpcBridge,
  directionForTag,
  type BridgeContext,
  type BridgeHandlers,
} from '@bible/core/browser';
import { useBibleStore } from '../../stores/useBibleStore';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { subscribeToPanelMessages, useExtensionUiStore } from '../../extensions/extensionUiStore';
import { subscribeActiveVerseBroadcast } from '../../extensions/activeVerseBroadcast';

// -- Hooks ----------------------------------------------------------------

/** What the host knows about the extension that owns the panel (from main, not the iframe). */
export interface PanelAccess {
  manifest: BridgeContext['manifest'];
  grants: BridgeContext['grants'];
}

interface UseIframeBridgeOpts {
  extensionId: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /**
   * Identifies the panel to its worker. Optional so callers that only need
   * navigation and theme (and the existing tests) keep working; without it
   * `panel.invoke` refuses rather than guessing an identity.
   */
  panelId?: string;
  panelTypeId?: string;
  /**
   * Manifest (`uiKit`) and granted permissions of the owning extension, read
   * once per request. Absent or `manifest: null` means no `uikit.*` method is
   * allowed.
   */
  getAccess?: () => PanelAccess;
  /** Current UI locale tag for `ui.getLocale`. Defaults to `'en'` when absent. */
  getLocale?: () => string;
}

const NO_ACCESS: PanelAccess = { manifest: null, grants: [] };

/**
 * The desktop-specific pieces of a panel bridge, for a host that owns the
 * iframe and the `IframeRpcBridge` itself (the shared `ExtensionPanelHost` in
 * `@bible/ui`): pass `context`, `handlers` and `onBridge` straight through.
 * All three are referentially stable across renders.
 *
 * `onBridge(bridge)` starts the host -> panel pushes (worker messages, theme,
 * active verse) and `onBridge(null)` stops them; the pushes use the identity
 * from the latest props.
 */
export interface DesktopBridgeParts {
  context: () => BridgeContext;
  handlers: BridgeHandlers;
  onBridge: (bridge: IframeRpcBridge | null) => void;
}

export function useDesktopBridgeParts({
  extensionId,
  iframeRef,
  panelId,
  panelTypeId,
  getAccess,
  getLocale,
}: UseIframeBridgeOpts): DesktopBridgeParts {
  // Latest-callback refs: the parts are created once, not per render.
  const identityRef = useRef({ extensionId, panelId, panelTypeId });
  identityRef.current = { extensionId, panelId, panelTypeId };
  const getAccessRef = useRef(getAccess);
  getAccessRef.current = getAccess;
  const getLocaleRef = useRef(getLocale);
  getLocaleRef.current = getLocale;
  const teardownRef = useRef<(() => void) | null>(null);

  const context = useCallback((): BridgeContext => {
    const access = getAccessRef.current?.() ?? NO_ACCESS;
    const { extensionId: id, panelId: pId, panelTypeId: ptId } = identityRef.current;
    return { extensionId: id, panelId: pId, panelTypeId: ptId, manifest: access.manifest, grants: access.grants };
  }, []);

  const handlers = useMemo(
    () => createHandlers(iframeRef, () => getLocaleRef.current?.() ?? 'en'),
    [iframeRef],
  );

  const onBridge = useCallback((bridge: IframeRpcBridge | null) => {
    teardownRef.current?.();
    teardownRef.current = null;
    if (!bridge) return;

    // -- Worker -> panel pushes -----------------------------------------

    // `api.panels.postMessage(...)` in the worker arrives here as a renderer
    // notification. Deliver it only to iframes this extension owns, and only to
    // the addressed panel when the worker named one.
    const unsubPanelMessages = subscribeToPanelMessages((msg) => {
      const { extensionId: id, panelId: pId } = identityRef.current;
      if (msg.extensionId !== id) return;
      if (msg.panelId !== undefined && msg.panelId !== pId) return;
      bridge.emit('panel.message', msg.message);
    });

    // -- Forward host events to the iframe ------------------------------

    // Theme changes.
    let prevTheme = usePreferencesStore.getState().theme; // allow-getstate: effect/init - read latest theme snapshot
    const unsubTheme = usePreferencesStore.subscribe((state) => {
      if (state.theme !== prevTheme) {
        prevTheme = state.theme;
        bridge.emit('theme.changed', { mode: state.theme });
      }
    });

    // Active-verse changes. `BibleExtUI.onActiveVerseChanged` declared this
    // channel from the start; nothing ever sent it - `useIframeBridge`
    // forwarded only `theme.changed`. See `activeVerseBroadcast.ts` for why
    // this subscribes there rather than to `useBibleStore` directly: it is the
    // same signal a worker extension gets via `verse.activeChanged`
    // (`api.events.subscribe`), published from the same two call sites.
    const unsubActiveVerse = subscribeActiveVerseBroadcast(({ verseId }) => {
      // `source` is reserved for a future finer-grained provenance (click
      // vs. search vs. another extension's navigateToVerse) the host does
      // not yet track - see BibleExtUI.onActiveVerseChanged.
      bridge.emit('verse.activeChanged', { verseId, source: 'host' });
    });

    teardownRef.current = () => {
      unsubPanelMessages();
      unsubTheme();
      unsubActiveVerse();
    };
  }, []);

  // A host unmounting without a final `onBridge(null)` must not leak subscriptions.
  useEffect(
    () => () => {
      teardownRef.current?.();
      teardownRef.current = null;
    },
    [],
  );

  return { context, handlers, onBridge };
}

/**
 * Hook form for a caller that owns its own iframe ref and wants the bridge
 * created here: builds the parts above and one `IframeRpcBridge` per
 * identity. The panel host does not use it (the shared `ExtensionPanelHost`
 * owns the bridge); it stays for callers and tests that drive a bare iframe
 * ref.
 */
export function useIframeBridge(opts: UseIframeBridgeOpts): void {
  const { iframeRef, extensionId, panelId, panelTypeId } = opts;
  const { context, handlers, onBridge } = useDesktopBridgeParts(opts);

  useEffect(() => {
    const bridge = new IframeRpcBridge({
      context,
      handlers,
      hostWindow: window,
      // Read lazily: the iframe mounts after this effect runs (the panel host
      // first renders a loading state), and may be remounted.
      getTarget: () => iframeRef.current?.contentWindow,
    });
    bridge.attach();
    onBridge(bridge);
    return () => {
      bridge.dispose();
      onBridge(null);
    };
  }, [iframeRef, extensionId, panelId, panelTypeId, context, handlers, onBridge]);
}

// -- Request handlers -----------------------------------------------------

/**
 * Desktop handler map. Identity (`extensionId`, `panelId`, `panelTypeId`)
 * always comes from `ctx` - assembled by the panel host from the props it
 * mounted the iframe with - never from the request arguments.
 */
function createHandlers(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  currentLocale: () => string,
): BridgeHandlers {
  return {
    'network.fetch': (args, { extensionId }) => {
      // The iframe's CSP does not allow it to reach any remote host
      // directly, so this is its only egress. Note that
      // `extensionId` comes from the closure that mounted *this* iframe - the
      // request payload never names an extension, so a panel cannot ask to
      // spend another extension's network grant.
      const url = args[0];
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error('network.fetch: url must be a non-empty string');
      }
      const init = args[1];
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
    },

    'panel.invoke': (args, { extensionId, panelId, panelTypeId }) => {
      // The panel's only route to its own extension's API surface. It carries
      // exactly one thing from the iframe - the message - and three things
      // from the closure that mounted it. That split is the security
      // property: `network.fetch` above works the same way, and for the same
      // reason. A panel that could name an extension could spend another
      // extension's grants.
      if (!panelId || !panelTypeId) {
        throw new Error(
          'panel.invoke: this panel was mounted without an identity, so it ' +
            'cannot address its worker',
        );
      }
      const panelInvoke = (
        window as unknown as {
          electron?: {
            extensions?: {
              panelInvoke?: (
                extensionId: string,
                panelId: string,
                panelTypeId: string,
                message: unknown,
              ) => Promise<unknown>;
            };
          };
        }
      ).electron?.extensions?.panelInvoke;
      if (!panelInvoke) {
        throw new Error('panel.invoke: extensions:panelInvoke IPC is not available');
      }
      return panelInvoke(extensionId, panelId, panelTypeId, args[0]);
    },

    'bible.navigateToVerse': (args) => {
      const verseId = args[0];
      if (typeof verseId !== 'number') throw new Error('verseId must be a number');
      useBibleStore.getState().navigateToVerseInPrimary(verseId); // allow-getstate: event handler - imperative navigation, no subscription needed
      return undefined;
    },

    'ui.getTheme': () => {
      const theme = usePreferencesStore.getState().theme; // allow-getstate: effect/init - read latest theme snapshot
      return { mode: theme };
    },

    // Read-only, un-gated: the UI locale is not user data. Lets kit components
    // and panels pick book names / direction without app i18n.
    'ui.getLocale': () => {
      const locale = currentLocale();
      return { locale, direction: directionForTag(locale) };
    },

    'ui.showVersePopup': (args, ctx) => {
      const verseId = args[0];
      const rect = args[1] as
        | { x: number; y: number; width: number; height: number }
        | undefined;
      if (typeof verseId !== 'number' || !rect) return undefined; // best-effort, per the SDK's own contract
      const iframeEl = iframeRef.current;
      if (!iframeEl) return undefined; // iframe unmounted mid-flight; nothing to anchor to
      // `rect` is relative to the iframe's own document. Translate into host
      // page coordinates via the iframe element's own rect, then hand off to
      // the same VersePreviewTooltip the host's built-in verse hovers use -
      // see ExtensionUiHost.tsx.
      const iframeRect = iframeEl.getBoundingClientRect();
      useExtensionUiStore.getState().showVersePopup(ctx.extensionId, verseId, {
        x: iframeRect.left + rect.x,
        y: iframeRect.top + rect.y + rect.height,
      });
      return undefined;
    },

    'ui.hideVersePopup': () => {
      useExtensionUiStore.getState().hideVersePopup();
      return undefined;
    },
  };
}
