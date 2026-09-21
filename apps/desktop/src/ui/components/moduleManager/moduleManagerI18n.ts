import { useCallback } from 'react';
import { useI18n } from '../../contexts/useI18n';
import type { ModuleType } from '../../stores/module/types';

/**
 * `t()` with an English default for keys not yet in the catalog.
 *
 * `I18nService.t` renders a missing key as `[key]`. New Module Manager strings
 * are declared with an inline default so the UI reads correctly before the
 * catalog entry lands (`locales/en/ui.json`); once the key exists the catalog
 * wins and the default is never used. `{param}` placeholders in the default are
 * substituted the same simple way ICU would for plain values.
 */
export function useTd(): (key: string, fallback: string, params?: Record<string, unknown>) => string {
  const { t } = useI18n();
  return useCallback(
    (key: string, fallback: string, params?: Record<string, unknown>) => {
      const translated = t(key, params);
      if (translated !== `[${key}]`) return translated;
      if (!params) return fallback;
      return fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match
      );
    },
    [t]
  );
}

/** Catalog key (plural noun, already in `ui.json`) and English default per module type. */
export const MODULE_TYPE_LABELS: Record<ModuleType, { key: string; fallback: string }> = {
  bible: { key: 'moduleManagerDialog.typeBibles', fallback: 'Bibles' },
  commentary: { key: 'moduleManagerDialog.typeCommentaries', fallback: 'Commentaries' },
  dictionary: { key: 'moduleManagerDialog.typeDictionaries', fallback: 'Dictionaries' },
  book: { key: 'moduleManagerDialog.typeBooks', fallback: 'Books' },
  devotional: { key: 'moduleManagerDialog.typeDevotionals', fallback: 'Devotionals' },
  lexicon: { key: 'moduleManagerDialog.typeLexicons', fallback: 'Lexicons' },
  topical_index: { key: 'moduleManagerDialog.typeTopicalIndexes', fallback: 'Topical Indexes' },
  cross_reference: { key: 'moduleManagerDialog.typeCrossReferences', fallback: 'Cross-References' },
  tag_graph: { key: 'moduleManagerDialog.typeTagGraphs', fallback: 'Tag Graphs' },
};
