import React, { useRef } from 'react';
import { useIframeBridge } from './useIframeBridge';
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
}

const ExtensionPanelHost: React.FC<ExtensionPanelHostProps> = ({
  extensionId,
  panelTypeId,
  panelId,
}) => {
  const { t } = useI18n();
  const [meta, setMeta] = React.useState<PanelTypeMeta | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Bridge postMessage between the extension iframe and the host renderer.
  // Handles navigation, theme queries, and verse popup requests from the
  // @bible/extension-ui SDK running inside the iframe.
  // `panelId` and `panelTypeId` give the iframe an identity its worker can
  // trust: they come from these props, never from anything the iframe says.
  useIframeBridge({ extensionId, iframeRef, panelId, panelTypeId });

  React.useEffect(() => {
    let cancelled = false;
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

  if (error) {
    return (
      <div
        className="flex items-center justify-center h-full p-4 text-center"
        style={{ color: 'var(--theme-text-secondary)' }}
        data-panel-id={panelId}
      >
        <span>{error}</span>
      </div>
    );
  }

  if (!meta) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: 'var(--theme-text-secondary)' }}
        data-panel-id={panelId}
      >
        <span>{t('extensionPanelHost.loading')}</span>
      </div>
    );
  }

  // Strip leading slashes from the uiEntry so paths like '/index.html' and
  // 'index.html' both work. The custom protocol handler in main.ts joins
  // the segment to the extension's install path.
  const cleanedEntry = meta.uiEntry.replace(/^\/+/, '');
  const src = `ext-ui://${extensionId}/${cleanedEntry}`;

  // Extensions with `ui:media` permission get `allow-autoplay` so their
  // panel iframe can play audio/video without user gesture (e.g. Audio Bible).
  const sandbox = computeSandboxAttr(meta.allowAutoplay === true);

  return (
    <iframe
      ref={iframeRef}
      title={meta.title ?? `${extensionId}.${panelTypeId}`}
      src={src}
      sandbox={sandbox}
      referrerPolicy="no-referrer"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        backgroundColor: 'var(--theme-bg-primary)',
      }}
      data-panel-id={panelId}
      data-extension-id={extensionId}
      data-panel-type-id={panelTypeId}
    />
  );
};

export default ExtensionPanelHost;
