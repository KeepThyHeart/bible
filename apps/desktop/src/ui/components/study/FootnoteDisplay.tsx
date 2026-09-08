import React from 'react';
import { useI18n } from '../../contexts/useI18n';

interface Footnote {
  position: number;
  marker: string;
  text: string;
}

interface FootnoteDisplayProps {
  footnotes: Footnote[];
}

/**
 * Displays footnotes in an expandable section for Study Mode
 */
const FootnoteDisplay: React.FC<FootnoteDisplayProps> = ({ footnotes }) => {
  const { t } = useI18n();
  if (footnotes.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 border border-warning-border bg-warning-soft rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-warning-soft border-b border-warning-border">
        <h4 className="text-sm font-semibold text-warning-text uppercase tracking-wide">
          {t('footnoteDisplay.footnotes')}
        </h4>
      </div>
      <div className="p-4 space-y-3">
        {footnotes.map((footnote, index) => (
          <div key={index} className="flex gap-2 text-sm">
            <span className="flex-shrink-0 font-bold text-warning-text">
              {footnote.marker}
            </span>
            <p className="text-text-primary leading-relaxed">
              {footnote.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FootnoteDisplay;
