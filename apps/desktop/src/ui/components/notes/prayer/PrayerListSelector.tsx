import React, { useState } from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { usePrayerStore } from '../../../stores/usePrayerStore';

const PrayerListSelector: React.FC = () => {
  const { t } = useI18n();
  const { prayerLists, selectedPrayerListId, selectPrayerList, createPrayerList, deletePrayerList } = usePrayerStore();
  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState('');

  const handleCreateList = async () => {
    if (!newListName.trim()) return;

    try {
      await createPrayerList({
        name: newListName,
        isDefault: false,
        metadata: { type: 'prayer_list' }
      });
      setNewListName('');
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create prayer list:', error);
      // One ICU message taking {message} - concatenating a translated prefix
      // with a raw exception left the sentence half-English and gave the
      // translator no control over where the detail lands.
      alert(t('prayerListSelector.createFailed', { message: (error as Error).message }));
    }
  };

  const handleDeleteList = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t('prayerListSelector.deleteConfirm'))) return;

    try {
      await deletePrayerList(id);
    } catch (error) {
      console.error('Failed to delete prayer list:', error);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background-warm border-e border-border">
      {/* Header */}
      <div className="p-md border-b border-border">
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          aria-expanded={isCreating}
          className="w-full px-md py-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover text-sm font-medium"
        >
          {t('prayerListSelector.newListButton')}
        </button>
      </div>

      {/* New list input */}
      {isCreating && (
        <div className="p-md border-b border-border bg-accent-light">
          <label htmlFor="prayer-list-name" className="sr-only">
            {t('prayerListSelector.namePlaceholder')}
          </label>
          <input
            id="prayer-list-name"
            type="text"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateList();
              if (e.key === 'Escape') {
                setIsCreating(false);
                setNewListName('');
              }
            }}
            placeholder={t('prayerListSelector.namePlaceholder')}
            className="w-full px-sm py-xs border border-border rounded text-sm"
            autoFocus
          />
          <div className="flex gap-xs mt-xs">
            <button
              type="button"
              onClick={handleCreateList}
              className="px-sm py-xs bg-accent text-text-on-accent rounded text-xs hover:bg-accent-hover"
            >
              {t('prayerListSelector.createButton')}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setNewListName('');
              }}
              className="px-sm py-xs bg-control rounded text-xs hover:bg-control-hover"
            >
              {t('prayerListSelector.cancelButton')}
            </button>
          </div>
        </div>
      )}

      {/* Prayer lists */}
      <div className="flex-1 overflow-y-auto p-sm">
        {/* Prayer lists */}
        {prayerLists.length === 0 ? (
          <div className="text-sm text-text-secondary italic p-md text-center">
            {t('prayerListSelector.noLists')}
          </div>
        ) : (
          prayerLists.map((list) => (
            <div
              key={list.userCommentaryId}
              className={`p-sm mb-xs rounded cursor-pointer flex justify-between items-start group ${
                selectedPrayerListId === list.userCommentaryId
                  ? 'bg-accent-soft border border-accent-soft text-accent-strong'
                  : 'bg-surface hover:bg-background-hover border border-border'
              }`}
            >
              {/* A real button, not a click handler on the row: the delete
                  control below cannot legally nest inside another button. */}
              <button
                type="button"
                onClick={() => selectPrayerList(list.userCommentaryId!)}
                aria-current={selectedPrayerListId === list.userCommentaryId ? 'true' : undefined}
                className="flex-1 text-start"
              >
                <div className="text-sm font-semibold flex items-center gap-xs">
                  {list.color && (
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: list.color }}
                      aria-hidden="true"
                    />
                  )}
                  {list.name}
                </div>
                {list.description && (
                  <div className="text-xs text-text-secondary mt-xs">{list.description}</div>
                )}
                {list.prayerCount !== undefined && (
                  <div className="text-xs text-text-secondary mt-xs">
                    {t('prayerListSelector.prayerCount', { count: list.prayerCount })}
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={(e) => handleDeleteList(list.userCommentaryId!, e)}
                className="opacity-0 group-hover:opacity-100 text-danger hover:text-danger-text px-xs"
                title={t('prayerListSelector.deleteListTitle')}
                aria-label={t('prayerListSelector.deleteListTitle')}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PrayerListSelector;
