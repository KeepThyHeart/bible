/**
 * Theme and font settings across windows.
 *
 * They are renderer state (applied as `<html data-theme>` and CSS custom properties), so a popped-out
 * window, which is its own renderer, started on the defaults (light, 14px) whatever the main window
 * looked like, and never followed a later change. The main window publishes the appearance through
 * main (`window:broadcast-appearance`, which also remembers the latest); a detached window asks for
 * the latest when it opens and applies every change after that.
 */
import { usePreferencesStore } from '../stores/usePreferencesStore';

type Appearance = {
  theme: string;
  globalFontScale: number;
  uiControlFontSize: number;
  typography: unknown;
};

function snapshot(): Appearance {
  const { theme, globalFontScale, uiControlFontSize, typography } = usePreferencesStore.getState();
  return { theme, globalFontScale, uiControlFontSize, typography };
}

/** Main window: publish now and on every change of the appearance fields. */
export function startAppearancePublisher(): void {
  const api = window.electron?.window;
  if (!api?.broadcastAppearance) return;
  let last = JSON.stringify(snapshot());
  const publish = () => {
    api.broadcastAppearance(snapshot() as unknown as Record<string, unknown>).catch(() => undefined);
  };
  publish();
  usePreferencesStore.subscribe(() => {
    const now = JSON.stringify(snapshot());
    if (now === last) return;
    last = now;
    publish();
  });
}

/** Detached window: apply the main window's appearance now and whenever it changes. */
export function startAppearanceFollower(): void {
  const api = window.electron?.window;
  if (!api) return;
  const apply = (a: Record<string, unknown> | null | undefined) => {
    if (!a || typeof a !== 'object') return;
    // loadFromSession validates every field and applies it to the DOM; it saves nothing.
    usePreferencesStore.getState().loadFromSession(a as Parameters<ReturnType<typeof usePreferencesStore.getState>['loadFromSession']>[0]);
  };
  api.onAppearanceChanged?.(apply);
  void api.getAppearance?.().then(apply).catch(() => undefined);
}
