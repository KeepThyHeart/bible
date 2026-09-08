import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { StudyModeOptions } from '../../stores/useBibleStore';

interface StudyControlsProps {
  options: StudyModeOptions;
  hasInterlinearData: boolean;
  interlinearCheckComplete?: boolean;
  onOptionsChange: (options: Partial<StudyModeOptions>) => void;
}

/**
 * Control panel for Study Mode features
 * Allows toggling footnotes, cross-references, interlinear, etc.
 */
const StudyControls: React.FC<StudyControlsProps> = ({
  options,
  hasInterlinearData,
  interlinearCheckComplete = true,
  onOptionsChange
}) => {
  const { t } = useI18n();
  return (
    <section
      className="bg-surface-secondary border border-border-secondary rounded-lg p-4 mb-4"
      data-testid="study-controls"
      aria-labelledby="study-controls-heading"
    >
      <h3 id="study-controls-heading" className="text-sm font-semibold text-text-primary uppercase tracking-wide mb-3">
        {t('studyControls.heading')}
      </h3>

      <div className="space-y-2">
        {/* Footnotes toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={options.showFootnotes}
            onChange={(e) => onOptionsChange({ showFootnotes: e.target.checked })}
            className="w-4 h-4 text-accent-strong border-border-secondary rounded focus:ring-accent"
          />
          <span className="text-sm text-text-primary">{t('studyControls.showFootnotes')}</span>
        </label>

        {/* Cross-references toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={options.showCrossReferences}
            onChange={(e) => onOptionsChange({ showCrossReferences: e.target.checked })}
            className="w-4 h-4 text-accent-strong border-border-secondary rounded focus:ring-accent"
          />
          <span className="text-sm text-text-primary">{t('studyControls.showCrossRefs')}</span>
        </label>

        {/* User cross-references toggle (only if main cross-refs enabled) */}
        {options.showCrossReferences && (
          <label className="flex items-center gap-2 cursor-pointer ms-6">
            <input
              type="checkbox"
              checked={options.showUserCrossRefs}
              onChange={(e) => onOptionsChange({ showUserCrossRefs: e.target.checked })}
              className="w-4 h-4 text-accent-strong border-border-secondary rounded focus:ring-accent"
            />
            <span className="text-sm text-text-secondary">{t('studyControls.includeUserCrossRefs')}</span>
          </label>
        )}

        {/* Commentary links toggle.
            Study mode puts a "Commentaries:" row of module links under every
            verse that has one. That is the point of Study mode for some
            readers and clutter for others, so it is a switch rather than a
            constant - and it lives here, with the rest of the per-passage
            display options, not in global preferences. */}
        <label className="flex items-center gap-2 cursor-pointer" data-testid="commentary-links-toggle">
          <input
            type="checkbox"
            checked={options.showCommentaryLinks}
            onChange={(e) => onOptionsChange({ showCommentaryLinks: e.target.checked })}
            className="w-4 h-4 text-accent-strong border-border-secondary rounded focus:ring-accent"
            data-testid="commentary-links-checkbox"
          />
          <span className="text-sm text-text-primary">
            {t('studyControls.showCommentaryLinks')}
          </span>
        </label>

        {/* Interlinear toggle (only if module has interlinear data) */}
        {hasInterlinearData && (
          <>
            <label className="flex items-center gap-2 cursor-pointer" data-testid="interlinear-toggle">
              <input
                type="checkbox"
                checked={options.showInterlinear}
                onChange={(e) => onOptionsChange({ showInterlinear: e.target.checked })}
                className="w-4 h-4 text-accent-strong border-border-secondary rounded focus:ring-accent"
                data-testid="interlinear-checkbox"
              />
              <span className="text-sm text-text-primary">{t('studyControls.showInterlinear')}</span>
            </label>

            {/* Interlinear layout options (only if interlinear enabled) */}
            {options.showInterlinear && (
              /* fieldset/legend is the native way to name a radio group -
                 no ARIA needed, and it survives every AT. */
              <fieldset className="ms-6 space-y-1">
                <legend className="sr-only">
                  {t('studyControls.interlinearLayoutLegend')}
                </legend>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="interlinearLayout"
                    value="inline"
                    checked={options.interlinearLayout === 'inline'}
                    onChange={() => onOptionsChange({ interlinearLayout: 'inline' })}
                    className="w-4 h-4 text-accent-strong border-border-secondary focus:ring-accent"
                  />
                  <span className="text-sm text-text-secondary">{t('studyControls.inlineLayout')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="interlinearLayout"
                    value="stacked"
                    checked={options.interlinearLayout === 'stacked'}
                    onChange={() => onOptionsChange({ interlinearLayout: 'stacked' })}
                    className="w-4 h-4 text-accent-strong border-border-secondary focus:ring-accent"
                  />
                  <span className="text-sm text-text-secondary">{t('studyControls.stackedLayout')}</span>
                </label>
              </fieldset>
            )}
          </>
        )}
      </div>

      {/* Info message about interlinear data status */}
      {!hasInterlinearData && !interlinearCheckComplete && (
        <p className="text-xs text-text-secondary mt-3 italic">
          {t('studyControls.interlinearLoading')}
        </p>
      )}
      {!hasInterlinearData && interlinearCheckComplete && (
        <p className="text-xs text-text-secondary mt-3 italic">
          {t('studyControls.interlinearUnavailable')}
        </p>
      )}
    </section>
  );
};

export default StudyControls;
