/**
 * "Copy Passage" - the Bible pane's entry point into {@link PassageDialog}.
 *
 * This is only the adapter: it turns the Bible pane's vocabulary - a
 * `VerseContext` and a translation abbreviation - into the passage dialog's.
 *
 * Kept as its own component rather than folded into `BiblePaneOverlays` so the
 * pane keeps naming the thing it opens, and so the mode is chosen in one place
 * instead of at every call site.
 */

import React, { useMemo } from 'react';
import PassageDialog from './PassageDialog';
import type { BibleVerse, VerseContext } from '../services/verseCopyService';
import { getDisplayReference } from '../services/verseRangeService';

export interface CopyOptionsDialogProps {
  verses: BibleVerse | BibleVerse[];
  context: VerseContext;
  /** Bible translation abbreviation for fetching new verses */
  bibleAbbreviation?: string;
  onClose: () => void;
  onCopy?: () => void;
}

const CopyOptionsDialog: React.FC<CopyOptionsDialogProps> = ({
  verses,
  context,
  bibleAbbreviation,
  onClose,
  onCopy,
}) => {
  const versesArray = useMemo(() => (Array.isArray(verses) ? verses : [verses]), [verses]);
  const reference = useMemo(
    () => getDisplayReference(versesArray, context.bookName),
    [versesArray, context.bookName],
  );

  return (
    <PassageDialog
      mode="copy"
      verses={versesArray}
      referenceText={reference}
      translation={bibleAbbreviation || context.translation}
      onClose={onClose}
      onCopied={onCopy}
    />
  );
};

export default CopyOptionsDialog;
