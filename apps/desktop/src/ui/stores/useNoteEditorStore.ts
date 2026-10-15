import { create } from 'zustand';
import { whenContextService } from '../services/WhenContextService';

interface NoteEditorState {
  content: string;
  isDirty: boolean;
  /** Content as loaded or last saved; an edit that equals it is not an edit. */
  baseline?: string;
  lastSaved?: string;
  _autoSaveTimer?: ReturnType<typeof setInterval>;
  /**
   * Called with the unsaved content just before `resetContent` replaces it
   * (another note is being opened or created), so the pane can save the note
   * being left instead of silently dropping its edits.
   */
  _beforeReplace?: (unsavedContent: string) => void;

  /** Register (or clear) the before-replace saver. */
  setBeforeReplace: (fn: ((unsavedContent: string) => void) | undefined) => void;

  /** Set editor content and mark as dirty */
  setContent: (content: string) => void;
  /** Set editor content without marking as dirty (used when loading a note) */
  resetContent: (content: string) => void;
  /** Mark the editor as saved (clears dirty flag, updates lastSaved timestamp) */
  markSaved: (savedContent?: string) => void;
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

  // An update that leaves the text equal to what was loaded or saved (the
  // editor re-emitting its own document on open) is not an edit: counting it
  // made merely opening a note rewrite its file.
  setContent: (content) => set(state => ({ content, isDirty: content !== state.baseline })),

  // Loading another note: the previous note's save time must not carry over.
  resetContent: (content) => {
    const { isDirty, content: old, _beforeReplace } = get();
    if (isDirty && _beforeReplace && old !== content) {
      try {
        _beforeReplace(old);
      } catch (error) {
        console.error('Saving the previous note failed:', error);
      }
    }
    set({ content, baseline: content, isDirty: false, lastSaved: undefined });
  },

  setBeforeReplace: (fn) => set({ _beforeReplace: fn }),

  // `savedContent`: what was actually written. Text typed while the save was in
  // flight stays dirty instead of being marked saved without ever being written.
  markSaved: (savedContent) => set(state => {
    const saved = savedContent ?? state.content;
    return { isDirty: state.content !== saved, baseline: saved, lastSaved: new Date().toISOString() };
  }),

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
