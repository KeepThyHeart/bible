/**
 * The view of an extension app on desktop (task 0080, M3 row 11): a host-drawn app bar (so an extension
 * cannot impersonate host chrome) above the extension's own sandboxed iframe, hosted by the desktop
 * `ExtensionPanelHost` in app mode. `keepAlive: 'never'` means mounted == shown, so mount/unmount report
 * the app's visibility to the main process (which tells the owning extension, if it listens).
 */
import React from 'react';
import { useI18n } from '../contexts/useI18n';
import { translateWithDefault } from '../hooks/useXrefGraphLabels';
import ExtensionPanelHost from '../components/extensions/ExtensionPanelHost';
import { AppIconGlyph } from './AppIconGlyph';
import { appRegistry, openApp } from './appHost';
import { resolveLabelRef } from './navEntries';
import type { ExtensionAppInfo } from './extensionApps';

interface Props {
  extensionId: string;
  info: ExtensionAppInfo;
}

type AppVisibilityIpc = (extensionId: string, shortId: string, visible: boolean) => unknown;

function reportVisibility(extensionId: string, shortId: string, visible: boolean): void {
  const fn = (window as unknown as { electron?: { extensions?: { appVisibility?: AppVisibilityIpc } } })
    .electron?.extensions?.appVisibility;
  try {
    const result = fn?.(extensionId, shortId, visible);
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Visibility is advisory; a failed report must never break the app view.
  }
}

const APP_BAR_BUTTON =
  'rounded px-sm text-xs text-text-secondary hover:bg-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/** Back to Study (the host's default app). */
export function closeExtensionApp(): void {
  void openApp('study');
}

export const ExtensionAppView: React.FC<Props> = ({ extensionId, info }) => {
  const { t, i18n } = useI18n();
  const [failed, setFailed] = React.useState(false);
  const headingId = React.useId();

  // Visible means the app's uiEntry lookup has resolved: that lookup activates a lazily activated owner,
  // so a report sent any earlier would reach a worker that is not yet listening. Hidden is sent on unmount,
  // and only if visible was.
  const reportedVisible = React.useRef(false);
  const reportReady = React.useCallback(() => {
    reportedVisible.current = true;
    reportVisibility(extensionId, info.shortId, true);
  }, [extensionId, info.shortId]);
  React.useEffect(() => {
    return () => {
      if (reportedVisible.current) {
        reportedVisible.current = false;
        reportVisibility(extensionId, info.shortId, false);
      }
    };
  }, [extensionId, info.shortId]);

  const desc = appRegistry.get(info.id);
  const title = desc ? resolveLabelRef(desc.title, t, i18n) : resolveLabelRef({ extensionId, text: info.title }, t, i18n);
  const icon = desc?.icon ?? (info.iconUrl ? { kind: 'image' as const, src: info.iconUrl } : { kind: 'builtin' as const, name: 'app' });
  const backLabel = translateWithDefault(t, 'apps.extension.backToStudy', 'Back to Study');

  const openSettings = (): void => {
    window.dispatchEvent(
      new CustomEvent('open-preferences-extension-settings', { detail: { extensionId } }),
    );
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-text-primary"
      data-extension-app={info.id}
      aria-labelledby={headingId}
    >
      <header className="flex h-8 shrink-0 items-center gap-sm border-b border-border bg-surface px-md text-sm">
        <span className="flex shrink-0 items-center" aria-hidden="true">
          <AppIconGlyph icon={icon} size={16} />
        </span>
        <h1 id={headingId} tabIndex={-1} className="m-0 truncate text-sm font-semibold text-text-heading">{title}</h1>
        <span className="truncate text-xs text-text-secondary">
          {translateWithDefault(t, 'apps.extension.by', 'by {publisher}').replace('{publisher}', info.publisher)}
        </span>
        <span className="flex-1" />
        {info.hasSettings && (
          <button
            type="button"
            className={APP_BAR_BUTTON}
            aria-label={translateWithDefault(t, 'apps.extension.settingsFor', '{app} settings').replace('{app}', title)}
            onClick={openSettings}
          >
            {translateWithDefault(t, 'apps.extension.settings', 'Settings')}
          </button>
        )}
        <button
          type="button"
          className={APP_BAR_BUTTON}
          aria-label={translateWithDefault(t, 'apps.extension.closeApp', 'Close {app}').replace('{app}', title)}
          onClick={closeExtensionApp}
        >
          {translateWithDefault(t, 'apps.extension.close', 'Close')}
        </button>
      </header>
      <div className="relative min-h-0 flex-1">
        {failed ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-md p-lg text-center">
            <p className="text-sm text-text-secondary">
              {translateWithDefault(t, 'apps.extension.unavailable', 'This app is not available right now.')}
            </p>
            <button
              type="button"
              className="rounded bg-primary px-md py-xs text-sm text-text-on-primary"
              onClick={closeExtensionApp}
            >
              {backLabel}
            </button>
          </div>
        ) : (
          <ExtensionPanelHost
            extensionId={extensionId}
            appShortId={info.shortId}
            appTitle={title}
            onReady={reportReady}
            onUnavailable={() => setFailed(true)}
          />
        )}
      </div>
    </section>
  );
};

export default ExtensionAppView;
