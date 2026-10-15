import { describe, it, expect, beforeEach } from 'vitest';
import { useNoteEditorStore } from './useNoteEditorStore';

describe('useNoteEditorStore dirty tracking (soak 0161: opening a note must not rewrite it)', () => {
  beforeEach(() => useNoteEditorStore.getState().resetContent(''));

  it('an editor update equal to the loaded content is not an edit', () => {
    useNoteEditorStore.getState().resetContent('<p>hello</p>');
    useNoteEditorStore.getState().setContent('<p>hello</p>');
    expect(useNoteEditorStore.getState().isDirty).toBe(false);
  });

  it('a real edit is dirty, and stays clean again after markSaved', () => {
    useNoteEditorStore.getState().resetContent('<p>hello</p>');
    useNoteEditorStore.getState().setContent('<p>hello!</p>');
    expect(useNoteEditorStore.getState().isDirty).toBe(true);
    useNoteEditorStore.getState().markSaved();
    useNoteEditorStore.getState().setContent('<p>hello!</p>');
    expect(useNoteEditorStore.getState().isDirty).toBe(false);
    useNoteEditorStore.getState().setContent('<p>hello!!</p>');
    expect(useNoteEditorStore.getState().isDirty).toBe(true);
  });
});
