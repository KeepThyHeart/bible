import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ComponentChildren } from 'preact';

interface SortableTabProps {
  id: string;
  disabled?: boolean;
  class?: string;
  children: ComponentChildren;
  onClick?: () => void;
  onDblClick?: () => void;
  title?: string;
  /** Override touch-action to allow scrolling (e.g. 'pan-x' for horizontal scroll) */
  touchAction?: string;
  /**
   * The wrapper only carries drag-and-drop; the real tab (role="tab") is an
   * element inside it, with the close button as a sibling. Drops the wrapper's
   * dnd-kit button semantics so controls are not nested inside a "button".
   */
  presentational?: boolean;
}

/**
 * Arrow-key / Home / End navigation for a `role="tablist"` strip whose tabs
 * (`[role="tab"]`) are spread over wrapper elements. Attach to each tab's onKeyDown.
 * Focus moves (roving tabindex); activation stays with Enter/Space via
 * {@link activateOnKey}.
 */
export function tablistKeyDown(e: KeyboardEvent) {
  const el = e.currentTarget as HTMLElement | null;
  const list = el?.closest('[role="tablist"]');
  if (!el || !list) return;
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
  const i = tabs.indexOf(el);
  if (i < 0) return;
  const rtl = getComputedStyle(list).direction === 'rtl';
  let next = -1;
  if (e.key === 'ArrowRight') next = rtl ? i - 1 : i + 1;
  else if (e.key === 'ArrowLeft') next = rtl ? i + 1 : i - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = tabs.length - 1;
  if (next < 0 || next >= tabs.length) return;
  e.preventDefault();
  tabs[next].focus();
}

/** Enter/Space on a non-native tab element runs `activate`; arrows navigate the strip. */
export function tabKeyDown(activate: () => void) {
  return (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
      return;
    }
    tablistKeyDown(e);
  };
}

const PRESENTATIONAL = {
  role: 'presentation',
  tabIndex: undefined,
  'aria-pressed': undefined,
  'aria-roledescription': undefined,
  'aria-describedby': undefined,
  'aria-disabled': undefined,
} as any;

export function SortableTab({ id, disabled, class: className, children, onClick, onDblClick, title, touchAction, presentational }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 1 : undefined,
    touchAction: touchAction || undefined,
  } as any;

  return (
    <div
      ref={setNodeRef}
      class={className}
      onClick={onClick}
      onDblClick={onDblClick}
      title={title}
      {...(attributes as any)}
      {...(listeners as any)}
      {...(presentational ? PRESENTATIONAL : {})}
      style={style}
    >
      {children}
    </div>
  );
}
