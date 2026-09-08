import { useState } from 'react';
import { CopyOptionsDialogState } from '../../BiblePaneContext';

/** Manages the copy-options dialog state. */
export function useCopyDialog() {
  const [copyOptionsDialog, setCopyOptionsDialog] = useState<CopyOptionsDialogState | null>(null);
  return { copyOptionsDialog, setCopyOptionsDialog };
}
