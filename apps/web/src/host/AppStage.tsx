import { useTranslation } from 'react-i18next';
import { appFailures, appHost, getAppView, retryFailedApp } from './appHost';
import { useReadable } from './useReadable';

/**
 * Keep-alive stage: every mounted app stays in the DOM (state, scroll and
 * shortcuts survive a switch); inactive ones are hidden and inert. While the
 * app being opened has no view yet (chunk and boot in flight) a loading state
 * shows; a failed load shows an error with Retry.
 */
export function AppStage() {
  const { t } = useTranslation();
  const snap = useReadable(appHost);
  const failure = useReadable(appFailures);

  const loading = snap.pendingId !== null && !snap.mounted.includes(snap.pendingId);

  return (
    <>
      {snap.mounted.map((id) => {
        const View = getAppView(id);
        if (!View) return null;
        const active = id === snap.activeId;
        const inertProps = (active ? {} : { inert: true }) as Record<string, unknown>;
        return (
          <div
            key={id}
            class={`app-host__app app-host__${id}`}
            data-app={id}
            hidden={!active}
            aria-hidden={active ? undefined : 'true'}
            style={{ display: active ? 'contents' : 'none' }}
            {...inertProps}
          >
            <View />
          </div>
        );
      })}
      {loading && !failure && (
        <div class="kth-app-stage__status" role="status" aria-live="polite" data-testid="app-stage-loading">
          <i class="fa-solid fa-spinner fa-spin" aria-hidden="true" />
          <span>{t('apps.stage.loading', 'Loading…')}</span>
        </div>
      )}
      {failure && (
        <div class="kth-app-stage__status kth-app-stage__status--error" role="alert" data-testid="app-stage-error">
          <span>{t('apps.stage.error', 'This app could not be loaded.')}</span>
          <button type="button" class="kth-btn" onClick={() => void retryFailedApp()}>
            {t('apps.stage.retry', 'Retry')}
          </button>
        </div>
      )}
    </>
  );
}
