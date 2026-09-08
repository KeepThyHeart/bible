import { useState } from 'react';

/**
 * Manages the Parallel-view picker overlay state and the four version slots.
 */
export function useParallelPickerOverlay() {
  const [showParallelPicker, setShowParallelPicker] = useState(false);
  const [parallelSelections, setParallelSelections] = useState<string[]>(['', '', '', '']);

  return {
    showParallelPicker,
    setShowParallelPicker,
    parallelSelections,
    setParallelSelections,
  };
}
