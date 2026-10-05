import { useEffect } from 'preact/hooks';
import { STUDY_APP_ID } from '@bible/core/browser';
import type { AppId } from '@bible/core/browser';
import { appRegistry, openApp } from './appHost';

/**
 * Ctrl+Shift+0 opens Study, Ctrl+Shift+1..9 the nth registered app by order
 * (Study is 1). Matches `e.code`: Shift changes `e.key` per keyboard layout.
 * Lives in the shell, not in Study, so it works when Study is not mounted.
 */
export function appForSwitchKey(
  e: Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'code' | 'defaultPrevented'>,
  orderedIds: readonly AppId[],
): AppId | null {
  if (e.defaultPrevented || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return null;
  const m = /^Digit([0-9])$/.exec(e.code);
  if (!m) return null;
  const n = Number(m[1]);
  if (n === 0) return STUDY_APP_ID;
  return orderedIds[n - 1] ?? null;
}

export function useAppSwitchKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ids = appRegistry.list().map((d) => d.id);
      const target = appForSwitchKey(e, ids);
      if (!target) return;
      e.preventDefault();
      void openApp(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
