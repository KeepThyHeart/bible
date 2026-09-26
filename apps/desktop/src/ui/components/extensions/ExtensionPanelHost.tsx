import React, { useRef } from 'react';
import { ExtensionPanelHost as SharedExtensionPanelHost } from '@bible/ui';
import { useDesktopBridgeParts, type PanelAccess } from './useIframeBridge';
import { useI18n } from '../../contexts/useI18n';

/**
 * Renders an extension-contributed panel inside dockview as a sandboxed
 * iframe loading from the `ext-ui://<extensionId>/<uiEntry>` custom protocol.
 *
 * Important properties:
 *
 *   - The iframe is mounted with `sandbox="allow-scripts allow-forms"` - no
 *     `allow-same-origin`. The custom protocol gives the iframe a unique
 *     origin per extension, so cross-extension or main-app DOM access is
 *     impossible by construction.
 *   - `referrerPolicy="no-referrer"` so the extension cannot leak the
 *     panel's load context to any embedded iframes it may try to load.
 *   - The host populates the `<extensionId>` segment of the URL - extensions
 *     cannot point at another extension's package directory.
 *   - The iframe communicates with the extension worker (and through it,
 *     the host) via `BibleExtensionAPI` over `postMessage`. That bridge is
 *     wired separately; the panel host itself just renders the iframe and
 *     lets the extension's UI code load.
 *
 * The iframe and its `IframeRpcBridge` lifecycle are owned by the shared
 * `ExtensionPanelHost` in `@bible/ui`; this wrapper supplies what is
 * desktop-specific: the IPC lookup, the sandbox attribute, the handler map and
 * context (`useDesktopBridgeParts`) and the loading/error copy.
 *
 * The actual `uiEntry` path is fetched at render time via the IPC handler
 * `extensions:getPanelTypeUiEntry` (registered alongside the rest of the
 * extension IPC). The component renders a thin loading state while
 * the lookup is in flight and an error state if the panel type is not
 * registered (e.g. the extension was uninstalled with the panel still open
 * in a saved session).
 */
/**
 * Computes the `sandbox` attribute for an extension panel iframe.
 * Exported for unit testing without React rendering.
 */
export function computeSandboxAttr(allowAutoplay: boolean): string {
  // `allow-forms` is needed for a panel's own `<form>` to work at all: without
  // it Chromium blocks submission before the `submit` event fires, so the
  // panel's handler never runs. It grants no navigation - the panel CSP's
  // `form-action 'none'` still refuses any real submission.
  const base = 'allow-scripts allow-forms';
  return allowAutoplay ? `${base} allow-autoplay` : base;
}

interface ExtensionPanelHostProps {
  extensionId: string;
  panelTypeId: string;
  panelId: string;
}

interface PanelTypeMeta {
  uiEntry: string;
  title?: string;
  /** True when the extension has the `ui:media` permission granted. */
  allowAutoplay?: boolean;
  /** The manifest's UI-kit declaration; feeds the bridge's `uikit.*` allowlist. */
  uiKit?: { version: string; components: string[] };
  /** Permissions the user granted the extension; feeds the bridge's `uikit.*` check. */
  grantedPermissions?: string[];
}

/** Until the IPC lookup answers, nothing is known: `uikit.*` stays denied. */
const NO_ACCESS: PanelAccess = { manifest: null, grants: [] };

const ExtensionPanelHost: React.FC<ExtensionPanelHostProps> = ({
  extensionId,
  panelTypeId,
  panelId,
}) => {
  const { t, i18n } = useI18n();
  const [meta, setMeta] = React.useState<PanelTypeMeta | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Bridge postMessage between the extension iframe and the host renderer.
  // Handles navigation, theme queries, and verse popup requests from the
  // @bible/extension-ui SDK running inside the iframe.
  // `panelId` and `panelTypeId` give the iframe an identity its worker can
  // trust: they come from these props, never from anything the iframe says.
  // `accessRef` holds the manifest/grants main reported for this extension
  // (see `extensions:getPanelTypeUiEntry`); the bridge reads it per request.
  const accessRef = useRef<PanelAccess>(NO_ACCESS);
  const getAccess = React.useCallback(() => accessRef.current, []);
  const getLocale = React.useCallback(() => i18n.currentLocale, [i18n]);
  const { context, handlers, onBridge } = useDesktopBridgeParts({
    extensionId,
    iframeRef,
    panelId,
    panelTypeId,
    getAccess,
    getLocale,
  });

  React.useEffect(() => {
    let cancelled = false;
    accessRef.current = NO_ACCESS; // a new lookup starts from "nothing known"
    const w = window as unknown as {
      electron?: {
        extensions?: {
          getPanelTypeUiEntry?: (
            extensionId: string,
            panelTypeId: string,
          ) => Promise<PanelTypeMeta | null>;
        };
      };
    };
    const fetchMeta = w.electron?.extensions?.getPanelTypeUiEntry;
    if (!fetchMeta) {
      // The IPC handler is wired by a follow-up; until then we can still
      // render a useful empty state without crashing the app.
      setError('extensions:getPanelTypeUiEntry IPC handler not registered');
      return;
    }
    fetchMeta(extensionId, panelTypeId)
      .then((m) => {
        if (cancelled) return;
        if (!m) {
          setError(`Extension panel type not found: ${extensionId}.${panelTypeId}`);
        } else {
          accessRef.current = {
            manifest: m.uiKit ? { uiKit: m.uiKit } : null,
            grants: (m.grantedPermissions ?? []) as PanelAccess['grants'],
          };
          setMeta(m);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [extensionId, panelTypeId]);

  // Strip leading slashes from the uiEntry so paths like '/index.html' and
  // 'index.html' both work. The custom protocol handler in main.ts joins
  // the segment to the extension's install path.
  const src = meta ? `ext-ui://${extensionId}/${meta.uiEntry.replace(/^\/+/, '')}` : null;

  return (
    <SharedExtensionPanelHost
      src={src}
      title={meta?.title ?? `${extensionId}.${panelTypeId}`}
      // Extensions with `ui:media` permission get `allow-autoplay` so their
      // panel iframe can play audio/video without user gesture (e.g. Audio Bible).
      sandbox={computeSandboxAttr(meta?.allowAutoplay === true)}
      context={context}
      handlers={handlers}
      onBridge={onBridge}
      iframeRef={iframeRef}
      error={error}
      loading={<span>{t('extensionPanelHost.loading')}</span>}
      dataAttributes={{
        'data-panel-id': panelId,
        'data-extension-id': extensionId,
        'data-panel-type-id': panelTypeId,
      }}
    />
  );
};

export default ExtensionPanelHost;
