import React from 'react';
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, Modifier } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PaneOptionsMenu, { PaneMenuOption } from './PaneOptionsMenu';
import { useTabKeyboardNav } from '../hooks/useTabKeyboardNav';
import { useI18n } from '../contexts/useI18n';

/**
 * DraggableTabBar Component (KAN-24)
 *
 * A reusable tab bar with drag-and-drop reordering capability.
 * Uses @dnd-kit for smooth, reliable drag-and-drop (same library as the web app).
 */

export interface TabItem {
  id: string;           // Unique identifier for the tab
  label: string;        // Display label for the tab
  subtitle?: string;    // Optional subtitle (e.g. module abbreviation)
  hasContent?: boolean; // Whether the tab has content (for styling)
}

interface DraggableTabBarProps {
  tabs: TabItem[];
  activeTabIndex: number;
  droppableId: string;
  onTabClick: (index: number) => void;
  onTabClose: (tabId: string) => void;
  onReorder: (sourceIndex: number, destinationIndex: number) => void;
  onAddClick: () => void;
  addButtonTitle?: string;
  addButtonTestId?: string;
  /** Custom tab content renderer. If provided, replaces the default label + close button. */
  renderTab?: (tab: TabItem, index: number, isActive: boolean) => React.ReactNode;
  /** Pane options menu items (shown at the far right of the tab bar) */
  paneMenuOptions?: PaneMenuOption[];
  /** When true, renders without outer container (for embedding in another tab bar row) */
  inline?: boolean;
  /** When true, allows tabs to wrap to multiple lines */
  wrap?: boolean;
  /** Content to render before the tabs (inside the same flex container) */
  prefixContent?: React.ReactNode;
  /** Accessible label for the tablist. Screen readers announce this. */
  ariaLabel?: string;
  /** Prefix for generating tab + tabpanel ids (so `aria-controls` can link). */
  idPrefix?: string;
}

/** Restrict dragging to horizontal axis only */
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

/**
 * Suffix for the strip-background droppable. One per bar, derived from
 * `droppableId`, so two tab bars on screen never share a drop target id.
 */
export const END_DROP_ZONE_SUFFIX = '__end';

/**
 * Where a drag that ended over `overId` should move the tab.
 *
 * The strip background is a droppable of its own that maps here to the end
 * of the list. Without it, only `SortableTab`s would be droppable and the
 * index would come from "the tab you dropped on" alone, so there would be no
 * `overId` that could ever mean "after the last one" - dropping in the empty
 * space to the right of the strip would do nothing at all.
 *
 * `to` is `length - 1`, NOT `length`, on purpose. Both reorder sinks
 * (`stores/commentary/slices/tabSlice.ts`, `stores/useBookStore.ts`) reject a
 * destination `>= openTabs.length`, and both apply the move as remove-then-
 * insert: after the dragged tab is spliced out, inserting at the original
 * `length - 1` puts it last. So `length - 1` already *is* "append at the end",
 * and expressing it that way needs no store change.
 */
export function resolveReorderTarget(
  tabIds: string[],
  activeId: string,
  overId: string,
  endDropId: string,
): { from: number; to: number } | null {
  const from = tabIds.indexOf(activeId);
  if (from === -1) return null;
  const to = overId === endDropId ? tabIds.length - 1 : tabIds.indexOf(overId);
  if (to === -1 || to === from) return null;
  return { from, to };
}

/**
 * The empty remainder of the tab strip, registered as a drop target meaning
 * "put it at the end".
 *
 * A trailing spacer rather than the `role="tablist"` row itself: the row
 * *contains* every tab, so making it a droppable would put a competing target
 * with a centre in the middle of the strip against the tabs it wraps, and
 * `closestCenter` would sometimes pick the container over the tab under the
 * cursor. A sibling that only covers the empty space cannot steal a drop that
 * was aimed at a tab. It is the same division of labour dockview uses between
 * `.dv-tab` and `.dv-void-container`.
 */
const EndDropZone: React.FC<{ id: string }> = ({ id }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-testid={`tab-strip-drop-zone-${id}`}
      aria-hidden="true"
      // min-width keeps the zone hoverable even when the tabs fill the row.
      className="flex-1 self-stretch"
      style={{
        minWidth: '24px',
        // A rule at the insertion point says *where* the drop will land.
        borderLeft: isOver ? '2px solid var(--theme-accent-primary)' : '2px solid transparent',
      }}
    />
  );
};

/** Individual sortable tab wrapper */
const SortableTab: React.FC<{
  id: string;
  isActive: boolean;
  hasContent?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tabId?: string;
  panelId?: string;
  ariaLabel?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}> = ({ id, isActive, hasContent, onClick, children, tabId, panelId, ariaLabel, onKeyDown }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
    // Visible insertion point. Before this, the only cue that a drag was even
    // live was the dragged tab's own 50% opacity - which says what is moving,
    // never where it will land.
    boxShadow: isOver && !isDragging ? 'inset 2px 0 0 0 var(--theme-accent-primary)' : undefined,
    borderBottom: isActive
      ? '3px solid var(--theme-accent-primary)'
      : '3px solid color-mix(in srgb, var(--theme-border-primary) 50%, transparent)',
    paddingTop: '6px',
    paddingBottom: '3px',
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="tab"
      id={tabId}
      aria-selected={isActive}
      aria-controls={panelId}
      aria-label={ariaLabel}
      tabIndex={isActive ? 0 : -1}
      className={`
        flex items-center gap-1.5 px-3 cursor-pointer
        transition-colors text-sm select-none flex-shrink-0
        border-e border-border
        ${hasContent ? 'bg-warning-soft' : ''}
        ${isActive
          ? 'text-text-primary font-semibold'
          : `text-text-secondary hover:text-text-primary ${hasContent ? 'hover:bg-warning-soft' : 'hover:bg-background-hover'}`
        }
      `}
      style={style}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
};

const DraggableTabBar: React.FC<DraggableTabBarProps> = ({
  tabs,
  activeTabIndex,
  droppableId,
  onTabClick,
  onTabClose,
  onReorder,
  onAddClick,
  addButtonTitle,
  addButtonTestId,
  renderTab,
  paneMenuOptions,
  inline = false,
  wrap = false,
  prefixContent,
  ariaLabel,
  idPrefix,
}) => {
  const { t } = useI18n();
  const { tablistRef, onKeyDown: handleTabKeyDown } = useTabKeyboardNav({
    tabCount: tabs.length,
    activeIndex: activeTabIndex,
    onActivate: onTabClick,
  });
  const tabIdFor = (index: number) =>
    idPrefix ? `${idPrefix}-tab-${index}` : undefined;
  const panelIdFor = (index: number) =>
    idPrefix ? `${idPrefix}-panel-${index}` : undefined;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
  );

  const tabIds = tabs.map(t => t.id);
  const endDropId = `${droppableId}${END_DROP_ZONE_SUFFIX}`;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const target = resolveReorderTarget(tabIds, String(active.id), String(over.id), endDropId);
    if (target) onReorder(target.from, target.to);
  };

  const content = (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={wrap ? [] : [restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabIds} strategy={wrap ? rectSortingStrategy : horizontalListSortingStrategy}>
          <div className={`flex items-stretch ${inline ? 'flex-1 min-w-0' : 'flex-1'} ${wrap ? 'flex-wrap' : ''}`}
            style={wrap ? {} : { overflowX: 'auto', overflowY: 'hidden' }}
            role="tablist"
            aria-label={ariaLabel ?? t('draggableTabBar.tabs')}
            ref={tablistRef}
            onKeyDown={handleTabKeyDown}
          >
            {prefixContent}
            {tabs.map((tab, index) => {
              const isActive = index === activeTabIndex;
              return (
                <SortableTab
                  key={tab.id}
                  id={tab.id}
                  isActive={isActive}
                  hasContent={tab.hasContent}
                  onClick={() => onTabClick(index)}
                  tabId={tabIdFor(index)}
                  panelId={panelIdFor(index)}
                  ariaLabel={tab.subtitle ? `${tab.label} ${tab.subtitle}` : tab.label}
                >
                  {renderTab ? (
                    renderTab(tab, index, isActive)
                  ) : (
                    <>
                      <span className="whitespace-nowrap">{tab.label}</span>
                      <button
                        className="text-sm leading-none p-0.5 rounded hover:text-danger hover:bg-danger-soft text-text-muted transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTabClose(tab.id);
                        }}
                        aria-label={`Close ${tab.label}`}
                      >
                        &times;
                      </button>
                    </>
                  )}
                </SortableTab>
              );
            })}
            {/* Add Button - inside scrollable area, right after last tab */}
            <button
              className="px-2.5 text-text-muted hover:bg-background-hover hover:text-text-primary transition-colors flex-shrink-0 text-sm font-medium"
              onClick={onAddClick}
              title={addButtonTitle ?? t('draggableTabBar.addTab')}
              aria-label={addButtonTitle}
              data-testid={addButtonTestId}
              style={{ paddingTop: '6px', paddingBottom: '3px' }}
            >
              +
            </button>
            {/* Strip background - "drop here to put the tab last". */}
            <EndDropZone id={endDropId} />
          </div>
        </SortableContext>
      </DndContext>

      {/* Pane options menu */}
      {paneMenuOptions && paneMenuOptions.length > 0 && (
        <div className="flex items-center px-1">
          <PaneOptionsMenu options={paneMenuOptions} />
        </div>
      )}
    </>
  );

  if (inline) {
    return content;
  }

  return (
    <div className="flex items-stretch border-b border-border" style={{ background: 'var(--theme-bg-secondary)' }}>
      {content}
    </div>
  );
};

export default DraggableTabBar;
