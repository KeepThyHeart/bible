import { useState } from 'react';

/** Open/closed state for the navigation history dropdown in the bible toolbar. */
export function useHistoryDropdown() {
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  return { showHistoryDropdown, setShowHistoryDropdown };
}
