import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SerializedNote } from '../../../services/notesAPI';
import { PrayerColor, getColorClass } from './ColorSelector';
import { useI18n } from '../../../contexts/useI18n';

interface PrayerListItemProps {
  prayer: SerializedNote;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const PrayerListItem: React.FC<PrayerListItemProps> = ({ prayer, index, isSelected, onSelect, onDelete }) => {
  const { t } = useI18n();
  const color = prayer.metadata?.color as PrayerColor | undefined;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: String(prayer.noteId) });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selecting the prayer when clicking delete
    if (confirm(t('prayerListItem.deleteConfirm'))) {
      onDelete();
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      onKeyDown={(e) => {
        // Enter only: Space belongs to the keyboard drag sensor, which
        // bails out if the keydown has already been default-prevented.
        if (e.key === 'Enter') {
          e.preventDefault();
          onSelect();
        }
      }}
      /* Not a <button>: the row is the drag handle and carries a nested
         delete button, so the role has to be applied by hand. */
      role="button"
      tabIndex={0}
      aria-current={isSelected ? 'true' : undefined}
      className={`group flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
        isDragging
          ? 'bg-accent-soft shadow-lg rounded'
          : isSelected
          ? 'bg-accent-soft'
          : 'hover:bg-background-hover'
      } ${index > 0 ? 'border-t border-border' : ''}`}
    >
      {/* Drag handle indicator */}
      <div className="text-text-muted text-xs" aria-hidden="true">⋮⋮</div>

      {/* Small color dot */}
      {color && color !== 'none' && (
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getColorClass(color)}`} aria-hidden="true" />
      )}

      {/* Prayer title only - no description */}
      <div className="flex-1 min-w-0 text-sm truncate">
        {prayer.title || t('prayerListItem.untitledPrayer')}
      </div>

      {/* Delete button - visible on hover */}
      <button
        type="button"
        onClick={handleDelete}
        className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-danger transition-opacity"
        title={t('prayerListItem.deleteTitle')}
        aria-label={t('prayerListItem.deleteTitle')}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
};

export default PrayerListItem;
