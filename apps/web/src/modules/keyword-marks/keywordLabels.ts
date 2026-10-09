import type { KeywordLegendLabels } from '@bible/ui';
import type { TFunction } from 'i18next';

/** Legend strings from the `keywordMarks` catalog for the read-only web legend; other labels fall back to the component defaults and are never shown. */
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
