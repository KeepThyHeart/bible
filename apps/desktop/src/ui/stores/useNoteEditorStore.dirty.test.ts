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

describe('normalizeContent (B-085)', () => {
  it('adopts the editor-normalised text as the baseline for an untouched note', () => {
    useNoteEditorStore.getState().resetContent('<p>a</p><ul><li>x</li></ul>');
    useNoteEditorStore.getState().normalizeContent('<p>a</p><ul><li><p>x</p></li></ul><p></p>');
    expect(useNoteEditorStore.getState().isDirty).toBe(false);
    // the same text coming back through setContent is still not an edit
    useNoteEditorStore.getState().setContent('<p>a</p><ul><li><p>x</p></li></ul><p></p>');
    expect(useNoteEditorStore.getState().isDirty).toBe(false);
  });

  it('keeps unsaved edits dirty', () => {
    useNoteEditorStore.getState().resetContent('<p>a</p>');
    useNoteEditorStore.getState().setContent('<p>ab</p>');
    useNoteEditorStore.getState().normalizeContent('<p>ab</p><p></p>');
    expect(useNoteEditorStore.getState().isDirty).toBe(true);
  });
});
