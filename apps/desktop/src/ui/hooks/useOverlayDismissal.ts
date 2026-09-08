import { useEffect } from 'react';

/**
 * Closes an overlay (context menu, popup, etc.) when the user clicks outside
 * or presses Escape.
 *
 * @param isOpen  Whether the overlay is currently visible.
 * @param onClose Callback to dismiss the overlay. Must be stable (wrap in
 *                useCallback or use a setState dispatch).
 *
 * Usage:
 *   useOverlayDismissal(!!contextMenu, () => setContextMenu(null));
 *
 * The overlay element itself should call `e.stopPropagation()` on mousedown
 * to prevent the document-level listener from closing it immediately.
 */
export function useOverlayDismissal(isOpen: boolean, onClose: () => void): void {
  useEscapeKey(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (): void => onClose();
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, onClose]);
}

/**
 * Escape closes it - the half of {@link useOverlayDismissal} that a *modal*
 * wants on its own.
 *
 * A dialog that takes over the screen already has a backdrop click and a
 * Cancel button; adding the document-wide mousedown listener as well would
 * close it on any click inside it that did not stop propagation. Escape is the
 * generic Cancel and every popup should answer it, so this exists to be
 * dropped into the ones that do not.
 *
 * @param isOpen  Whether the dialog is currently visible.
 * @param onClose Callback to dismiss it. Must be stable (wrap in `useCallback`
 *                or use a setState dispatch).
 */
export function useEscapeKey(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
}
