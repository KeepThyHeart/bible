/**
 * "Weights, measures and money" section of the Study pane (task 0069): one
 * `MeasurePopup` card per measure in the verse. Hidden when measures are off or
 * the verse has none.
 */
import React, { useMemo } from 'react';
import { MeasurePopup } from '@bible/ui';
import type { MeasurePopupProps } from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { useDirection } from '../../contexts/useDirection';
import StudySection from '../study/StudySection';
import { useVerseMeasures } from './useVerseMeasures';
import { openMeasureSettings } from './useMeasureWordPopup';

export interface MeasuresStudySectionProps {
  verseId: number | null;
  collapsed: boolean;
  onToggle: () => void;
}

const MeasuresStudySection: React.FC<MeasuresStudySectionProps> = ({ verseId, collapsed, onToggle }) => {
  const { t, locale } = useI18n();
  const dir = useDirection();
  const models = useVerseMeasures(verseId, locale);

  const labels = useMemo<NonNullable<MeasurePopupProps['labels']>>(() => ({
    range: t('measures.popup.range'),
    rangeHint: t('measures.popup.rangeHint'),
    verseNote: t('measures.popup.verseNote'),
    usage: { illustrative: t('measures.popup.usage.illustrative'), figurative: t('measures.popup.usage.figurative') },
    usageHint: { illustrative: t('measures.popup.usageHint.illustrative'), figurative: t('measures.popup.usageHint.figurative') },
    draft: t('measures.popup.draft'),
    sources: t('measures.popup.sources'),
    units: t('measures.popup.units'),
  }), [t]);

  if (models.length === 0) return null;
  return (
    <StudySection title={t('measures.study.title')} count={models.length} collapsed={collapsed} onToggle={onToggle}>
      <div className="kth-measure-list">
        {models.map((model, i) => (
          <MeasurePopup
            key={model.occurrenceId}
            model={model}
            labels={labels}
            dir={dir}
            onOpenSettings={i === 0 ? openMeasureSettings : undefined}
          />
        ))}
      </div>
    </StudySection>
  );
};

export default MeasuresStudySection;
