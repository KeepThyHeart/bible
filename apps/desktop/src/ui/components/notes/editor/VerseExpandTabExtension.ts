/**
 * Tab on a Bible reference asks how the passage should be pasted.
 *
 * Typing `John 3:16` and pressing Tab opens the format picker
 * (`VerseExpandPopover`) over the reference: whole passage as a block quote,
 * a numbered quote, a heading per verse, an inline quotation, or any of the
 * clipboard formats. The last format used is pre-selected, so the common case
 * is Tab, Enter.
 *
 * It asks rather than just inserting because the four shapes are genuinely
 * different documents - a preacher quoting a paragraph and one working through
 * a passage verse by verse want opposite things, and the right answer changes
 * from line to line. Someone who has settled on one can tick "always use this
 * format" in the picker, which sets `skipFormatMenu`; Tab then expands
 * silently in the remembered format, with no picker in the way. Right-click ->
 * "Expand to full text..." always opens the picker, which is how the menu comes
 * back.
 *
 * Placement depends on where the reference is, on both paths:
 *
 * - **Alone on its own line** - a citation on its own. The passage replaces it.
 * - **Inside a sentence** ("as Paul says in Rom 8:28, we know...") - the
 *   sentence has to survive, so the reference is left alone and the passage is
 *   inserted as a new paragraph beneath it.
 *
 * ## Why a keymap extension and not the container keydown handler
 *
 * `priority: 1000` puts this ahead of `@tiptap/extension-table`'s Tab binding
 * (priority 100) and `ListItem`/`TaskItem`'s (51), so a reference typed inside
 * a table cell expands rather than jumping to the next cell. The container
 * handler in `NoteEditor` is a React bubble-phase listener that runs *after*
 * ProseMirror, by which time `goToNextCell` has already moved the caret.
 *
 * Returning `false` when there is no reference at the caret is what keeps
 * every existing Tab behaviour bit-for-bit unchanged - ProseMirror continues
 * down the plugin list to Table, then ListItem, then the container handler's
 * soft-tab. Verified: with the caret in a list item and this handler returning
 * false, `sinkListItem` still runs.
 */
import { Extension } from '@tiptap/core';
import { getVerseReferenceRanges } from './VerseReferencePlugin';
import { findRangeEndingAt, type VerseRefRange } from './verseReferenceRanges';
import { getBlockContext } from './verseExpansionRanges';
import { newExpansionId } from './VerseExpansionMark';
import {
  expandReference,
  loadInsertOptions,
  type ExpandFailureReason,
} from '../../../services/verseExpansionService';
import {
  getLastInsertFormatId,
  getSkipFormatMenu,
  type PassageMarkupLabels,
} from '../../../services/copyFormats';

/** Everything the host needs to open the picker over a reference. */
export interface VerseExpandRequest {
  range: VerseRefRange;
  /** Replace the reference, or leave it and add the passage below. */
  placement: 'replace' | 'after-block';
  /** Position to insert after, for `'after-block'`. */
  blockEnd: number;
  /** Identity to stamp on whatever is inserted. */
  expansionId: string;
}

export interface VerseExpandTabOptions {
  /**
   * Tab found a reference: open the format picker over it. The fetch happens
   * in the host, not here - a keymap cannot await one before deciding whether
   * to consume the key.
   */
  onExpandRequest?: (request: VerseExpandRequest) => void;
  /**
   * Reports why a *silent* expansion did not happen (the "always use this
   * format" path). Tab claims the key synchronously, so without this a refusal
   * is a keypress that visibly does nothing.
   */
  onExpandFailed?: (reason: ExpandFailureReason, referenceText: string, verseCount?: number) => void;
  /**
   * Localized templates the renderer cannot produce itself. Only the silent
   * path needs them - the picker builds its own set from the catalog.
   */
  markupLabels?: PassageMarkupLabels;
}

export const VerseExpandTabExtension = Extension.create<VerseExpandTabOptions>({
  name: 'verseExpandTab',
  priority: 1000,

  addOptions() {
    return {};
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { editor } = this;
        const { state } = editor;
        const { empty, $head } = state.selection;
        // A selection means the user is doing something else with Tab.
        if (!empty) return false;

        const range = findRangeEndingAt(getVerseReferenceRanges(state), $head.pos);
        if (!range) return false;

        const block = getBlockContext(state.doc, range);
        if (!block) return false;

        const expansionId = newExpansionId();
        const placement = block.referenceIsAlone ? 'replace' : 'after-block';

        if (!getSkipFormatMenu()) {
          this.options.onExpandRequest?.({
            range,
            placement,
            blockEnd: block.blockEnd,
            expansionId,
          });
          // Claimed synchronously: the decision ("a reference ends here") is
          // already made, and a keymap cannot await a fetch before deciding
          // whether to consume the key.
          return true;
        }

        const formatId = getLastInsertFormatId();
        void expandReference(
          editor,
          range,
          formatId,
          loadInsertOptions(formatId),
          {
            placement,
            blockEnd: block.blockEnd,
            meta: { expansionId, reference: range.text },
            labels: this.options.markupLabels,
          },
        ).then(result => {
          if (!result.ok) {
            this.options.onExpandFailed?.(result.reason, range.text, result.verseCount);
          }
        });

        return true;
      },
    };
  },
});

export default VerseExpandTabExtension;
