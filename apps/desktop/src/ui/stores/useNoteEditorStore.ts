import { create } from 'zustand';
import { whenContextService } from '../services/WhenContextService';

interface NoteEditorState {
  content: string;
  isDirty: boolean;
  lastSaved?: string;
  _autoSaveTimer?: ReturnType<typeof setInterval>;

  /** Set editor content and mark as dirty */
  setContent: (content: string) => void;
  /** Set editor content without marking as dirty (used when loading a note) */
  resetContent: (content: string) => void;
  /** Mark the editor as saved (clears dirty flag, updates lastSaved timestamp) */
  markSaved: () => void;
  /** Start auto-save timer that calls saveFn when content is dirty */
  startAutoSave: (saveFn: () => Promise<void>) => void;
  /** Stop the auto-save timer */
  stopAutoSave: () => void;
}

export const useNoteEditorStore = create<NoteEditorState>((set, get) => ({
  content: '',
  isDirty: false,
  lastSaved: undefined,
  _autoSaveTimer: undefined,

  setContent: (content) => set({ content, isDirty: true }),

  resetContent: (content) => set({ content, isDirty: false }),

  markSaved: () => set({ isDirty: false, lastSaved: new Date().toISOString() }),

  startAutoSave: (saveFn) => {
    get().stopAutoSave();
    const timer = setInterval(async () => {
      if (get().isDirty) {
        try {
          await saveFn();
        } catch (error) {
          console.error('Auto-save failed:', error);
        }
      }
    }, 10000);
    set({ _autoSaveTimer: timer });
  },

  stopAutoSave: () => {
    const { _autoSaveTimer } = get();
    if (_autoSaveTimer) {
      clearInterval(_autoSaveTimer);
      set({ _autoSaveTimer: undefined });
    }
  }
}));

// Publish editor.dirty into WhenContextService whenever isDirty changes.
function publishNoteEditorWhenContext(state: { isDirty: boolean }): void {
  whenContextService.set('editor.dirty', state.isDirty === true);
}

publishNoteEditorWhenContext(useNoteEditorStore.getState());
useNoteEditorStore.subscribe(publishNoteEditorWhenContext);
