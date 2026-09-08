/**
 * "Which passage, and how should it be laid out?" - the notes editor's entry
 * point into {@link PassageDialog}.
 *
 * This file is the adapter: the notes editor's vocabulary
 * (`isReformat`, `promptForReference`, an expansion id, a placement) mapped
 * onto the dialog's `mode`. Everything visible - the reference box, the
 * translation picker, the five formats and their numbers, the per-format
 * options, the live preview - lives in the shared dialog, which is the point:
 * a passage inserted into a note and the same passage on the clipboard can no
 * longer disagree about what "Numbered quote" means.
 *
 * Two things the notes side still owns, and the dialog takes as props:
 *
 *   - **`asBlock`** - Tab appending beneath a sentence needs even a one-line
 *     format to be a block, because the reference it came from is part of a
 *     sentence that must survive.
 *   - **the skip-format-menu checkbox** - "always use this format" is about
 *     what *Tab* does, so it is offered only on the Tab-shaped paths: not
 *     while re-formatting, and not from the toolbar, where the user came here
 *     precisely to make a choice.
 */
import React from 'react';
import PassageDialog from '../../PassageDialog';
import type { PassageInsertOptions } from '../../../services/copyFormats';
import type { CachedVerse } from '../../../services/verseFetchCache';

export interface VerseExpandPopoverProps {
  /**
   * The reference text being expanded, for the header - and, in prompt mode,
   * the initial contents of the reference field (usually empty).
   */
  referenceText: string;
  /**
   * Verses already fetched for the reference. Never empty, except in prompt
   * mode, where the user has not named a passage yet.
   */
  verses: CachedVerse[];
  /** Translation the verses came from. */
  translation: string;
  /**
   * Ask the user which passage to insert, rather than being handed one.
   *
   * This is what makes "+ Bible Passage" and "type a reference, press Tab" the
   * same feature rather than two half-features that produced different markup.
   */
  promptForReference?: boolean;
  onCancel: () => void;
  /** Called with the HTML to insert. */
  onInsert: (html: string) => void;
  /**
   * Identity stamped onto the inserted passage so it can be re-formatted
   * later. Re-formatting an existing expansion reuses its id, so the passage
   * keeps the same identity across format changes.
   */
  expansionId: string;
  /** Pre-selected format - the expansion's current one when re-formatting. */
  initialFormatId?: string;
  initialOptions?: PassageInsertOptions;
  /** True when editing a passage already in the document, not inserting one. */
  isReformat?: boolean;
  /**
   * The passage is going into a paragraph of its own (Tab appending beneath a
   * sentence), so even a one-line format has to be a block.
   */
  asBlock?: boolean;
}

const VerseExpandPopover: React.FC<VerseExpandPopoverProps> = ({
  referenceText,
  verses,
  translation,
  promptForReference = false,
  onCancel,
  onInsert,
  expansionId,
  initialFormatId,
  initialOptions,
  isReformat = false,
  asBlock = false,
}) => (
  <PassageDialog
    mode={isReformat ? 'reformat' : 'insert'}
    verses={verses}
    referenceText={referenceText}
    translation={translation}
    promptForReference={promptForReference}
    onClose={onCancel}
    onInsert={onInsert}
    expansionId={expansionId}
    initialFormatId={initialFormatId}
    initialOptions={initialOptions}
    asBlock={asBlock}
    offerSkipFormatMenu={!isReformat && !promptForReference}
  />
);

export default VerseExpandPopover;
