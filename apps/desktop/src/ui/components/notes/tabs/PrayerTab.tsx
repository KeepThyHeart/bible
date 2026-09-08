import React, { useState, useEffect } from 'react';
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
import { useI18n } from '../../../contexts/useI18n';
import { usePrayerStore } from '../../../stores/usePrayerStore';
import PrayerListItem from '../prayer/PrayerListItem';
import PrayerEditor from '../prayer/PrayerEditor';
import TextInputDialog from '../../TextInputDialog';
import PrayerListConfigDialog from '../prayer/PrayerListConfigDialog';
import { SerializedNote } from '../../../services/notesAPI';

const PrayerTab: React.FC = () => {
  const { t } = useI18n();
  const {
    currentPrayerNote,
    setCurrentPrayerNote,
    createPrayer,
    deletePrayer,
    selectedPrayerListId,
    selectPrayerList,
    prayerLists,
    prayers,
    reorderPrayers,
    updatePrayer,
    loadPrayerLists
  } = usePrayerStore();
  const [showTitleDialog, setShowTitleDialog] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);

  // "No lists at all" and "a list exists but none is selected" need different
  // empty states - only the first one needs a way to create a list.
  const hasPrayerLists = prayerLists.length > 0;

  // Read the lists in.
  //
  // Nothing anywhere called `loadPrayerLists`, so `prayerLists` stayed at its
  // initial `[]` for the life of the window: the pane opened on "No prayer
  // lists yet" however many the user had saved, and only creating one - which
  // appends to the array directly - put anything in the selector.
  useEffect(() => {
    void loadPrayerLists();
  }, [loadPrayerLists]);

  // Auto-select first prayer list if none selected (KAN-26)
  useEffect(() => {
    if (!selectedPrayerListId && prayerLists.length > 0) {
      selectPrayerList(prayerLists[0].userCommentaryId!);
    }
  }, [selectedPrayerListId, prayerLists, selectPrayerList]);

  const handleCreatePrayer = () => {
    setShowTitleDialog(true);
  };

  const handleConfirmTitle = async (title: string) => {
    try {
      const prayer = await createPrayer({
        title,
        // Empty, not seeded prompt text: writing "Write your prayer here..."
        // into the note's content and persisting it would leave every new
        // prayer opening with real text the user had to select and delete.
        // It is a placeholder (PrayerEditor -> NoteEditor `placeholder`
        // prop), which is what it always read as.
        content: '',
        noteType: 'prayer',
        userCommentaryId: selectedPrayerListId || undefined,
        metadata: {
          color: 'none',
          sortOrder: -1 // Negative to ensure it's added at top
        }
      });
      setCurrentPrayerNote(prayer);
      setShowTitleDialog(false);
    } catch (error) {
      console.error('Failed to create prayer:', error);
    }
  };

  // Save current prayer before selecting a new one
  const handleSelectPrayer = async (prayer: SerializedNote) => {
    if (currentPrayerNote && currentPrayerNote.noteId !== prayer.noteId) {
      try {
        await updatePrayer(currentPrayerNote);
      } catch (error) {
        console.error('Failed to save prayer before switching:', error);
      }
    }
    setCurrentPrayerNote(prayer);
  };

  // KeyboardSensor is deliberate: the previous drag library gave this list
  // keyboard reordering for free. Space picks a row up, arrows move it, Space
  // drops it - PrayerListItem's own key handler only claims Enter for that reason.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  const handleDeletePrayer = async (prayerId: number) => {
    try {
      await deletePrayer(prayerId);
      // If the deleted prayer was selected, clear the selection
      if (currentPrayerNote?.noteId === prayerId) {
        setCurrentPrayerNote(null);
      }
    } catch (error) {
      console.error('Failed to delete prayer:', error);
    }
  };

  return (
    <>
      <div data-testid="prayer-pane" className="h-full flex">
        {/* Left panel: Prayer list selector + Prayer list */}
        <div className="w-80 flex flex-col bg-surface border-e border-border">
          {/* Prayer list selector header */}
          <div className="p-3 border-b border-border bg-surface-secondary">
            <div className="flex items-center gap-2">
              {/*
                With no lists at all, an empty <select> is worse than nothing -
                it invites the user to pick from a list that cannot have
                anything in it. Say so in words instead, and put the way out
                (the create button) in the panel below.
              */}
              {hasPrayerLists ? (
                <>
                  <label htmlFor="prayer-list-select" className="text-sm text-text-secondary whitespace-nowrap">
                    {t('prayerTab.prayerListLabel')}
                  </label>
                  <select
                    id="prayer-list-select"
                    value={selectedPrayerListId ?? ''}
                    onChange={(e) => { if (e.target.value) selectPrayerList(Number(e.target.value)); }}
                    className="flex-1 px-2 py-1.5 text-sm border border-border rounded bg-surface min-w-0"
                  >
                    {prayerLists.map((list) => (
                      <option key={list.userCommentaryId} value={list.userCommentaryId}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <span className="flex-1 min-w-0 text-sm text-text-secondary">
                  {t('prayerTab.noListsYet')}
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowConfigDialog(true)}
                className="text-text-secondary hover:text-text-primary p-1 rounded hover:bg-background-active transition-colors"
                title={t('prayerTab.configureTitle')}
                aria-label={t('prayerTab.configureTitle')}
                aria-haspopup="dialog"
                aria-expanded={showConfigDialog}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* New Prayer button at top */}
          {selectedPrayerListId && (
            <div className="p-3 border-b border-border">
              <button
                type="button"
                onClick={handleCreatePrayer}
                aria-haspopup="dialog"
                aria-expanded={showTitleDialog}
                className="w-full px-3 py-2 bg-accent text-text-on-accent rounded hover:bg-accent-hover text-sm font-medium transition-colors"
              >
                {t('prayerTab.newPrayerButton')}
              </button>
            </div>
          )}

          {/* Prayer list */}
          <div className="flex-1 overflow-y-auto">
            {!hasPrayerLists ? (
              /*
                "No lists exist at all" is a different state from "lists exist
                but none is selected", and it is the one a brand-new user hits.
                Sending them to a dropdown that cannot contain anything, with
                "+ New Prayer" hidden behind a selected list, would leave the
                gear icon as the only route to a first list.
              */
              <div className="p-6 text-sm text-text-secondary text-center">
                <p className="mb-3">
                  {t('prayerTab.noListsDescription')}
                </p>
                <button
                  type="button"
                  data-testid="prayer-create-first-list"
                  onClick={() => setShowConfigDialog(true)}
                  aria-haspopup="dialog"
                  aria-expanded={showConfigDialog}
                  className="px-3 py-2 bg-accent text-text-on-accent rounded hover:bg-accent-hover text-sm font-medium transition-colors"
                >
                  {t('prayerListSelector.newListButton')}
                </button>
              </div>
            ) : !selectedPrayerListId ? (
              <div className="p-6 text-sm text-text-secondary text-center">
                {t('prayerTab.noListSelected')}
              </div>
            ) : prayers.length === 0 ? (
              <div className="p-6 text-sm text-text-secondary text-center">
                {t('prayerTab.emptyList')}
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={prayers.map(p => String(p.noteId))}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="p-2">
                      {prayers.map((prayer, index) => {
                        const isSelected = currentPrayerNote?.noteId === prayer.noteId;
                        const displayPrayer = isSelected && currentPrayerNote ? currentPrayerNote : prayer;
                        return (
                          <PrayerListItem
                            key={prayer.noteId}
                            prayer={displayPrayer}
                            index={index}
                            isSelected={isSelected}
                            onSelect={() => handleSelectPrayer(prayer)}
                            onDelete={() => handleDeletePrayer(prayer.noteId!)}
                          />
                        );
                      })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          {/* Drag hint */}
          {prayers.length > 1 && (
            <div className="p-2 border-t border-border bg-surface-secondary text-xs text-text-secondary text-center">
              {t('prayerTab.dragToReorder')}
            </div>
          )}
        </div>

        {/* Right panel: Prayer editor */}
        <div className="flex-1 min-w-0">
          <PrayerEditor prayer={currentPrayerNote} />
        </div>
      </div>

      {/* Prayer title dialog */}
      <TextInputDialog
        isOpen={showTitleDialog}
        title={t('prayerTab.newPrayerDialogTitle')}
        label={t('prayerTab.prayerTitleLabel')}
        placeholder={t('prayerTab.prayerTitlePlaceholder')}
        initialValue=""
        onConfirm={handleConfirmTitle}
        onCancel={() => setShowTitleDialog(false)}
      />

      {/* Prayer list configuration dialog */}
      {showConfigDialog && (
        <PrayerListConfigDialog onClose={() => setShowConfigDialog(false)} />
      )}
    </>
  );
};

export default PrayerTab;
