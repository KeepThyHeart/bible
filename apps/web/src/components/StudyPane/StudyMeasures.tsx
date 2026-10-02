import { useTranslation } from 'react-i18next';
import { MeasurePopup } from '@bible/ui';
import { useVerseMeasures } from '../../hooks/useVerseMeasures';
import { StudySection } from './StudySection';

interface StudyMeasuresProps {
  verseId: number | null;
  onOpenSettings?: (section?: string) => void;
  /** 'section' = collapsible desktop section; 'mobile' = the mobile pane's framed section. */
  variant?: 'section' | 'mobile';
  compact?: boolean;
}

/** Translated popup labels, shared with the in-text popup keys. */
function usePopupLabels() {
  const { t } = useTranslation();
  return {
    range: t('measures.popup.range'),
    rangeHint: t('measures.popup.rangeHint'),
    verseNote: t('measures.popup.verseNote'),
    usage: { illustrative: t('measures.popup.usageIllustrative'), figurative: t('measures.popup.usageFigurative') },
    usageHint: {
      illustrative: t('measures.popup.usageHintIllustrative'),
      figurative: t('measures.popup.usageHintFigurative'),
    },
    draft: t('measures.popup.draft'),
    sources: t('measures.popup.sources'),
    units: t('measures.popup.units'),
  };
}

/**
 * The verse's weights, measures and money, one card each. Renders nothing when measures are off or
 * the verse has none.
 */
export function StudyMeasures({ verseId, onOpenSettings, variant = 'section', compact }: StudyMeasuresProps) {
  const { t, i18n } = useTranslation();
  const labels = usePopupLabels();
  const models = useVerseMeasures(verseId, i18n.language || 'en');
  if (models.length === 0) return null;

  const dir: 'ltr' | 'rtl' = typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
  const openSettings = onOpenSettings ? () => onOpenSettings('measures') : undefined;
  const list = (
    <div class="study-measures kth-measure-list" role="list" aria-label={t('measures.study.listLabel', { count: models.length })}>
      {models.map((model, i) => (
        <div role="listitem" key={model.occurrenceId}>
          <MeasurePopup
            model={model}
            labels={labels}
            compact={compact}
            dir={dir}
            onOpenSettings={i === models.length - 1 ? openSettings : undefined}
          />
        </div>
      ))}
    </div>
  );
  if (variant === 'mobile') {
    return (
      <div class="mobile-study-section">
        <div class="mobile-study-section__header">
          <i class="fa-solid fa-scale-balanced" /> {t('measures.study.title')}
        </div>
        <div class="mobile-study-section__content">{list}</div>
      </div>
    );
  }
  return (
    <StudySection id="measures" label={t('measures.study.title')} defaultExpanded>
      {list}
    </StudySection>
  );
}
