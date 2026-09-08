import { useState } from 'react';

/**
 * Manages the Bible module/version selector overlay state.
 * `versionSelectorTabId` is set when the selector is opened for a specific tab,
 * `showSelector` is the global open flag.
 */
export function useModulePickerOverlay() {
  const [showSelector, setShowSelector] = useState(false);
  const [versionSelectorTabId, setVersionSelectorTabId] = useState<string | null>(null);

  return {
    showSelector,
    setShowSelector,
    versionSelectorTabId,
    setVersionSelectorTabId,
  };
}
