/**
 * Hook returning the i18n service plus a `t()` shortcut. Re-renders the
 * calling component whenever the active locale changes so every visible
 * string updates without manual refresh.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useAppServices } from './ContextProvider';
import type { II18nService, LocaleCode } from '../services/II18nService';
import { getLocalizer, type Localizer } from '@bible/core';

export interface UseI18nResult {
  i18n: II18nService;
  locale: LocaleCode;
  t(key: string, params?: Record<string, unknown>): string;
  /**
   * The active locale's {@link Localizer}: locale-aware number/date
   * formatting, collation and case-folding, bound to whatever locale is
   * currently selected. Use this instead of bare `.toLocaleString()` /
   * `.toLocaleDateString()` / `.toFixed()` for anything shown to the user, so
   * it follows the app's chosen UI locale rather than the OS locale.
   */
  localizer: Localizer;
}

export function useI18n(): UseI18nResult {
  const { i18n } = useAppServices();
  const locale = useSyncExternalStore(
    (cb) => {
      const sub = i18n.onDidChangeLocale(cb);
      return () => sub.dispose();
    },
    () => i18n.currentLocale,
    () => i18n.currentLocale,
  );
  // `t` re-binds when locale changes so memoized consumers recompute strings.
  const t = useCallback(
    (key: string, params?: Record<string, unknown>) => i18n.t(key, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n, locale],
  );
  const localizer = useMemo(() => getLocalizer(locale), [locale]);
  return { i18n, locale, t, localizer };
}
