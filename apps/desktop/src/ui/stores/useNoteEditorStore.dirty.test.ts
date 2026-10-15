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

describe('markSaved with the saved content', () => {
  it('keeps text typed during an in-flight save dirty', () => {
    useNoteEditorStore.getState().resetContent('<p>a</p>');
    useNoteEditorStore.getState().setContent('<p>ab</p>');
    useNoteEditorStore.getState().setContent('<p>abc</p>'); // typed while the save of "ab" is in flight
    useNoteEditorStore.getState().markSaved('<p>ab</p>');
    expect(useNoteEditorStore.getState().isDirty).toBe(true);
    useNoteEditorStore.getState().markSaved('<p>abc</p>');
    expect(useNoteEditorStore.getState().isDirty).toBe(false);
  });
});
