/**
 * The shape controls for a note-insertion format: where the reference goes,
 * how verse numbers are written, which heading level, which quote marks.
 *
 * Only the controls the selected format actually uses are rendered - heading
 * level means nothing to an inline quotation - which is what
 * `PassageMarkupFormatMeta.controls` is for. The two *universal* options
 * ("Display translation", "Words of Christ in red") are not here: they are
 * `FormatOptionsPanel`, shared verbatim with the copy dialog, and rendered
 * alongside this.
 *
 * Selects rather than button groups so the whole panel is a handful of tab
 * stops, which is what makes the popover navigable from the keyboard without
 * a bespoke roving-focus scheme in every control.
 */

import React from 'react';
import {
  getPassageMarkupFormat,
  resolvePassageMarkupOptions,
  type HeadingLevel,
  type PassageInsertOptions,
  type PassageMarkupFormatId,
  type PassageMarkupOptions,
  type PassageMarkupShapeOptions,
  type PassageReferencePosition,
  type QuoteMarkStyle,
  type VerseNumberStyle,
} from '../services/copyFormats';
import { useI18n } from '../contexts/useI18n';

export interface PassageMarkupOptionsPanelProps {
  formatId: PassageMarkupFormatId;
  options: PassageInsertOptions;
  onOptionsChange: (options: PassageMarkupOptions) => void;
}

/**
 * H1-H3 only, because that is what the note editor's schema has:
 * `NoteEditor` configures StarterKit with `heading: { levels: [1, 2, 3] }`,
 * and TipTap builds parse rules only for the levels it was given - an `<h4>`
 * would come back as a plain paragraph, silently losing the heading. Offering
 * six levels and honouring three is worse than offering three.
 */
const EDITOR_HEADING_LEVELS: HeadingLevel[] = [1, 2, 3];

const SELECT_CLASS =
  'text-sm rounded border border-border-secondary bg-surface text-text-primary px-2 py-1';

const PassageMarkupOptionsPanel: React.FC<PassageMarkupOptionsPanelProps> = ({
  formatId,
  options,
  onOptionsChange,
}) => {
  const { t } = useI18n();
  const meta = getPassageMarkupFormat(formatId);
  const resolved = resolvePassageMarkupOptions(formatId, options);
  const baseId = React.useId();

  if (!meta) return null;

  const update = <K extends keyof PassageMarkupOptions>(
    key: K,
    value: PassageMarkupOptions[K],
  ): void => {
    onOptionsChange({ ...resolved, [key]: value });
  };

  const uses = (control: keyof PassageMarkupShapeOptions): boolean => meta.controls.includes(control);

  return (
    <div className="flex flex-wrap gap-3">
      {uses('referencePosition') && (
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <span id={`${baseId}-ref`}>
            {t('ui.passageInsert.referenceLabel')}
          </span>
          <select
            aria-labelledby={`${baseId}-ref`}
            className={SELECT_CLASS}
            value={resolved.referencePosition}
            onChange={e => update('referencePosition', e.target.value as PassageReferencePosition)}
          >
            <option value="before">{t('ui.passageInsert.referenceBefore')}</option>
            <option value="after">{t('ui.passageInsert.referenceAfter')}</option>
            <option value="none">{t('ui.passageInsert.referenceNone')}</option>
          </select>
        </label>
      )}

      {uses('verseNumbers') && (
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <span id={`${baseId}-nums`}>
            {t('ui.passageInsert.verseNumbersLabel')}
          </span>
          <select
            aria-labelledby={`${baseId}-nums`}
            className={SELECT_CLASS}
            value={resolved.verseNumbers}
            onChange={e => update('verseNumbers', e.target.value as VerseNumberStyle)}
          >
            <option value="parenthetical">
              {t('ui.passageInsert.verseNumbersParenthetical')}
            </option>
            <option value="superscript">
              {t('ui.passageInsert.verseNumbersSuperscript')}
            </option>
            <option value="none">{t('ui.passageInsert.verseNumbersNone')}</option>
          </select>
        </label>
      )}

      {uses('headingLevel') && (
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <span id={`${baseId}-heading`}>
            {t('ui.passageInsert.headingLevelLabel')}
          </span>
          <select
            aria-labelledby={`${baseId}-heading`}
            className={SELECT_CLASS}
            value={resolved.headingLevel}
            onChange={e => update('headingLevel', Number(e.target.value) as HeadingLevel)}
          >
            {EDITOR_HEADING_LEVELS.map(level => (
              <option key={level} value={level}>{`H${level}`}</option>
            ))}
          </select>
        </label>
      )}

      {uses('quoteMarks') && (
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <span id={`${baseId}-quotes`}>
            {t('ui.passageInsert.quoteMarksLabel')}
          </span>
          <select
            aria-labelledby={`${baseId}-quotes`}
            className={SELECT_CLASS}
            value={resolved.quoteMarks}
            onChange={e => update('quoteMarks', e.target.value as QuoteMarkStyle)}
          >
            <option value="double">{'“”'}</option>
            <option value="single">{'‘’'}</option>
            <option value="none">{t('ui.passageInsert.quoteMarksNone')}</option>
          </select>
        </label>
      )}

      {/* A checkbox rather than a select, because unlike the others this is not
          a choice between renderings of the same thing - it either adds a row
          of writing prompts or it does not. */}
      {uses('commentPlaceholders') && (
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            className="w-3.5 h-3.5"
            checked={resolved.commentPlaceholders}
            onChange={e => update('commentPlaceholders', e.target.checked)}
          />
          {t('ui.passageInsert.commentPlaceholdersLabel')}
        </label>
      )}
    </div>
  );
};

export default PassageMarkupOptionsPanel;
