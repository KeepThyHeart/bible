import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SerializedNote } from '../../../services/notesAPI';
import { usePrayerStore } from '../../../stores/usePrayerStore';
import PrayerListItem from './PrayerListItem';
import { useI18n } from '../../../contexts/useI18n';

interface PrayerListProps {
  onSelectPrayer: (prayer: SerializedNote) => void;
  onCreatePrayer: () => void;
}

const PrayerList: React.FC<PrayerListProps> = ({ onSelectPrayer, onCreatePrayer }) => {
  const { t } = useI18n();
  const { prayers, currentPrayerNote, selectedPrayerListId, reorderPrayers, updatePrayer, deletePrayer } = usePrayerStore();

  // KeyboardSensor is deliberate: the previous drag library gave this list
  // keyboard reordering for free, and dropping it would be an accessibility
  // regression. Space picks a row up, arrows move it, Space drops it - which is
  // why PrayerListItem's own key handler only claims Enter.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Save current prayer before selecting a new one
  const handleSelectPrayer = async (prayer: SerializedNote) => {
    // Save the current prayer first (if there is one and it's different)
    if (currentPrayerNote && currentPrayerNote.noteId !== prayer.noteId) {
      try {
        // Save the current prayer with its content from the store
        // Note: PrayerEditor syncs its local content to currentPrayerNote via updateCurrentNoteFields
        await updatePrayer(currentPrayerNote);
      } catch (error) {
        console.error('Failed to save prayer before switching:', error);
      }
    }
    onSelectPrayer(prayer);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedPrayerListId) return;

    const oldIndex = prayers.findIndex(p => String(p.noteId) === String(active.id));
    const newIndex = prayers.findIndex(p => String(p.noteId) === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const items = Array.from(prayers);
    const [reorderedItem] = items.splice(oldIndex, 1);
    items.splice(newIndex, 0, reorderedItem);

    const prayerIds = items.map(p => p.noteId!);
    reorderPrayers(selectedPrayerListId, prayerIds).catch(error => {
      console.error('Failed to reorder prayers:', error);
    });
  };

  return (
    <div className="h-full flex flex-col bg-surface border-e border-border">
      {/* Header */}
      <div className="p-md border-b border-border">
        <button
          type="button"
          onClick={onCreatePrayer}
          className="w-full px-md py-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover text-sm font-medium"
        >
          {t('prayerList.newPrayerButton')}
        </button>
      </div>

      {/* Prayer list */}
      <div className="flex-1 overflow-y-auto p-sm">
        {prayers.length === 0 ? (
          <div className="text-sm text-text-secondary italic p-md text-center">
            {selectedPrayerListId === null
              ? t('prayerList.noListSelected')
              : t('prayerList.emptyList')}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={prayers.map(p => String(p.noteId))}
              strategy={verticalListSortingStrategy}
            >
              <div>
                {prayers.map((prayer, index) => {
                  // Use currentPrayerNote for the selected prayer to show live data
                  // This ensures the title and content are up-to-date even when
                  // the prayers array hasn't been refreshed yet
                  const isSelected = currentPrayerNote?.noteId === prayer.noteId;
                  const displayPrayer = isSelected && currentPrayerNote ? currentPrayerNote : prayer;
                  return (
                    <PrayerListItem
                      key={prayer.noteId}
                      prayer={displayPrayer}
                      index={index}
                      isSelected={isSelected}
                      onSelect={() => handleSelectPrayer(prayer)}
                      onDelete={() => prayer.noteId != null && deletePrayer(prayer.noteId)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Instructions */}
      {prayers.length > 0 && (
        <div className="p-sm border-t border-border bg-background-warm text-xs text-text-secondary text-center">
          {t('prayerList.dragToReorder')}
        </div>
      )}
    </div>
  );
};

export default PrayerList;
