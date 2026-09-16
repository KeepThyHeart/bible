/**
 * useLocalizer.ts
 *
 * Web's equivalent of desktop's `useI18n()` `localizer` field: the active
 * locale's `Localizer` (locale-aware number/date formatting, collation and
 * case-folding), bound to whatever i18next's current language is. Use this
 * instead of bare `.toLocaleString()` / `.toLocaleDateString()` / `.toFixed()`
 * for anything shown to the user, so it follows the app's chosen UI locale
 * rather than the OS locale.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocalizer, type Localizer } from '@bible/core/browser';

export function useLocalizer(): Localizer {
  const { i18n } = useTranslation();
  return useMemo(() => getLocalizer(i18n.language), [i18n.language]);
}
