/**
 * VerseFormatPicker.tsx
 *
 * The passage dialog's format chooser: one radio per format, stacked in a
 * column with each format's description beneath its name and its **number** in
 * a badge in front of it.
 *
 * The list is the whole of `formatCatalog` - five formats, in one order, under
 * one set of numbers. One dialog and one picker keeps `2` the same shape
 * wherever it is typed; two pickers offering two different subsets would make
 * "format 2" name two different things depending on which dialog you opened.
 *
 * **The descriptions are load-bearing.** Five formats - cut down from seven
 * because the product owner could not tell Standard from Numbered Quote
 * apart - are what's offered, and the fix for a list whose entries look alike
 * is not only fewer entries but saying what each one does. That is why this
 * is a stacked list with a line of prose under every name rather than a row
 * of toggle buttons.
 *
 * **A retired format appears only when it is the one selected.** Notes written
 * before the list was cut carry `standard` or `combined`; re-formatting one has
 * to show what it currently *is*, or the picker opens with nothing selected and
 * the user cannot tell what Apply would preserve. Such an entry carries no
 * number, because the digits index the offered list and nothing else, and
 * cannot be chosen again once the user moves off it.
 *
 * The badge is `aria-hidden`: it is a keyboard hint, not part of the format's
 * name, and a screen reader announcing "three inline quote" would read as a
 * count. The hint line the dialog renders beneath this control is what says the
 * numbers are keys.
 *
 * Radios rather than a tab-toggle button group. It is a single-choice list,
 * which is what a radio group *is* - and, more practically, the picker shares
 * the dialog's left column with the options beneath it, where a horizontal row
 * of toggle buttons would have to compete for width. Native radios also bring
 * their own keyboard behaviour (arrow keys move *and* select, so arrowing down
 * the list plays each shape through the preview beside it) for free.
 */

import React from 'react';
import { getPassageFormatCatalog } from '../../services/copyFormats';
import { useI18n } from '../../contexts/useI18n';

export interface VerseFormatPickerProps {
  selectedFormatId: string;
  onSelect: (formatId: string) => void;
  className?: string;
  /** Id of the element naming this group, for `aria-labelledby`. */
  labelledBy?: string;
}

export const VerseFormatPicker: React.FC<VerseFormatPickerProps> = ({
  selectedFormatId,
  onSelect,
  className = '',
  labelledBy,
}) => {
  const { t } = useI18n();
  // The selected id is offered to the catalog so that a retired format the
  // user is currently sitting on still resolves to a visible, labelled row.
  const allFormats = getPassageFormatCatalog({ includeIds: [selectedFormatId] });
  // Unique per instance so two pickers on one screen do not share a radio
  // group and fight over the selection.
  const groupName = React.useId();

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={`space-y-1 ${className}`}
    >
      {allFormats.map((format) => {
        const isSelected = format.id === selectedFormatId;
        return (
          <label
            key={format.id}
            data-format-id={format.id}
            data-format-legacy={format.legacy ? '' : undefined}
            className={`flex items-start gap-3 cursor-pointer rounded-md px-2 py-2 transition-colors ${
              isSelected ? 'bg-background-active' : 'hover:bg-background-hover'
            }`}
          >
            <input
              type="radio"
              name={groupName}
              value={format.id}
              checked={isSelected}
              onChange={() => onSelect(format.id)}
              className="mt-0.5 w-4 h-4 text-accent border-border-secondary focus:ring-accent focus:ring-2"
            />
            {/* A retired format has no number: the digits index the offered
                list, and a badge reading "0" would be a shortcut that is not
                one. */}
            {format.number > 0 && (
              <span
                aria-hidden="true"
                data-format-number={format.number}
                className={`mt-0.5 shrink-0 w-5 h-5 rounded text-xs font-semibold flex items-center justify-center ${
                  isSelected
                    ? 'bg-accent text-text-on-accent'
                    : 'bg-background-tertiary text-text-secondary'
                }`}
              >
                {format.number}
              </span>
            )}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text-primary">
                {t(`${format.labelKey}.name`)}
              </span>
              <span className="block text-xs text-text-tertiary">
                {format.legacy
                  ? t('ui.passageInsert.retiredFormat')
                  : t(`${format.labelKey}.description`)}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
};

export default VerseFormatPicker;
