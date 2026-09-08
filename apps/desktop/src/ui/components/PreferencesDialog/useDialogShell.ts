/**
 * useDialogShell.ts
 *
 * Hook bundling the modal-dialog shell behaviors used by
 * PreferencesDialog: Escape-to-close key handler and focus trap.
 * Extracted from PreferencesDialog.tsx as part of the 2026-04-14
 * desktop cleanup (item 2.1).
 *
 * Both behaviors now come from `activateFocusTrap` - the same implementation
 * `useFocusTrap` uses - so Escape handling lives in one place for every dialog
 * in the app. This variant exists only because its callers own their dialog ref
 * themselves rather than taking the one `useFocusTrap` returns.
 */

import { RefObject, useEffect, useRef } from 'react';
import { activateFocusTrap } from '../../utils/focusTrap';

export function useDialogShell(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  // Held in a ref so callers can pass an inline arrow function without the
  // effect below re-running on every render, which would re-activate the trap
  // and pull focus back to the first control.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Trap focus within the dialog while it is open, and close it on Escape.
  // Escape is handled by the trap's own listener on the dialog element rather
  // than a window listener so that a dialog stacked on top of another closes
  // only itself - the trap stops propagation before the outer dialog sees it.
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const handle = activateFocusTrap(node, {
      onEscape: () => onCloseRef.current(),
    });
    return () => handle.release();
  }, [dialogRef]);
}
