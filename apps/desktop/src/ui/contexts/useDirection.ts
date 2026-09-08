/**
 * Reactive access to the active locale's writing direction.
 *
 * Most direction handling is declarative - Tailwind logical utilities plus
 * `[dir='rtl']` rules - and needs no JS. This hook is for the handful of places
 * that compute a physical offset in JavaScript (context menus and popovers
 * anchored to a mouse/element x-coordinate), where the flip cannot be expressed
 * in CSS.
 */

import { useI18n } from './useI18n';
import type { LocaleDirection } from '../services/II18nService';

/** `'ltr' | 'rtl'` for the active locale; re-renders when the locale changes. */
export function useDirection(): LocaleDirection {
  const { i18n, locale } = useI18n();
  void locale; // `locale` is the reactive dependency; direction derives from it.
  return i18n.currentDirection;
}

/** Convenience wrapper for the common `dir === 'rtl'` test. */
export function useIsRtl(): boolean {
  return useDirection() === 'rtl';
}
