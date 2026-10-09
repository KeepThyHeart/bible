import { describe, it, expect } from 'vitest';
import { DEFAULT_WORD_STUDY_LABELS } from '@bible/ui';
import i18n from '../../i18n';
import { buildWordStudyLabels } from './useWordStudyLabels';

describe('buildWordStudyLabels', () => {
  it('reads every label from the English catalog, leaving {templates} for the view to fill', () => {
    const labels = buildWordStudyLabels((k, o) => i18n.t(k, { ...o, lng: 'en' }));
    expect(labels).toEqual(DEFAULT_WORD_STUDY_LABELS);
  });
});
