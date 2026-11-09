import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { indentSelection, outdentSelection, canOutdent, SOFT_TAB } from './indentCommands';
import { findNoteMatches } from './noteFindRanges';
import { NoteFind, getNoteFindMatches } from './NoteFindExtension';

const editors: Editor[] = [];
const make = (content: string) => {
  const e = new Editor({ extensions: [StarterKit, NoteFind], content });
  editors.push(e);
  return e;
};
afterEach(() => editors.splice(0).forEach(e => e.destroy()));

describe('indent / outdent', () => {
  it('prefixes a paragraph with a soft tab and removes it again', () => {
    const e = make('<p>hello</p>');
    e.commands.setTextSelection(3);
    expect(canOutdent(e)).toBe(false);
    indentSelection(e);
    expect(e.state.doc.textContent).toBe(`${SOFT_TAB}hello`);
    expect(canOutdent(e)).toBe(true);
    outdentSelection(e);
    expect(e.state.doc.textContent).toBe('hello');
  });

  it('indents every selected paragraph', () => {
    const e = make('<p>a</p><p>b</p>');
    e.commands.selectAll();
    indentSelection(e);
    expect(e.state.doc.textContent).toBe(`${SOFT_TAB}a${SOFT_TAB}b`);
  });

  it('nests and lifts list items', () => {
    const e = make('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    e.commands.setTextSelection(e.state.doc.content.size - 3);
    indentSelection(e);
    expect(e.getHTML()).toMatch(/<ul><li><p>one<\/p><ul><li><p>two/);
    expect(canOutdent(e)).toBe(true);
    outdentSelection(e);
    expect(e.getHTML()).toContain("<li><p>one</p></li><li><p>two</p></li></ul>");
  });
});

describe('find in note', () => {
  it('finds case-insensitively by default and respects match case', () => {
    const e = make('<p>Grace and grace</p><p>GRACE</p>');
    expect(findNoteMatches(e.state.doc, 'grace', false)).toHaveLength(3);
    expect(findNoteMatches(e.state.doc, 'grace', true)).toHaveLength(1);
    expect(findNoteMatches(e.state.doc, '', false)).toEqual([]);
  });

  it('decorates matches via the plugin without touching the saved HTML', () => {
    const e = make('<p>one two one</p>');
    e.commands.setNoteFind({ query: 'one', current: 1 });
    expect(getNoteFindMatches(e.state)).toHaveLength(2);
    expect(e.getHTML()).toBe('<p>one two one</p>');
  });
});
