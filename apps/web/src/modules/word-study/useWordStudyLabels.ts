import { useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { DEFAULT_WORD_STUDY_LABELS } from '@bible/ui';
import type { WordStudyLabels } from '@bible/ui';

/** Placeholders the word study label templates use; each is handed back to itself so `fillTemplate` can fill it later. */
const PLACEHOLDERS = ['occurrences', 'verses', 'strongs', 'count', 'list', 'shown', 'total', 'label'] as const;
const PASS_THROUGH: Record<string, string> = Object.fromEntries(PLACEHOLDERS.map((p) => [p, `{${p}}`]));

/**
 * Translated `WordStudyLabels` for `WordStudyView`, from the `wordStudy.labels.*` catalog keys.
 *
 * The view fills `{name}` templates itself (`fillTemplate`), while this app's catalogs are
 * ICU. Formatting each label with its own placeholders as values keeps the template intact
 * for the view to fill.
 */
export function useWordStudyLabels(): Partial<WordStudyLabels> {
  const { t, i18n } = useTranslation();
  // `t` changes identity with the language.
  return useMemo(() => buildWordStudyLabels(t), [t, i18n.language]);
}

/** Pure form of {@link useWordStudyLabels}, for any `t`. */
export function buildWordStudyLabels(t: (key: string, options?: Record<string, unknown>) => unknown): Partial<WordStudyLabels> {
  const out: Partial<WordStudyLabels> = {};
  for (const key of Object.keys(DEFAULT_WORD_STUDY_LABELS) as Array<keyof WordStudyLabels>) {
    out[key] = t(`wordStudy.labels.${key}`, { ...PASS_THROUGH, defaultValue: DEFAULT_WORD_STUDY_LABELS[key] }) as string;
  }
  return out;
}
