import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { AppStage as SharedAppStage } from '@bible/ui';
import { appFailures, appHost, getAppView, retryFailedApp } from './appHost';
import { appHasOwnChrome } from './appChrome';
import { AppTopBar } from './AppTopBar';
import { useIsMobile } from './useIsMobile';
import { useReadable } from './useReadable';

/**
 * Keep-alive stage on `@bible/ui`'s AppStage: every mounted app stays in the
 * DOM (state, scroll and shortcuts survive a switch); inactive ones are hidden
 * and inert. While the app being opened has no view yet (chunk and boot in
 * flight) a loading state shows; a failed load shows an error with Retry.
 * On the phone layout an app without chrome of its own gets the "Back to
 * Study" bar above its view.
 */
export function AppStage() {
  const { t } = useTranslation();
  const snap = useReadable(appHost);
  const failure = useReadable(appFailures);
  const mobile = useIsMobile();

  // Focus per app: a switch made from a trigger inside the app now hidden would leave focus on <body>.
  const lastFocus = useRef(new Map<string, HTMLElement>());
  const prevActive = useRef<string | null>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target as HTMLElement | null;
      const id = target?.closest<HTMLElement>('[data-app]')?.dataset.app;
      if (id && target) lastFocus.current.set(id, target);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  const activeId = snap.activeId;
  useEffect(() => {
    const prev = prevActive.current;
    prevActive.current = activeId;
    if (!activeId || prev === null || prev === activeId) return; // the boot activation never steals focus
    const raf = requestAnimationFrame(() => {
      const remembered = lastFocus.current.get(activeId);
      if (remembered?.isConnected && !remembered.closest('[inert]')) {
        remembered.focus();
        return;
      }
      const wrapper = document.querySelector<HTMLElement>(`[data-app="${CSS.escape(activeId)}"]`);
      if (!wrapper) return;
      const heading = wrapper.querySelector<HTMLElement>('h1[tabindex="-1"]');
      if (heading) { heading.focus(); return; }
      if (!wrapper.hasAttribute('tabindex')) wrapper.setAttribute('tabindex', '-1');
      wrapper.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId]);

  const loading = snap.pendingId !== null && !snap.mounted.includes(snap.pendingId);
  const apps = snap.mounted.flatMap((id) => {
    const View = getAppView(id);
    if (!View) return [];
    const bar = mobile && !appHasOwnChrome(id);
    return [{
      id,
      active: id === snap.activeId,
      view: <>{bar && <AppTopBar id={id} />}<View /></>, // one shape either way: a breakpoint change must not remount the view
    }];
  });

  return (
    <>
      <SharedAppStage apps={apps} appClassName={(id) => `app-host__app app-host__${id}`} />
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
