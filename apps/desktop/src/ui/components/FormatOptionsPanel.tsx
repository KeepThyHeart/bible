import React from 'react';
import { FormatOptions } from '../services/verseCopyService';
import { useI18n } from '../contexts/useI18n';

export interface FormatOptionsPanelProps {
  options: FormatOptions;
  onOptionsChange: (options: FormatOptions) => void;
  showAsCollapsible?: boolean;
  /**
   * Whether to append the "not all options affect all formats" caveat. Off when
   * the panel is embedded in a larger option list that carries its own footnote
   * (the copy dialog's Advanced Options), so the caveat is not stranded in the
   * middle of the controls it qualifies.
   */
  showNote?: boolean;
}

/**
 * Reusable format options panel
 *
 * Shows checkboxes for format options
 */
const FormatOptionsPanel: React.FC<FormatOptionsPanelProps> = ({
  options,
  onOptionsChange,
  showAsCollapsible = false,
  showNote = true
}) => {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = React.useState(!showAsCollapsible);
  // Unique per instance so two panels on one screen don't collide on ids.
  const baseId = React.useId();
  const noteId = `${baseId}-note`;
  const panelId = `${baseId}-panel`;

  const toggleOption = (key: keyof FormatOptions) => {
    onOptionsChange({
      ...options,
      [key]: !options[key]
    });
  };

  const optionsContent = (
    <div className="space-y-3">
      <label className="flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={options.displayVersionNumber}
          onChange={() => toggleOption('displayVersionNumber')}
          aria-describedby={showNote ? noteId : undefined}
          className="w-4 h-4 text-accent border-border-secondary rounded focus:ring-accent focus:ring-2"
        />
        <span className="ms-3 text-sm text-text-primary">
          {/* "Display translation": KJV is a translation, not a number. The old
              label said "version number", which read as a build number. */}
          {t('formatOptionsPanel.displayTranslation')}
        </span>
      </label>

      <label className="flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={options.wordsOfChristInRed}
          onChange={() => toggleOption('wordsOfChristInRed')}
          aria-describedby={showNote ? noteId : undefined}
          className="w-4 h-4 text-accent border-border-secondary rounded focus:ring-accent focus:ring-2"
        />
        <span className="ms-3 text-sm text-text-primary">
          {t('formatOptionsPanel.wordsOfChristInRed')}
        </span>
      </label>

      {showNote && (
        <p id={noteId} className="text-xs text-text-secondary italic mt-2">
          {t('formatOptionsPanel.note')}
        </p>
      )}
    </div>
  );

  if (!showAsCollapsible) {
    return optionsContent;
  }

  return (
    <div className="border border-border rounded">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="w-full px-4 py-3 text-start flex items-center justify-between hover:bg-background-hover transition-colors"
      >
        <span className="text-sm font-medium text-text-heading">
          {/* The +/- glyph duplicates aria-expanded, so hide it from AT. */}
          <span aria-hidden="true">{isExpanded ? '−' : '+'}</span>{' '}
          {t('formatOptionsPanel.optionsHeading')}
        </span>
      </button>

      {isExpanded && (
        <div id={panelId} className="px-4 pb-4 pt-2 border-t border-border">
          {optionsContent}
        </div>
      )}
    </div>
  );
};

export default FormatOptionsPanel;
