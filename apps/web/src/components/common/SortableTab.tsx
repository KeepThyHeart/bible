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

/**
 * After a tab closes, put keyboard focus on the tab that became active (or, failing
 * that, the strip's `fallback` control, e.g. the "+" button) instead of losing it to
 * <body>. Waits a frame so the strip has re-rendered; `list` is the tablist captured
 * before the close (the strip's element survives the re-render).
 */
export function focusAfterTabClose(list: Element | null, fallback?: string) {
  if (!list) return;
  const strip = list.parentElement ?? list;
  requestAnimationFrame(() => {
    const el =
      list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      list.querySelector<HTMLElement>('[role="tab"]') ??
      (fallback ? strip.querySelector<HTMLElement>(fallback) : null);
    el?.focus();
  });
}

/**
 * Enter/Space on a non-native tab element runs `activate`; arrows navigate the strip.
 * When `close` is given, Delete closes the focused tab (omit it for tabs that can't close).
 */
export function tabKeyDown(activate: () => void, close?: (list: Element | null) => void) {
  return (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Delete' && close) {
      e.preventDefault();
      close((e.currentTarget as HTMLElement).closest('[role="tablist"]'));
      return;
    }
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
