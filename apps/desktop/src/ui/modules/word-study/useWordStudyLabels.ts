import { useMemo } from 'react';
import { DEFAULT_WORD_STUDY_LABELS } from '@bible/ui';
import type { WordStudyLabels } from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';

/**
 * The shared Word Study labels, translated through the desktop catalog
 * (`wordStudy.label.<name>`).
 *
 * Templates keep their `{name}` placeholders: `t()` without params returns the
 * catalog string as written, and the shared components fill the placeholders
 * themselves (`fillTemplate`).
 */
export function useWordStudyLabels(): WordStudyLabels {
  const { t } = useI18n();
  return useMemo(() => {
    const out = { ...DEFAULT_WORD_STUDY_LABELS };
    for (const key of Object.keys(DEFAULT_WORD_STUDY_LABELS) as Array<keyof WordStudyLabels>) {
      out[key] = t(`wordStudy.label.${key}`);
    }
    return out;
  }, [t]);
}
