/**
 * TabStrip.tsx
 *
 * An accessible, keyboard-navigable tab strip component (ARIA tablist/tab).
 * Wraps the existing useTabKeyboardNav hook to handle arrow keys, Home, End,
 * and provides automatic tab activation on keyboard navigation.
 *
 * Props:
 * - tabs: Array of {id, label, testId?} representing the main tabs.
 * - activeId: The currently active tab ID.
 * - onChange: Called when a different tab is activated.
 * - trailingTabs: Optional array of {id, label, testId?} for a right-aligned,
 *   visually separated group (e.g., "Feature packs", "Sources").
 * - ariaLabel: Optional aria-label for the tablist container.
 *
 * Styling matches ModuleManagerDialog's tab appearance:
 * - Active tab: bg-surface, text-accent, border-t-2 border-s border-e border-accent
 * - Inactive tab: bg-background-tertiary, text-text-secondary, hover:bg-background-active
 */

import React, { useMemo } from 'react';
import { useTabKeyboardNav } from '../../hooks/useTabKeyboardNav';

export interface TabStripTab {
  id: string;
  label: string;
  testId?: string;
}

export interface TabStripProps {
  /** Array of main tabs to display. */
  tabs: TabStripTab[];
  /** Currently active tab ID. */
  activeId: string;
  /** Called when a tab is activated (clicked or via keyboard). */
  onChange: (tabId: string) => void;
  /** Optional right-aligned, visually separated tabs (e.g., "Feature packs"). */
  trailingTabs?: TabStripTab[];
  /** Optional aria-label for the tablist container. */
  ariaLabel?: string;
}

export const TabStrip: React.FC<TabStripProps> = ({
  tabs,
  activeId,
  onChange,
  trailingTabs = [],
  ariaLabel,
}) => {
  const allTabs = useMemo(() => [...tabs, ...trailingTabs], [tabs, trailingTabs]);
  const activeIndex = allTabs.findIndex(t => t.id === activeId);

  const { tablistRef, onKeyDown } = useTabKeyboardNav({
    tabCount: allTabs.length,
    activeIndex: Math.max(activeIndex, 0),
    onActivate: (index) => onChange(allTabs[index].id),
  });

  const renderTab = (tab: TabStripTab) => {
    const isActive = tab.id === activeId;
    return (
      <button
        key={tab.id}
        type="button"
        role="tab"
        id={`tab-${tab.id}`}
        aria-selected={isActive}
        aria-controls={`panel-${tab.id}`}
        tabIndex={isActive ? 0 : -1}
        onClick={() => onChange(tab.id)}
        data-testid={tab.testId}
        className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
          isActive
            ? 'bg-surface text-accent border-t-2 border-s border-e border-accent'
            : 'bg-background-tertiary text-text-secondary hover:bg-background-active'
        }`}
      >
        {tab.label}
      </button>
    );
  };

  return (
    <div className="px-6 pt-4 border-b border-border">
      <div
        className="flex gap-1"
        role="tablist"
        aria-label={ariaLabel}
        ref={tablistRef}
        onKeyDown={onKeyDown}
      >
        {/* Main tabs */}
        {tabs.map(renderTab)}

        {/* Trailing tabs group (visually separated) */}
        {trailingTabs.length > 0 && (
          <>
            <div className="flex-1" />
            {trailingTabs.map(renderTab)}
          </>
        )}
      </div>
    </div>
  );
};

export default TabStrip;
