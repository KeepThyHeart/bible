import { RefObject, useEffect } from 'react';

/**
 * Wires up dialog-level keyboard and pointer behaviours:
 *   - Escape closes the dialog
 *   - Ctrl/Cmd+F inside the dialog focuses/selects the search input
 *   - A mousedown outside the dialog closes it
 */
export function useDialogKeyboard(
  dialogRef: RefObject<HTMLElement | null>,
  searchInputRef: RefObject<HTMLInputElement | null>,
  onClose: () => void,
): void {
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dialogRef, onClose]);

  // Ctrl/Cmd+F focuses search while the dialog has focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (
          dialogRef.current?.contains(document.activeElement) ||
          dialogRef.current === document.activeElement
        ) {
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogRef, searchInputRef]);
}
