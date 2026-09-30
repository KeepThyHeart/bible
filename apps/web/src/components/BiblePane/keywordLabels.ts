import type { KeywordLegendLabels } from '@bible/ui';
import type { TFunction } from 'i18next';

/** Legend strings from the `keywordMarks` catalog (the add, edit and suggestion strings are unused on web). */
export function legendLabels(t: TFunction): Partial<KeywordLegendLabels> {
  const k = (key: string, opts?: Record<string, unknown>) => t(`keywordMarks.${key}`, opts) as string;
  return {
    title: k('title'),
    toggle: k('toggle'),
    empty: k('empty'),
    count: (count) => k('count', { count }),
    show: (label) => k('show', { label }),
    hide: (label) => k('hide', { label }),
    next: (label) => k('next', { label }),
    prev: (label) => k('prev', { label }),
    approximate: k('approximate'),
    approximateHint: k('approximateHint'),
  };
}
