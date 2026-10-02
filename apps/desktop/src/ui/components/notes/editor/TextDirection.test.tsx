/**
 * Block direction in the notes editor (task 0076): the TextDirection extension
 * round trip, the commands over a multi-block selection, the note root's
 * default direction, and NoteViewer rendering the same `dir` attributes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextDirection, currentBlockDirection } from './TextDirectionExtension';
import NoteViewer from './NoteViewer';

vi.mock('../../../stores/crossStoreBridge', () => ({ previewVerseInPrimary: vi.fn() }));
vi.mock('../../VersePreviewTooltip', () => ({ default: () => null }));
vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));
vi.mock('../../../utils/commentaryLinkProcessor', () => ({
  reprocessCommentaryLinks: (html: string) => html,
}));

const mockDir = vi.hoisted(() => ({ value: 'ltr' as 'ltr' | 'rtl' }));
vi.mock('../../../contexts/useDirection', () => ({
  useDirection: () => mockDir.value,
  useIsRtl: () => mockDir.value === 'rtl',
}));

const editors: Editor[] = [];
function makeEditor(content: string): Editor {
  const editor = new Editor({ extensions: [StarterKit, TextDirection], content });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  mockDir.value = 'ltr';
});

describe('TextDirection extension', () => {
  it('serializes no dir attribute for blocks without an explicit direction', () => {
    const html = makeEditor('<p>one</p><h2>two</h2><blockquote><p>q</p></blockquote><ul><li><p>x</p></li></ul>').getHTML();
    expect(html).toContain('<p>one</p>');
    expect(html).not.toContain('dir=');
    expect(html).toContain('<h2>two</h2>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
  });

  it('preserves an explicit ltr/rtl through an HTML round trip', () => {
    const first = makeEditor('<p dir="rtl">a</p><p dir="ltr">b</p><p dir="auto">c</p><p dir="bogus">d</p>').getHTML();
    expect(first).toContain('<p dir="rtl">a</p>');
    expect(first).toContain('<p dir="ltr">b</p>');
    expect(first).toContain('<p>c</p>');
    expect(first).toContain('<p>d</p>');
    expect(first).not.toContain('dir="auto"');
    const second = makeEditor(first).getHTML();
    expect(second).toBe(first);
  });

  it('sets and unsets direction on every block in the selection', () => {
    const editor = makeEditor('<p>one</p><p>two</p><p>three</p>');
    editor.commands.selectAll();
    editor.commands.setBlockDirection('rtl');
    expect(editor.getHTML()).toBe('<p dir="rtl">one</p><p dir="rtl">two</p><p dir="rtl">three</p>');

    editor.commands.unsetBlockDirection();
    expect(editor.getHTML()).toBe('<p>one</p><p>two</p><p>three</p>');
  });

  it('only touches the blocks the selection spans', () => {
    const editor = makeEditor('<p>one</p><p>two</p><p>three</p>');
    editor.commands.setTextSelection(2); // inside "one"
    editor.commands.setBlockDirection('ltr');
    expect(editor.getHTML()).toBe('<p dir="ltr">one</p><p>two</p><p>three</p>');
  });

  it('reports the current block direction', () => {
    const editor = makeEditor('<p dir="rtl">one</p><p>two</p>');
    editor.commands.setTextSelection(2);
    expect(currentBlockDirection(editor)).toBe('rtl');
    editor.commands.setTextSelection(7);
    expect(currentBlockDirection(editor)).toBeNull();
  });
});

describe('NoteViewer direction', () => {
  it('keeps the dir attribute of each stored block', () => {
    const { container } = render(<NoteViewer content='<p dir="rtl">a</p><p dir="auto">b</p>' />);
    expect(container.querySelector('p[dir="rtl"]')?.textContent).toBe('a');
    expect(container.querySelector('p[dir="auto"]')?.textContent).toBe('b');
  });

  it('defaults the root to the UI direction', () => {
    mockDir.value = 'rtl';
    const { container } = render(<NoteViewer content="<p>a</p>" />);
    expect((container.querySelector('.prose') as HTMLElement).getAttribute('dir')).toBe('rtl');
  });

  it("lets the note's own default override the UI direction", () => {
    mockDir.value = 'rtl';
    const { container } = render(<NoteViewer content="<p>a</p>" defaultDirection="ltr" />);
    expect((container.querySelector('.prose') as HTMLElement).getAttribute('dir')).toBe('ltr');
  });
});
