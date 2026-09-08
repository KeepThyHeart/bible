/**
 * Tab on the Bible reference at the caret.
 *
 * Two paths, because Tab asks by default and only expands silently once the
 * user has ticked "always use this format" in the picker:
 *
 * - **Default** - Tab claims the key and hands the host a request to open the
 *   format picker over the reference. It does not fetch and does not touch the
 *   document; the host does both, once a format is chosen.
 * - **`skipFormatMenu`** - Tab expands in the remembered format, which is the
 *   behaviour the rest of this file was written against.
 *
 * Split deliberately in two:
 *
 * - The keymap is driven against a real `Editor` with the real extension,
 *   because it needs precise caret control and jsdom will not let a DOM
 *   selection drive ProseMirror's caret (`selectionchange` does not sync -
 *   verified). `setTextSelection` is the only reliable way to say "the caret
 *   is right after this reference".
 * - The pieces that need no caret - the container handler's `defaultPrevented`
 *   guard, re-formatting an existing passage, and the `.bn` round-trip - go
 *   through the real `NoteEditor`, seeded with content that already contains
 *   what they act on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

let activeTabs: Array<{ abbreviation: string }> = [{ abbreviation: 'KJV' }];
vi.mock('../../../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'bible_default',
  useBibleStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ navigateToVerseInPrimary: vi.fn() }),
    {
      getState: () => ({
        panels: new Map([['bible_default', { openTabs: activeTabs, activeTabIndex: 0 }]]),
      }),
    },
  ),
}));

const getVerses = vi.fn();
vi.mock('../../../services/electronAPI', () => ({
  bibleAPI: {
    getVerses: (...args: unknown[]) => getVerses(...args),
    getVerse: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../VersePreviewTooltip', () => ({ default: () => null }));

import NoteEditor from './NoteEditor';
import VerseExpansionMark from './VerseExpansionMark';
import VerseExpandTabExtension, { type VerseExpandRequest } from './VerseExpandTabExtension';
import { verseReferencePlugin } from './VerseReferencePlugin';
import { __clearVerseFetchCache } from '../../../services/verseFetchCache';
import { expansionContentHash, type ExpandFailureReason } from '../../../services/verseExpansionService';
import { setSkipFormatMenu } from '../../../services/copyFormats';
import { enT } from '../../../testing/enCatalog';

const JOHN_3_16 = {
  verse_id: 43003016,
  book_number: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world',
  text_html: 'For God so loved the world',
};

interface Failure {
  reason: ExpandFailureReason;
  reference: string;
  verseCount?: number;
}

/** A real editor carrying the reference plugin and the Tab extension. */
function makeEditor(content: string, failures: Failure[], requests: VerseExpandRequest[] = []) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      VerseExpansionMark,
      VerseExpandTabExtension.configure({
        onExpandRequest: request => requests.push(request),
        onExpandFailed: (reason, reference, verseCount) =>
          failures.push({ reason, reference, verseCount }),
      }),
    ],
    content,
  });
  editor.registerPlugin(verseReferencePlugin);
  return { editor, host };
}

/** Press Tab with the caret placed just after `reference`. */
function tabAfterReference(editor: Editor, host: HTMLElement, reference: string) {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
  const offset = text.indexOf(reference);
  expect(offset).toBeGreaterThanOrEqual(0);
  // +1 for the opening paragraph token; the sample docs are a single block
  // unless a test says otherwise.
  editor.commands.setTextSelection(offset + reference.length + 1);
  const dom = host.querySelector('.ProseMirror') as HTMLElement;
  return fireEvent.keyDown(dom, { key: 'Tab', code: 'Tab' });
}

describe('Tab asks how to paste the passage', () => {
  beforeEach(() => {
    __clearVerseFetchCache();
    localStorage.clear();
    getVerses.mockReset();
    getVerses.mockResolvedValue([JOHN_3_16]);
    activeTabs = [{ abbreviation: 'KJV' }];
  });

  it('claims the key and asks the host to open the picker, touching nothing', async () => {
    const requests: VerseExpandRequest[] = [];
    const { editor, host } = makeEditor('<p>John 3:16</p>', [], requests);
    const before = editor.getHTML();

    expect(tabAfterReference(editor, host, 'John 3:16')).toBe(false);

    expect(requests).toHaveLength(1);
    expect(requests[0].range.text).toBe('John 3:16');
    expect(requests[0].expansionId).toBeTruthy();
    // Nothing is inserted and nothing is fetched until a format is chosen -
    // the picker's own preview does the fetching.
    expect(editor.getHTML()).toBe(before);
    expect(getVerses).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('asks for a replacement when the citation is alone on its line', () => {
    const requests: VerseExpandRequest[] = [];
    const { editor, host } = makeEditor('<p>John 3:16</p>', [], requests);
    tabAfterReference(editor, host, 'John 3:16');
    expect(requests[0].placement).toBe('replace');
    editor.destroy();
  });

  it('asks for a paragraph below when the reference is inside a sentence', () => {
    const requests: VerseExpandRequest[] = [];
    const { editor, host } = makeEditor('<p>As Paul says in Romans 8:28, we know</p>', [], requests);
    tabAfterReference(editor, host, 'Romans 8:28');
    // Replacing over the reference would destroy the sentence around it.
    expect(requests[0].placement).toBe('after-block');
    expect(requests[0].blockEnd).toBeGreaterThan(0);
    editor.destroy();
  });

  it('asks nothing when there is no reference at the caret', () => {
    const requests: VerseExpandRequest[] = [];
    const { editor, host } = makeEditor('<p>just some prose</p>', [], requests);
    editor.commands.setTextSelection(5);
    const dom = host.querySelector('.ProseMirror') as HTMLElement;

    expect(fireEvent.keyDown(dom, { key: 'Tab', code: 'Tab' })).toBe(true);
    expect(requests).toEqual([]);
    editor.destroy();
  });
});

describe('Tab expands silently once "always use this format" is ticked', () => {
  beforeEach(() => {
    __clearVerseFetchCache();
    localStorage.clear();
    // The escape hatch for someone who has settled on one shape: Tab stops
    // asking and inserts in the remembered format.
    setSkipFormatMenu(true);
    getVerses.mockReset();
    getVerses.mockResolvedValue([JOHN_3_16]);
    activeTabs = [{ abbreviation: 'KJV' }];
  });

  it('replaces the reference when it is alone on its own line', async () => {
    const failures: Failure[] = [];
    const { editor, host } = makeEditor('<p>John 3:16</p>', failures);

    const notCanceled = tabAfterReference(editor, host, 'John 3:16');
    // preventDefault() was called: the key was claimed, so no soft tab and no
    // focus move.
    expect(notCanceled).toBe(false);

    await waitFor(() => expect(editor.getText()).toContain('For God so loved the world'));
    // The bare citation line is gone - replaced, not appended to. (Most
    // formats re-emit the reference as their own first line, so asserting the
    // string is absent would be wrong; what matters is that no paragraph is
    // still *just* the original citation.)
    const paragraphTexts: string[] = [];
    editor.state.doc.forEach(node => paragraphTexts.push(node.textContent));
    expect(paragraphTexts).not.toContain('John 3:16');
    expect(editor.getHTML()).toContain('data-expansion-id');
    expect(failures).toEqual([]);
    editor.destroy();
  });

  it('keeps the sentence and adds the passage below when the reference is inline', async () => {
    const failures: Failure[] = [];
    getVerses.mockResolvedValue([
      {
        verse_id: 45008028, book_number: 45, chapter: 8, verse: 28,
        // text_html must be set too: the format engine prefers it over text.
        text: 'All things work together', text_html: 'All things work together',
      },
    ]);
    const { editor, host } = makeEditor('<p>As Paul says in Romans 8:28, we know</p>', failures);

    tabAfterReference(editor, host, 'Romans 8:28');
    await waitFor(() => expect(editor.getText()).toContain('All things work together'));

    const html = editor.getHTML();
    // The sentence survives verbatim - replacing over it would have destroyed it.
    expect(html).toContain('As Paul says in Romans 8:28, we know');
    // And the passage is a separate paragraph after it.
    expect((html.match(/<p>/g) ?? []).length).toBeGreaterThan(1);
    expect(html.indexOf('All things work together')).toBeGreaterThan(html.indexOf('we know'));
    editor.destroy();
  });

  it('stamps the passage so it can be re-formatted later', async () => {
    const { editor, host } = makeEditor('<p>John 3:16</p>', []);
    tabAfterReference(editor, host, 'John 3:16');

    await waitFor(() => expect(editor.getHTML()).toContain('data-expansion-id'));
    expect(editor.getHTML()).toContain('data-expansion-ref="John 3:16"');
    expect(editor.getHTML()).toContain('data-expansion-format=');
    editor.destroy();
  });

  it('falls through when there is no reference at the caret', async () => {
    const { editor, host } = makeEditor('<p>just some prose</p>', []);
    editor.commands.setTextSelection(5);
    const dom = host.querySelector('.ProseMirror') as HTMLElement;

    // Nothing claimed the key at the keymap level, so the container handler's
    // soft tab (and, in a list, sinkListItem) still runs. This is the
    // regression contract for every pre-existing Tab behaviour.
    const notCanceled = fireEvent.keyDown(dom, { key: 'Tab', code: 'Tab' });
    expect(notCanceled).toBe(true);
    expect(getVerses).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('falls through when the caret is inside the reference rather than after it', async () => {
    const { editor, host } = makeEditor('<p>John 3:16</p>', []);
    editor.commands.setTextSelection(4);
    const dom = host.querySelector('.ProseMirror') as HTMLElement;

    expect(fireEvent.keyDown(dom, { key: 'Tab', code: 'Tab' })).toBe(true);
    editor.destroy();
  });

  it('refuses a passage over the cap and reports why', async () => {
    const failures: Failure[] = [];
    getVerses.mockResolvedValue(
      Array.from({ length: 176 }, (_, i) => ({ ...JOHN_3_16, verse_id: 19119001 + i, verse: i + 1 })),
    );
    const { editor, host } = makeEditor('<p>Psalms 119</p>', failures);
    const before = editor.getHTML();

    tabAfterReference(editor, host, 'Psalms 119');

    // Tab claims the key synchronously, so a silent refusal would read as a
    // dead keypress - the reason has to come back out.
    await waitFor(() => expect(failures).toHaveLength(1));
    expect(failures[0]).toMatchObject({ reason: 'too-large', reference: 'Psalms 119', verseCount: 176 });
    expect(editor.getHTML()).toBe(before);
    editor.destroy();
  });

  it('reports a reference that does not exist without touching the document', async () => {
    const failures: Failure[] = [];
    getVerses.mockResolvedValue([]);
    const { editor, host } = makeEditor('<p>Genesis 99:1</p>', failures);
    const before = editor.getHTML();

    tabAfterReference(editor, host, 'Genesis 99:1');

    await waitFor(() => expect(failures).toHaveLength(1));
    expect(failures[0].reason).toBe('not-found');
    expect(editor.getHTML()).toBe(before);
    editor.destroy();
  });

  it('is a single undo step', async () => {
    const { editor, host } = makeEditor('<p>John 3:16</p>', []);
    const before = editor.getHTML();

    tabAfterReference(editor, host, 'John 3:16');
    await waitFor(() => expect(editor.getText()).toContain('For God so loved the world'));

    editor.commands.undo();
    expect(editor.getHTML()).toBe(before);
    editor.destroy();
  });
});

// -- NoteEditor-level: no caret control needed ----------------------------

const EXPANDED_TEXT = 'John 3:16 (KJV) For God so loved the world';

function expandedHtml(text: string, hash?: string): string {
  const hashAttr = hash === undefined ? '' : ` data-expansion-hash="${hash}"`;
  return (
    '<p><span data-expansion-id="e1" data-expansion-ref="John 3:16" data-expansion-format="standard" ' +
    'data-expansion-options="{&quot;displayVersionNumber&quot;:true,&quot;wordsOfChristInRed&quot;:false}"' +
    `${hashAttr}>${text}</span></p>`
  );
}

/** No hash recorded - nothing to compare against, so treated as pristine. */
const EXPANDED_HTML = expandedHtml(EXPANDED_TEXT);
/** Carries the fingerprint it was inserted with. */
const EXPANDED_HTML_HASHED = expandedHtml(EXPANDED_TEXT, expansionContentHash(EXPANDED_TEXT));

async function renderNoteEditor(value: string) {
  const onChange = vi.fn();
  render(<NoteEditor value={value} onChange={onChange} />);
  await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull());
  return onChange;
}

function lastHtml(onChange: ReturnType<typeof vi.fn>): string {
  return (onChange.mock.calls.at(-1)?.[0] as string) ?? '';
}

describe('the container Tab handler defers once ProseMirror has handled the key', () => {
  beforeEach(() => {
    __clearVerseFetchCache();
    getVerses.mockReset();
    getVerses.mockResolvedValue([JOHN_3_16]);
    activeTabs = [{ abbreviation: 'KJV' }];
  });

  it('does not insert a soft tab when the keydown was already defaultPrevented', async () => {
    const onChange = await renderNoteEditor('<p>Hello world</p>');
    const editable = document.querySelector('.ProseMirror') as HTMLElement;
    const callsBefore = onChange.mock.calls.length;

    // Stand in for the expansion keymap: claim the key in the capture phase,
    // exactly as ProseMirror does before the React bubble-phase handler runs.
    const claim = (e: Event) => e.preventDefault();
    editable.addEventListener('keydown', claim, true);
    fireEvent.keyDown(editable, { key: 'Tab', code: 'Tab' });
    editable.removeEventListener('keydown', claim, true);

    // Without the `defaultPrevented` guard this appends four non-breaking
    // spaces after the expanded passage - into content saved to .bn files.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(lastHtml(onChange)).not.toContain('&nbsp;');
    expect(onChange.mock.calls.length).toBe(callsBefore);
  });

  it('still inserts a soft tab when nothing claimed the key', async () => {
    const onChange = await renderNoteEditor('<p>Hello world</p>');
    const editable = document.querySelector('.ProseMirror') as HTMLElement;
    editable.focus();

    fireEvent.keyDown(editable, { key: 'Tab', code: 'Tab' });
    await waitFor(() => expect(lastHtml(onChange)).toContain('&nbsp;'));
  });
});

describe('re-formatting a passage that is already in the note', () => {
  beforeEach(() => {
    __clearVerseFetchCache();
    localStorage.clear();
    getVerses.mockReset();
    getVerses.mockResolvedValue([JOHN_3_16]);
    activeTabs = [{ abbreviation: 'KJV' }];
  });

  it('round-trips an expansion through save and reload', async () => {
    await renderNoteEditor(EXPANDED_HTML);
    // The mark survives the HTML the .bn file stores, which is the whole
    // reason a format change is possible after reopening a note.
    const marked = document.querySelector('.verse-expansion') as HTMLElement;
    expect(marked).not.toBeNull();
    expect(marked.getAttribute('data-expansion-ref')).toBe('John 3:16');
    expect(marked.getAttribute('data-expansion-format')).toBe('standard');
  });

  it('offers "Change format" on right-click and applies a new format in place', async () => {
    const onChange = await renderNoteEditor(EXPANDED_HTML);

    fireEvent.contextMenu(document.querySelector('.verse-expansion') as HTMLElement);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Change format/ }));

    // Opens pre-loaded with the passage's verses and its current format.
    await screen.findByTestId('verse-expand-preview');
    fireEvent.click(screen.getByRole('radio', { name: /Inline quote/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(lastHtml(onChange)).toContain('data-expansion-format="inline-quote"'),
    );
    const out = lastHtml(onChange);
    expect(out).toContain('For God so loved the world');
    // Re-formatted in place: the passage keeps its identity so it can be
    // changed again, and it was not duplicated.
    expect(out).toContain('data-expansion-id="e1"');
    expect((out.match(/data-expansion-id="e1"/g) ?? []).length).toBe(1);
  });

  /**
   * Notes written before the format list was cut carry `standard` - the
   * fixture above is one. The list no longer offers it, but the passage still
   * has to open, still has to say what it currently is, and Apply has to leave
   * it alone unless the user actually picks something else. The alternative -
   * silently rewriting an old passage into a different shape the moment
   * someone opens the format menu - is data loss with extra steps.
   */
  it('shows a retired format as what a legacy passage is, and preserves it', async () => {
    const onChange = await renderNoteEditor(EXPANDED_HTML);

    fireEvent.contextMenu(document.querySelector('.verse-expansion') as HTMLElement);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Change format/ }));
    await screen.findByTestId('verse-expand-preview');

    // Present and selected, even though it is not on the offered list...
    const legacy = screen.getByRole('radio', { name: /Standard/ }) as HTMLInputElement;
    expect(legacy.checked).toBe(true);
    expect(legacy.closest('[data-format-legacy]')).not.toBeNull();
    // ...and it still renders, rather than previewing an empty passage.
    expect(screen.getByTestId('verse-expand-preview').textContent)
      .toContain('For God so loved the world');

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastHtml(onChange)).toContain('data-expansion-format="standard"');
  });

  it('does not offer it over ordinary prose', async () => {
    await renderNoteEditor('<p>Just some writing</p>');
    fireEvent.contextMenu(document.querySelector('.ProseMirror p') as HTMLElement);
    expect(screen.queryByRole('menuitem', { name: /Change format/ })).not.toBeInTheDocument();
  });

  // Reading a note should not raise controls over it: an offer on hover would
  // hang over the text after the pointer had moved on, with no mouseout to
  // clear it.
  it('does not offer it on hover', async () => {
    await renderNoteEditor(EXPANDED_HTML_HASHED);
    fireEvent.mouseOver(document.querySelector('.verse-expansion') as HTMLElement);
    expect(screen.queryByRole('button', { name: /Change format/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Change format/ })).not.toBeInTheDocument();
  });

  it('withdraws the offer once the user has edited the passage', async () => {
    // Expanded text is ordinary editable content - a user may well type a
    // parenthetical into it. Re-formatting replaces the passage wholesale, so
    // offering it here would silently delete their words. The content hash
    // recorded at insertion no longer matches, so the item is withheld.
    const edited = expandedHtml(
      EXPANDED_TEXT + ' (emphasis mine)',
      expansionContentHash(EXPANDED_TEXT),
    );
    await renderNoteEditor(edited);

    fireEvent.contextMenu(document.querySelector('.verse-expansion') as HTMLElement);
    expect(screen.queryByRole('menuitem', { name: /Change format/ })).not.toBeInTheDocument();
  });

  it('still offers it on a pristine passage carrying a matching hash', async () => {
    await renderNoteEditor(EXPANDED_HTML_HASHED);
    fireEvent.contextMenu(document.querySelector('.verse-expansion') as HTMLElement);
    expect(await screen.findByRole('menuitem', { name: /Change format/ })).toBeInTheDocument();
  });
});
