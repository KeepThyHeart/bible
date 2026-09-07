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
}

export function SortableTab({ id, disabled, class: className, children, onClick, onDblClick, title, touchAction }: SortableTabProps) {
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
      style={style}
    >
      {children}
    </div>
  );
}
