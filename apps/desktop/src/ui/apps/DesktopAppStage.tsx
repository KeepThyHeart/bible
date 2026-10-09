import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppRail, AppStage } from '@bible/ui';
import { shouldShowRail } from '@bible/core/browser';
import { useI18n } from '../contexts/useI18n';
import { translateWithDefault } from '../utils/translateWithDefault';
import { useExtensionUiStore } from '../extensions/extensionUiStore';
import { useLayoutStore } from '../stores/useLayoutStore';
import { appHostStore, getAppView, openApp, prefetchApp } from './appHost';
import { useNavItems, useRailMode } from './navPrefs';
import { resolveLabelRef, toNavEntries } from './navEntries';

/** Window event fired when the app on screen is about to be hidden, so body-level popups close. */
export const APP_WILL_HIDE_EVENT = 'app:will-hide';

const BoundView: React.FC<{ id: string }> = ({ id }) => {
  const View = getAppView(id);
  return View ? <View /> : null;
};

/**
 * `[AppRail?][stage]` as siblings inside App's `<main>` flex row. The rail is a
 * conditional sibling that precedes the stage, so toggling it never changes the
 * stage's parent or position: Study (dockview) is never remounted.
 */
export const DesktopAppStage: React.FC = () => {
  const { t, i18n } = useI18n();
  const snap = useSyncExternalStore(appHostStore.subscribe, appHostStore.getSnapshot);
  const railItems = useNavItems('rail');
  const mode = useRailMode();
  const showRail = shouldShowRail(mode, railItems.length);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef(new Map<string, HTMLElement>());
  const prevActive = useRef<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const { activeId, pendingId, mounted } = snap;

  // Remember the last focused element per app.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target as HTMLElement | null;
      const id = target?.closest<HTMLElement>('[data-app]')?.dataset.app;
      if (id && target) lastFocus.current.set(id, target);
    };
    stage.addEventListener('focusin', onFocusIn);
    return () => stage.removeEventListener('focusin', onFocusIn);
  }, []);

  // On an app switch: close body-level popups of the app being left, then move focus into the new one.
  useEffect(() => {
    const prev = prevActive.current;
    prevActive.current = activeId;
    if (!activeId || prev === activeId) return;
    if (prev === null) return; // the boot activation never steals focus
    useExtensionUiStore.getState().hideVersePopup(); // allow-getstate: effect - imperative popup close
    window.dispatchEvent(new Event(APP_WILL_HIDE_EVENT));
    const desc = railItems.find((i) => i.id === activeId);
    setAnnounce(
      t('apps.stage.announce', {
        app: desc ? resolveLabelRef(desc.title, t, i18n) : activeId,
      }),
    );
    const raf = requestAnimationFrame(() => {
      const remembered = lastFocus.current.get(activeId);
      if (remembered?.isConnected) {
        remembered.focus();
        return;
      }
      const wrapper = stageRef.current?.querySelector<HTMLElement>(`[data-app="${CSS.escape(activeId)}"]`);
      const heading = wrapper?.querySelector<HTMLElement>('h1[tabindex="-1"]');
      if (heading) {
        heading.focus();
        return;
      }
      if (activeId === 'study') {
        useLayoutStore.getState().dockviewApi?.activePanel?.api.setActive(); // allow-getstate: effect - imperative dockview access
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const entries = toNavEntries(railItems, t, i18n);
  return (
    <>
      {showRail && (
        <AppRail
          orientation="vertical"
          items={entries}
          activeId={activeId}
          onSelect={(id) => { void openApp(id); }}
          onPrefetch={prefetchApp}
          labels={{ railLabel: translateWithDefault(t, 'apps.rail.label', 'Apps') }}
          className="app-rail"
        />
      )}
      <div key="stage" className="app-stage relative flex-1 min-w-0 min-h-0" ref={stageRef}>
        <AppStage
          apps={mounted.map((id) => ({ id, active: id === activeId, view: <BoundView id={id} /> }))}
          pendingId={pendingId}
          fallback={null}
        />
        <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      </div>
    </>
  );
};

export default DesktopAppStage;
