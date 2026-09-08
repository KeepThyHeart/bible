import { useCallback, useState } from 'react';

/**
 * Manages the Book/Chapter picker overlay state.
 *
 * The picker only ever navigates the panel it belongs to: one panel shows one
 * passage, so there is no longer an "open this in a new sub-tab" variant. A
 * second passage is a second dockview panel, opened from the "+" tab or a
 * Ctrl-click on a scripture reference.
 */
export function useBookPickerOverlay() {
  const [showBookPicker, setShowBookPicker] = useState(false);

  const open = useCallback(() => setShowBookPicker(true), []);
  const close = useCallback(() => setShowBookPicker(false), []);

  return {
    showBookPicker,
    setShowBookPicker,
    open,
    close,
  };
}
