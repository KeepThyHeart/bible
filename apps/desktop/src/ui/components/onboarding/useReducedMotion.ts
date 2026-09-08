import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the OS asks for reduced motion. Reactive - Windows, macOS and the
 * GNOME/KDE settings all flip this live, and Electron forwards the change.
 *
 * Returns `false` when `matchMedia` is unavailable (jsdom in some configs), so
 * the caller's normal path is the default rather than a permanently frozen UI.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Safari < 14 only has the deprecated listener API; Electron does not, but
    // guard anyway so this never throws in a stripped test environment.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    return undefined;
  }, []);

  return reduced;
}
