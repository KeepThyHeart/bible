import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { SerializedNote } from '../../../services/notesAPI';
import { usePrayerStore } from '../../../stores/usePrayerStore';
import NoteEditor from '../editor/NoteEditor';
import ColorSelector, { PrayerColor } from './ColorSelector';

interface PrayerEditorProps {
  prayer: SerializedNote | null;
}

const PrayerEditor: React.FC<PrayerEditorProps> = ({ prayer }) => {
  const { t } = useI18n();
  const { updatePrayer, updateCurrentPrayerNoteFields } = usePrayerStore();
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<PrayerColor>('none');
  // Use local state for content to avoid interference from other tabs/notes
  // This prevents issues like verse note content appearing in prayer editor when
  // clicking note indicators while on Prayer tab (KAN-8)
  const [localContent, setLocalContent] = useState('');

  const currentPrayerId = useRef<number | undefined>(undefined);
  const previousPrayer = useRef<SerializedNote | null>(null);

  // Use refs to track current state values for auto-save (avoid stale closures)
  const titleRef = useRef(title);
  const colorRef = useRef(color);

  // Keep refs in sync with state
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  // Keep a ref to the current prayer for cleanup
  const prayerRef = useRef<SerializedNote | null>(prayer);
  useEffect(() => {
    prayerRef.current = prayer;
  }, [prayer]);

  // Keep a ref to the current editor content for cleanup
  const editorContentRef = useRef(localContent);
  useEffect(() => {
    editorContentRef.current = localContent;
  }, [localContent]);

  // Sync content changes to the store so PrayerList can access it when switching prayers
  // This is debounced to avoid excessive store updates while typing
  useEffect(() => {
    // Skip initial render and when loading a new prayer
    if (!prayer || prayer.noteId !== currentPrayerId.current) return;

    // Sync to store with debounce
    const syncTimeout = setTimeout(() => {
      updateCurrentPrayerNoteFields({ content: localContent });
    }, 100);

    return () => clearTimeout(syncTimeout);
  }, [localContent, prayer, updateCurrentPrayerNoteFields]);

  // Track prayer changes for loading new data
  // NOTE: Save-on-navigate is handled by PrayerList.handleSelectPrayer which saves
  // the current prayer BEFORE calling setCurrentNote. This prevents race conditions
  // and ensures the store has the correct data. We only handle unmount here.
  useEffect(() => {
    previousPrayer.current = prayer;

    // Cleanup: save when component unmounts (tab change)
    return () => {
      // Capture at cleanup time since this runs on unmount
      const cleanupPrayer = prayerRef.current;
      const cleanupTitle = titleRef.current;
      const cleanupColor = colorRef.current;
      const cleanupContent = editorContentRef.current;

      if (cleanupPrayer) {
        const saveData = async () => {
          try {
            const updated: SerializedNote = {
              ...cleanupPrayer,
              title: cleanupTitle,
              content: cleanupContent,
              metadata: {
                ...cleanupPrayer.metadata,
                color: cleanupColor
              }
            };
            await updatePrayer(updated);
          } catch (error) {
            console.error('Failed to auto-save prayer on unmount:', error);
          }
        };
        saveData();
      }
      // Reset the current prayer ID so that when we remount, we reload the prayer data
      currentPrayerId.current = undefined;
    };
  }, [prayer?.noteId, updatePrayer]);

  // Update local state when prayer changes
  // This effect handles both initial mount and prayer changes
  useEffect(() => {
    if (prayer && prayer.noteId !== currentPrayerId.current) {
      setTitle(prayer.title || '');
      setColor((prayer.metadata?.color as PrayerColor) || 'none');
      setLocalContent(prayer.content || '');
      currentPrayerId.current = prayer.noteId;
    } else if (prayer && prayer.noteId === currentPrayerId.current) {
      // Re-sync title when the store updates the same prayer (e.g. after switching
      // away and back to the Prayer tab).
      setTitle(prayer.title || '');
    }
  }, [prayer?.noteId, prayer?.title]);

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    // Sync to store immediately so it's available when switching prayers
    updateCurrentPrayerNoteFields({ title: newTitle });
  };

  const handleTitleBlur = async () => {
    if (!prayer) return;

    try {
      const updated: SerializedNote = {
        ...prayer,
        title,
        content: localContent,
        metadata: {
          ...prayer.metadata,
          color
        }
      };

      await updatePrayer(updated);
    } catch (error) {
      console.error('Failed to save prayer title:', error);
    }
  };

  const handleColorChange = async (newColor: PrayerColor) => {
    setColor(newColor);

    // Sync to store immediately so it's available when switching prayers
    updateCurrentPrayerNoteFields({
      metadata: {
        ...prayer?.metadata,
        color: newColor
      }
    });

    // Auto-save color change to database
    if (prayer) {
      try {
        const updated: SerializedNote = {
          ...prayer,
          title,
          content: localContent,
          metadata: {
            ...prayer.metadata,
            color: newColor
          }
        };
        await updatePrayer(updated);
      } catch (error) {
        console.error('Failed to auto-save color:', error);
      }
    }
  };

  if (!prayer) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary bg-surface">
        {t('prayerEditor.noPrayerSelected')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header with title */}
      <div className="border-b border-border px-lg py-sm bg-background-warm">
        <div className="mb-sm">
          <label htmlFor="prayer-title" className="sr-only">
            {t('prayerEditor.titlePlaceholder')}
          </label>
          {/*
            The title was an unstyled, borderless input, so it read as a static
            heading - its own placeholder never shows for a prayer created
            through the title dialog, and nothing else said it could be typed
            in. The border/background appear on hover and focus (rather than
            always) so the header still reads as a heading at rest, and the
            pencil is the standing "this is editable" cue.
          */}
          <div className="group flex items-center gap-xs -mx-sm px-sm rounded border border-transparent transition-colors hover:border-border hover:bg-background-hover focus-within:border-accent focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent/30">
            <input
              id="prayer-title"
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              onBlur={handleTitleBlur}
              aria-describedby="prayer-autosave-hint"
              className="flex-1 min-w-0 py-xs text-lg font-semibold bg-transparent outline-none"
              placeholder={t('prayerEditor.titlePlaceholder')}
              title={t('prayerEditor.titleEditHint')}
            />
            <svg
              className="w-4 h-4 shrink-0 text-text-muted transition-colors group-hover:text-text-secondary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div id="prayer-autosave-hint" className="text-xs text-text-secondary mt-xs">
            {t('prayerEditor.autoSaveHint')}
          </div>
        </div>

        {/* Color selector */}
        <div>
          {/* Not a <label>: ColorSelector is a set of buttons, not one control. */}
          <div className="text-xs text-text-secondary mb-xs block">{t('prayerEditor.colorLabel')}</div>
          <ColorSelector selectedColor={color} onChange={handleColorChange} />
        </div>
      </div>

      {/* Rich text editor */}
      <div className="flex-1 overflow-hidden">
        {/*
          A hint, not content. New prayers are created with an empty body now
          (PrayerTab.handleConfirmTitle); this is what the user sees instead,
          and it disappears the moment they type. Prayers created before that
          change still hold the literal text in their saved content - rewriting
          them would be editing the user's own words, so they are left alone.
        */}
        <NoteEditor
          value={localContent}
          onChange={setLocalContent}
          placeholder={t('prayerEditor.contentPlaceholder')}
        />
      </div>
    </div>
  );
};

export default PrayerEditor;
