import React, { useState } from 'react';
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePrayerStore } from '../../../stores/usePrayerStore';
import { useI18n } from '../../../contexts/useI18n';
import { useFocusTrap } from '../../../hooks/useFocusTrap';

interface PrayerListConfigDialogProps {
  onClose: () => void;
}

/**
 * One reorderable prayer-list row.
 *
 * This row has a dedicated drag handle rather than being draggable as a whole,
 * because it contains a text input and action buttons that must stay clickable.
 * `useSortable` therefore splits: `setNodeRef`/`style` go on the row, while
 * `attributes`/`listeners` are handed to the handle through the render prop.
 */
const SortablePrayerListRow: React.FC<{
  id: string;
  children: (handleProps: Record<string, unknown>) => React.ReactNode;
}> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-3 bg-surface border border-border rounded ${
        isDragging ? 'shadow-lg' : ''
      }`}
    >
      {children({ ...attributes, ...listeners })}
    </div>
  );
};

const PrayerListConfigDialog: React.FC<PrayerListConfigDialogProps> = ({ onClose }) => {
  const { t } = useI18n();
  const {
    prayerLists,
    createPrayerList,
    deletePrayerList,
    updatePrayerList,
    reorderPrayerLists
  } = usePrayerStore();

  const [newListName, setNewListName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  // The dialog is only ever rendered while open, so the trap is always active.
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const handleCreateList = async () => {
    if (!newListName.trim()) return;

    try {
      await createPrayerList({
        name: newListName.trim(),
        isDefault: false,
        metadata: { type: 'prayer_list' }
      });
      setNewListName('');
    } catch (error) {
      console.error('Failed to create prayer list:', error);
      alert(t('prayerListConfigDialog.createFailed'));
    }
  };

  const handleDeleteList = async (id: number) => {
    if (!confirm(t('prayerListConfigDialog.deleteConfirm'))) {
      return;
    }

    try {
      await deletePrayerList(id);
    } catch (error) {
      console.error('Failed to delete prayer list:', error);
      alert(t('prayerListConfigDialog.deleteFailed'));
    }
  };

  const handleStartEdit = (id: number, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editingName.trim()) return;

    const list = prayerLists.find(l => l.userCommentaryId === editingId);
    if (!list) return;

    try {
      await updatePrayerList({ ...list, name: editingName.trim() });
      setEditingId(null);
      setEditingName('');
    } catch (error) {
      console.error('Failed to update prayer list:', error);
      alert(t('prayerListConfigDialog.updateFailed'));
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  // KeyboardSensor is deliberate: the previous drag library supported keyboard
  // reordering, and the handle below is focusable so it stays reachable.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = prayerLists.findIndex(l => String(l.userCommentaryId) === String(active.id));
    const newIndex = prayerLists.findIndex(l => String(l.userCommentaryId) === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const items = Array.from(prayerLists);
    const [reorderedItem] = items.splice(oldIndex, 1);
    items.splice(newIndex, 0, reorderedItem);

    const listIds = items.map(l => l.userCommentaryId!);
    try {
      await reorderPrayerLists(listIds);
    } catch (error) {
      console.error('Failed to reorder prayer lists:', error);
    }
  };

  // Handle Esc key to close dialog (KAN-26)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-background-overlay flex items-center justify-center z-50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prayer-list-config-dialog-title"
        className="bg-surface rounded-lg shadow-xl w-[500px] max-h-[80vh] flex flex-col"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 id="prayer-list-config-dialog-title" className="text-lg font-semibold">{t('prayerListConfigDialog.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary text-xl"
            aria-label={t('prayerListConfigDialog.closeTitle')}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Create new list */}
          <div className="mb-6">
            <label htmlFor="prayer-list-config-new-name" className="text-sm font-medium text-text-primary block mb-2">
              {t('prayerListConfigDialog.createLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="prayer-list-config-new-name"
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateList();
                }}
                placeholder={t('prayerListConfigDialog.namePlaceholder')}
                className="flex-1 px-3 py-2 border border-border rounded text-sm"
              />
              <button
                type="button"
                onClick={handleCreateList}
                disabled={!newListName.trim()}
                className="px-4 py-2 bg-accent text-text-on-accent rounded hover:bg-accent-hover text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('prayerListConfigDialog.createButton')}
              </button>
            </div>
          </div>

          {/* Existing lists */}
          <div>
            <div id="prayer-list-config-lists-label" className="text-sm font-medium text-text-primary block mb-2">
              {t('prayerListConfigDialog.listsLabel')}
            </div>
            {prayerLists.length === 0 ? (
              <div className="text-sm text-text-secondary text-center py-8">
                {t('prayerListConfigDialog.noLists')}
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={prayerLists.map(l => String(l.userCommentaryId))}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                      {prayerLists.map((list) => (
                        <SortablePrayerListRow
                          key={list.userCommentaryId}
                          id={String(list.userCommentaryId)}
                        >
                          {(handleProps) => (
                            <>
                              {/* Drag handle */}
                              <div
                                {...handleProps}
                                tabIndex={0}
                                role="button"
                                className="text-text-muted cursor-grab active:cursor-grabbing"
                                aria-label={t(
                                  'prayerListConfigDialog.dragHandleLabel',
                                  { name: list.name },
                                )}
                              >
                                <span aria-hidden="true">⋮⋮</span>
                              </div>

                              {/* List name (editable) */}
                              <div className="flex-1">
                                {editingId === list.userCommentaryId ? (
                                  <input
                                    type="text"
                                    value={editingName}
                                    aria-label={t('prayerListConfigDialog.editNameLabel')}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveEdit();
                                      if (e.key === 'Escape') handleCancelEdit();
                                    }}
                                    onBlur={handleSaveEdit}
                                    className="w-full px-2 py-1 border border-accent-soft rounded text-sm"
                                    autoFocus
                                  />
                                ) : (
                                  <span className="text-sm font-medium">{list.name}</span>
                                )}
                              </div>

                              {/* Prayer count */}
                              {list.prayerCount !== undefined && (
                                <span className="text-xs text-text-secondary">
                                  {list.prayerCount === 1
                                    ? t('prayerListConfigDialog.prayerCountOne')
                                    : t(
                                      'prayerListConfigDialog.prayerCountOther',
                                      { count: list.prayerCount, },
                                    )}
                                </span>
                              )}

                              {/* Actions */}
                              {editingId !== list.userCommentaryId && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEdit(list.userCommentaryId!, list.name)}
                                    className="p-1 text-text-muted hover:text-accent-strong"
                                    title={t('prayerListConfigDialog.renameTitle')}
                                    aria-label={t('prayerListConfigDialog.renameTitle')}
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteList(list.userCommentaryId!)}
                                    className="p-1 text-text-muted hover:text-danger"
                                    title={t('prayerListConfigDialog.deleteTitle')}
                                    aria-label={t('prayerListConfigDialog.deleteTitle')}
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </SortablePrayerListRow>
                      ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            {prayerLists.length > 1 && (
              <div className="mt-2 text-xs text-text-secondary text-center">
                {t('prayerListConfigDialog.dragToReorder')}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-control text-text-primary rounded hover:bg-control-hover text-sm font-medium"
          >
            {t('prayerListConfigDialog.doneButton')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrayerListConfigDialog;
