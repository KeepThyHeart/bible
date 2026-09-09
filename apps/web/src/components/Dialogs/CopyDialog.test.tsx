// @vitest-environment jsdom
/**
 * Component tests for CopyDialog.
 *
 * The dialog is a thin shell over `@bible/core`'s passage-format engine, so
 * these tests deliberately do *not* re-derive the expected output: the shapes
 * themselves are pinned by core's `passageMarkup.test.ts`. What is pinned here
 * is everything the shell owns — which formats are offered and under which
 * numbers, that the preview is the selected format rendered as real structure,
 * that an option reaches the preview, what lands on the clipboard in each
 * flavour, the keyboard gestures, and the migration of a preference written by
 * the version of this dialog that had its own format list.
 *
 * `t` resolves against the real `en` catalog rather than echoing keys, because
 * half of what this file checks is that a control is labelled at all.
 *
 * The `@vitest-environment jsdom` above is load-bearing, for the reason
 * `utils/sanitize.test.ts` sets out at length: the preview renders each line
 * through `sanitizeHtml`, and under happy-dom 15 DOMPurify mangles its own
 * output — it drops a fragment's leading text node and strips the first
 * element's attributes, so the red-letter span and the verse number in front
 * of it both vanish. Browsers have a real DOM and are unaffected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', async () => {
  const catalog = (await import('../../locales/en/ui.json')).default as Record<string, unknown>;
  const translate = (key: string, vars?: Record<string, unknown>): string => {
    const value = key.split('.').reduce<unknown>(
      (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
      catalog,
    );
    if (typeof value !== 'string') return key;
    return vars
      ? value.replace(/\{\{(\w+)\}\}/g, (_whole, name: string) => String(vars[name] ?? ''))
      : value;
  };
  return {
    useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
    initReactI18next: { type: '3rdParty', init: vi.fn() },
  };
});

// ---- Store mock ----------------------------------------------------------
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

import type { BibleTab } from '../../stores/bibleStore';

function makeTab(overrides: Partial<BibleTab> = {}): BibleTab {
  return {
    id: 'tab-1',
    moduleAbbr: 'KJV',
    moduleName: 'King James Version',
    book: 43,
    chapter: 3,
    studyVerse: 43003016, // John 3:16
    previewVerse: null,
    previewVerseEnd: null,
    selectionEndVerse: null,
    verses: [
      {
        verse_id: 43003016,
        book_number: 43,
        chapter: 3,
        verse: 16,
        text: 'For God so loved the world',
        text_html: '<span>For God so loved the world</span>',
        is_paragraph_start: false,
        words_of_christ: false,
      },
      {
        verse_id: 43003017,
        book_number: 43,
        chapter: 3,
        verse: 17,
        text: 'For God did not send his Son',
        text_html: '<span>For God did not send his Son</span>',
        is_paragraph_start: false,
        words_of_christ: false,
      },
    ],
    loading: false,
    scrollPosition: 0,
    pendingScrollVerse: null,
    pendingScrollTop: null,
    hasInterlinearData: false,
    displayMode: 'standard',
    history: [],
    historyIndex: -1,
    showBackBar: false,
    ...overrides,
  };
}

/** The same tab, but with verse 16 carrying words-of-Christ markup. */
function makeRedLetterTab(): BibleTab {
  const tab = makeTab();
  const verses = tab.verses.map(v =>
    v.verse === 16
      ? {
          ...v,
          words_of_christ: true,
          text_html: '<span class="christ-words">For God so loved the world</span>',
        }
      : v,
  );
  return makeTab({ verses });
}

let mockActiveTab: BibleTab | null = makeTab();

// Rest parameter, not `() =>`: the store method is forwarded as
// `(...args: unknown[]) => mockFetchChapter(...args)`, and an argument-less
// implementation narrows the mock to zero arity.
const mockFetchChapter = vi.fn((..._args: unknown[]) => Promise.resolve(makeTab().verses));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => mockActiveTab,
    fetchChapter: (...args: unknown[]) => mockFetchChapter(...args),
  },
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBookName: () => 'John',
    getBookByNumber: () => ({ book_number: 43, book_name: 'John', chapter_count: 21 }),
  },
}));

vi.mock('../../utils/bookNames', () => ({
  getAllBookNames: () => ({ '43': 'John' }),
}));

vi.mock('../../constants', () => ({
  formatPassageRef: (_book: number, _ch: number, verse: number, bookName: string) => `${bookName} 3:${verse}`,
}));

// ---- Clipboard -----------------------------------------------------------
// Both flavours are captured: the rich path writes a `ClipboardItem` and the
// plain path calls `writeText`, and which one runs is itself under test.
const mockWriteText = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockClipboardWrite = vi.fn((..._args: unknown[]) => Promise.resolve());

class FakeClipboardItem {
  constructor(public readonly parts: Record<string, Blob>) {}
}
(globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = FakeClipboardItem;

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockWriteText, write: mockClipboardWrite },
  configurable: true,
});

/**
 * Reads one clipboard flavour back out of its `Blob`.
 *
 * This file runs under jsdom (see the note at the top), whose `Blob` predates
 * `text()` and exposes only `size`, `type` and `slice()`. `FileReader` it does
 * implement, so that is the way back to the bytes here. Browsers and happy-dom
 * both have `Blob.text()`, which is why the dialog itself is none the wiser.
 */
function readBlob(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function writtenFlavours(): Promise<Record<string, string>> {
  const items = mockClipboardWrite.mock.calls[0][0] as FakeClipboardItem[];
  const out: Record<string, string> = {};
  for (const [type, blob] of Object.entries(items[0].parts)) {
    out[type] = await readBlob(blob);
  }
  return out;
}

import { enString } from '../../testing/enCatalog';
import { CopyDialog } from './CopyDialog';
import { COPY_PREFERENCE_KEYS } from './copyPreferences';

// ---- Helpers -------------------------------------------------------------
const tick = () => new Promise(r => setTimeout(r, 0));

const preview = (c: Element): HTMLElement => c.querySelector<HTMLElement>('.copy-dialog__preview')!;
const previewText = (c: Element): string => preview(c).textContent ?? '';

const formatRows = (c: Element): HTMLElement[] =>
  Array.from(c.querySelectorAll<HTMLElement>('.copy-dialog__format'));

const formatRadio = (c: Element, id: string): HTMLInputElement =>
  c.querySelector<HTMLInputElement>(`[data-format-id="${id}"] input`)!;

const selectFormat = (c: Element, id: string) => fireEvent.click(formatRadio(c, id));

const selectedFormatId = (c: Element): string | undefined =>
  formatRows(c).find(row => row.querySelector<HTMLInputElement>('input')!.checked)
    ?.dataset.formatId;

/** One row of the options panel, found by the label it carries. */
const optionRow = (c: Element, label: string): HTMLElement | undefined =>
  Array.from(c.querySelectorAll<HTMLElement>('.copy-dialog__option'))
    .find(el => el.textContent?.includes(label));

const optionSelect = (c: Element, label: string): HTMLSelectElement =>
  optionRow(c, label)!.querySelector<HTMLSelectElement>('select')!;

const optionCheckbox = (c: Element, label: string): HTMLInputElement =>
  optionRow(c, label)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

const setRange = (c: Element, value: string) =>
  fireEvent.input(c.querySelector<HTMLInputElement>('.copy-dialog__ref-field input')!, {
    target: { value },
  });

const toggleMarkdown = (c: Element) => fireEvent.click(optionCheckbox(c, 'Markdown formatting'));

describe('CopyDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockActiveTab = makeTab();
    mockWriteText.mockResolvedValue(undefined);
    mockClipboardWrite.mockResolvedValue(undefined);
  });

  // ------------------------------------------------------------------
  // Open / closed state
  // ------------------------------------------------------------------
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<CopyDialog isOpen={false} onClose={onClose} />);
    expect(container.querySelector('.copy-dialog')).toBeNull();
  });

  it('renders nothing when there is no active tab', () => {
    mockActiveTab = null;
    const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
    expect(container.querySelector('.copy-dialog')).toBeNull();
  });

  it('renders the dialog when isOpen is true and a tab is active', () => {
    const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
    expect(container.querySelector('.copy-dialog')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Dialog chrome
  // ------------------------------------------------------------------
  it('renders the title', () => {
    render(<CopyDialog isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Copy Verses')).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', () => {
    const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
    fireEvent.click(container.querySelector<HTMLElement>('.copy-dialog__header button')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the overlay is mouse-downed', () => {
    const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
    fireEvent.mouseDown(container.querySelector<HTMLElement>('.copy-dialog-overlay')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when clicking inside the dialog', () => {
    const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
    fireEvent.mouseDown(container.querySelector<HTMLElement>('.copy-dialog')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    render(<CopyDialog isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // The numbered format list
  //
  // Names, order and numbers come from core's catalog, which both apps read —
  // so "3 is inline quote" means the same thing here as in the desktop app.
  // ------------------------------------------------------------------
  describe('format list', () => {
    it('offers the four markup shapes, in catalog order under their catalog numbers', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      const rows = formatRows(container);
      expect(rows.map(r => r.dataset.formatId)).toEqual([
        'blockquote',
        'blockquote-numbered',
        'inline-quote',
        'heading-per-verse',
      ]);
      expect(rows.map(r => r.querySelector<HTMLElement>('.copy-dialog__format-number')!.textContent))
        .toEqual(['1', '2', '3', '4']);
    });

    it('does not offer the custom template, which stays hidden on the web', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(container.querySelector('[data-format-id="template"]')).toBeNull();
    });

    it('names each format and says what it does', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      const first = formatRows(container)[0];
      // Read the copy from the catalog rather than pinning it here: this test
      // is about the name and description being wired through and rendered, and
      // an exact-prose assertion breaks every time the wording is edited.
      expect(first.querySelector('.copy-dialog__format-name')!.textContent)
        .toBe(enString('ui.passageInsert.format.blockquote.name'));
      expect(first.querySelector('.copy-dialog__format-desc')!.textContent)
        .toBe(enString('ui.passageInsert.format.blockquote.description'));
    });

    it('is a radio group, with the number kept out of the accessible name', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(container.querySelector('[role="radiogroup"]')).toBeTruthy();
      expect(formatRows(container)[0].querySelector('.copy-dialog__format-number')!
        .getAttribute('aria-hidden')).toBe('true');
    });

    it('starts on the catalog default', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(selectedFormatId(container)).toBe('blockquote');
    });

    it('selects the clicked format', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      selectFormat(container, 'inline-quote');
      expect(selectedFormatId(container)).toBe('inline-quote');
    });

    it('says the numbers are keys', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(container.querySelector('.copy-dialog__format-hint')!.textContent)
        .toBe('Press 1–4 to pick a format');
    });
  });

  // ------------------------------------------------------------------
  // Digit shortcuts
  // ------------------------------------------------------------------
  describe('digit shortcuts', () => {
    it('selects the format wearing that number', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      fireEvent.keyDown(document, { key: '3' });
      expect(selectedFormatId(container)).toBe('inline-quote');
    });

    it('keeps working while the format list itself has focus', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      formatRadio(container, 'blockquote').focus();
      fireEvent.keyDown(document, { key: '4' });
      expect(selectedFormatId(container)).toBe('heading-per-verse');
    });

    it('leaves the digits alone while the reference box has focus', () => {
      // A reference is mostly digits; claiming them there would make the field
      // unusable.
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      container.querySelector<HTMLInputElement>('.copy-dialog__ref-field input')!.focus();
      fireEvent.keyDown(document, { key: '2' });
      expect(selectedFormatId(container)).toBe('blockquote');
    });

    it('ignores a digit carrying a modifier', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      fireEvent.keyDown(document, { key: '2', ctrlKey: true });
      expect(selectedFormatId(container)).toBe('blockquote');
    });

    it('ignores a number past the end of the list', () => {
      // 5 is the hidden Custom Template. It must not be reachable by a key the
      // list does not show.
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      fireEvent.keyDown(document, { key: '5' });
      expect(selectedFormatId(container)).toBe('blockquote');
    });
  });

  // ------------------------------------------------------------------
  // Reference field
  // ------------------------------------------------------------------
  describe('reference field', () => {
    it('renders the field and its label', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(container.querySelector('.copy-dialog__ref-field input')).toBeTruthy();
      expect(screen.getAllByText('Reference').length).toBeGreaterThan(0);
    });

    it('widens the passage without closing the dialog', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(previewText(container)).not.toContain('For God did not send his Son');
      setRange(container, 'John 3:16-17');
      expect(previewText(container)).toContain('For God did not send his Son');
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Preview — the block tree, not a flat string
  // ------------------------------------------------------------------
  describe('preview', () => {
    it('renders a block quote for the block-quote format', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      setRange(container, 'John 3:16-17');
      expect(preview(container).querySelector('blockquote')).toBeTruthy();
      expect(previewText(container)).toContain('For God so loved the world');
      expect(previewText(container)).toContain('— John 3:16-17 (KJV)');
    });

    it('renders a heading per verse for the heading format', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      setRange(container, 'John 3:16-17');
      selectFormat(container, 'heading-per-verse');
      const headings = Array.from(preview(container).querySelectorAll('h3'));
      expect(headings.map(h => h.textContent)).toEqual(['Verse 16', 'Verse 17']);
    });

    it('renders an inline quotation as one run', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      setRange(container, 'John 3:16-17');
      selectFormat(container, 'inline-quote');
      expect(preview(container).querySelector('blockquote')).toBeNull();
      expect(previewText(container)).toContain('John 3:16-17 (KJV): “For God so loved the world');
    });

    it('follows the verse-number control', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      setRange(container, 'John 3:16-17');
      selectFormat(container, 'blockquote-numbered');
      expect(previewText(container)).toContain('(16)');

      fireEvent.change(optionSelect(container, 'Verse numbers'), { target: { value: 'none' } });
      expect(previewText(container)).not.toContain('(16)');
    });

    it('follows the reference-position control', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      setRange(container, 'John 3:16-17');
      fireEvent.change(optionSelect(container, 'Reference'), { target: { value: 'none' } });
      expect(previewText(container)).not.toContain('John 3:16-17');
    });

    it('follows the heading-level control', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      selectFormat(container, 'heading-per-verse');
      fireEvent.change(optionSelect(container, 'Heading level'), { target: { value: '1' } });
      expect(preview(container).querySelector('h1')).toBeTruthy();
      expect(preview(container).querySelector('h3')).toBeNull();
    });

    it('drops the translation when asked to', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(previewText(container)).toContain('(KJV)');
      fireEvent.click(optionCheckbox(container, 'Display translation'));
      expect(previewText(container)).not.toContain('(KJV)');
    });

    it('colours the words of Christ', () => {
      mockActiveTab = makeRedLetterTab();
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      const red = preview(container).querySelector<HTMLElement>('span[style]');
      expect(red).toBeTruthy();
      expect(red!.getAttribute('style')).toContain('#B71C1C');
      expect(red!.textContent).toBe('For God so loved the world');
    });

    it('leaves the words of Christ black when the option is off', () => {
      mockActiveTab = makeRedLetterTab();
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      fireEvent.click(optionCheckbox(container, 'Words of Christ in red'));
      expect(preview(container).querySelector('span[style]')).toBeNull();
      expect(previewText(container)).toContain('For God so loved the world');
    });

    it('drops the quote decoration when the text format is inline', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(preview(container).querySelector('blockquote')).toBeTruthy();
      fireEvent.change(optionSelect(container, 'Text format'), { target: { value: 'inline' } });
      expect(preview(container).querySelector('blockquote')).toBeNull();
      expect(previewText(container)).toContain('For God so loved the world');
    });
  });

  // ------------------------------------------------------------------
  // Option visibility: a control that cannot do anything is not rendered
  // ------------------------------------------------------------------
  describe('option visibility', () => {
    it('offers heading level only to the heading format', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(optionRow(container, 'Heading level')).toBeUndefined();
      selectFormat(container, 'heading-per-verse');
      expect(optionRow(container, 'Heading level')).toBeTruthy();
    });

    it('offers quote marks only to the inline quotation', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(optionRow(container, 'Quote marks')).toBeUndefined();
      selectFormat(container, 'inline-quote');
      expect(optionRow(container, 'Quote marks')).toBeTruthy();
    });

    it('withholds the text-format control from the inline quotation', () => {
      // There is no quote block to decorate, so the control is not offered
      // rather than shown doing nothing.
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(optionRow(container, 'Text format')).toBeTruthy();
      selectFormat(container, 'inline-quote');
      expect(optionRow(container, 'Text format')).toBeUndefined();
    });

    it('offers comment room only to the per-verse shapes', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(optionRow(container, 'Room to comment')).toBeUndefined();
      selectFormat(container, 'blockquote-numbered');
      expect(optionRow(container, 'Room to comment')).toBeTruthy();
    });

    it('always offers the two universal flags', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      for (const id of ['blockquote', 'blockquote-numbered', 'inline-quote', 'heading-per-verse']) {
        selectFormat(container, id);
        expect(optionRow(container, 'Display translation')).toBeTruthy();
        expect(optionRow(container, 'Words of Christ in red')).toBeTruthy();
      }
    });
  });

  // ------------------------------------------------------------------
  // Markdown — a restyling of whichever format is selected, not a format
  // ------------------------------------------------------------------
  describe('Markdown', () => {
    it('renders an unchecked checkbox by default', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(optionCheckbox(container, 'Markdown formatting').checked).toBe(false);
    });

    it('previews the literal source once checked', () => {
      // It reaches the clipboard as source text, so rendering the structure
      // would show styling the paste will not carry.
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      toggleMarkdown(container);
      expect(preview(container).querySelector('blockquote')).toBeNull();
      expect(previewText(container)).toContain('> For God so loved the world');
    });

    it('applies to whichever format is selected', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      toggleMarkdown(container);
      selectFormat(container, 'heading-per-verse');
      expect(previewText(container)).toContain('### Verse 16');
    });

    it('leaves the plain output undecorated while unchecked', () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(previewText(container)).not.toContain('>');
      expect(previewText(container)).not.toContain('#');
    });

    it('persists the choice across remounts', () => {
      const first = render(<CopyDialog isOpen={true} onClose={onClose} />);
      toggleMarkdown(first.container);
      first.unmount();

      const second = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(optionCheckbox(second.container, 'Markdown formatting').checked).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // The clipboard's two flavours
  // ------------------------------------------------------------------
  describe('clipboard', () => {
    it('writes the source text and the structure side by side', async () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      setRange(container, 'John 3:16-17');
      fireEvent.click(container.querySelector('.copy-dialog__copy-btn')!);
      await tick();

      const flavours = await writtenFlavours();
      // Plain: the block tree written out, quote lines carrying the indent that
      // stands in for a quote bar where there is no `>` to be had.
      expect(flavours['text/plain']).toContain('    For God so loved the world');
      expect(flavours['text/plain']).toContain('— John 3:16-17 (KJV)');
      // Rich: a real <blockquote>, so a paste into a document keeps the shape.
      expect(flavours['text/html']).toContain('<blockquote>');
      expect(flavours['text/html']).not.toContain('&lt;blockquote&gt;');
    });

    it('carries the red-letter markup into the rich flavour only', async () => {
      mockActiveTab = makeRedLetterTab();
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      fireEvent.click(container.querySelector('.copy-dialog__copy-btn')!);
      await tick();

      const flavours = await writtenFlavours();
      expect(flavours['text/html']).toContain('#B71C1C');
      expect(flavours['text/plain']).not.toContain('#B71C1C');
      expect(flavours['text/plain']).toContain('For God so loved the world');
    });

    it('writes Markdown as plain text only', async () => {
      // Writing the HTML flavour alongside would let a rich editor pick it and
      // silently discard the Markdown the user asked for.
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      toggleMarkdown(container);
      fireEvent.click(container.querySelector('.copy-dialog__copy-btn')!);
      await tick();

      expect(mockClipboardWrite).not.toHaveBeenCalled();
      expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('> For God so loved the world'));
    });

    it('writes plain text only when the red-letter option is off', async () => {
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      fireEvent.click(optionCheckbox(container, 'Words of Christ in red'));
      fireEvent.click(container.querySelector('.copy-dialog__copy-btn')!);
      await tick();

      expect(mockClipboardWrite).not.toHaveBeenCalled();
      expect(mockWriteText).toHaveBeenCalled();
    });

    it('falls back to plain text when the rich write is refused', async () => {
      mockClipboardWrite.mockRejectedValueOnce(new Error('not allowed'));
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      fireEvent.click(container.querySelector('.copy-dialog__copy-btn')!);
      await tick();
      expect(mockWriteText).toHaveBeenCalled();
    });

    it('disables the button when no verses are selected', () => {
      mockActiveTab = makeTab({ verses: [], studyVerse: null });
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(container.querySelector<HTMLButtonElement>('.copy-dialog__copy-btn')!.disabled).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Enter to copy
  //
  // The whole point of the dialog is to produce one copy, so Ctrl+C then
  // Enter should complete the gesture without reaching for the mouse.
  // ------------------------------------------------------------------
  describe('Enter to copy', () => {
    it('copies and closes on Enter', async () => {
      render(<CopyDialog isOpen={true} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Enter' });
      await tick();
      expect(mockClipboardWrite).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('does not copy on Enter while a textarea has focus', async () => {
      // A textarea owns Enter for newlines.
      render(<CopyDialog isOpen={true} onClose={onClose} />);
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();
      fireEvent.keyDown(document, { key: 'Enter' });
      await tick();
      expect(mockClipboardWrite).not.toHaveBeenCalled();
      expect(mockWriteText).not.toHaveBeenCalled();
      textarea.remove();
    });

    it('does not copy on Enter while a button has focus', async () => {
      // A keyboard-focused button should act on Enter itself rather than
      // having the dialog copy out from under it.
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      container.querySelector<HTMLButtonElement>('.copy-dialog__header button')!.focus();
      fireEvent.keyDown(document, { key: 'Enter' });
      await tick();
      expect(mockClipboardWrite).not.toHaveBeenCalled();
      expect(mockWriteText).not.toHaveBeenCalled();
    });

    it('ignores Enter when the dialog is closed', async () => {
      render(<CopyDialog isOpen={false} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Enter' });
      await tick();
      expect(mockClipboardWrite).not.toHaveBeenCalled();
      expect(mockWriteText).not.toHaveBeenCalled();
    });

    it('leaves the dialog open when the copy button is clicked', async () => {
      // Clicking keeps the old behaviour so a second copy after tweaking
      // options costs no reopen.
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      fireEvent.click(container.querySelector('.copy-dialog__copy-btn')!);
      await tick();
      expect(mockClipboardWrite).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(container.querySelector('.copy-dialog__copy-btn')!.textContent).toBe('Copied!');
    });
  });

  // ------------------------------------------------------------------
  // Preferences: persistence and the migration off the old format list
  // ------------------------------------------------------------------
  describe('preferences', () => {
    it('remembers the chosen format', () => {
      const first = render(<CopyDialog isOpen={true} onClose={onClose} />);
      selectFormat(first.container, 'inline-quote');
      first.unmount();

      const second = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(selectedFormatId(second.container)).toBe('inline-quote');
    });

    it('remembers a format\'s shape options separately from another format\'s', () => {
      const first = render(<CopyDialog isOpen={true} onClose={onClose} />);
      selectFormat(first.container, 'blockquote-numbered');
      fireEvent.change(optionSelect(first.container, 'Verse numbers'), { target: { value: 'superscript' } });
      selectFormat(first.container, 'blockquote');
      // Block quote keeps its own default rather than inheriting the choice.
      expect(optionSelect(first.container, 'Verse numbers').value).toBe('none');
      first.unmount();

      const second = render(<CopyDialog isOpen={true} onClose={onClose} />);
      selectFormat(second.container, 'blockquote-numbered');
      expect(optionSelect(second.container, 'Verse numbers').value).toBe('superscript');
    });

    it('maps a retired id onto the shape that replaced it', () => {
      localStorage.setItem(COPY_PREFERENCE_KEYS.format, 'standard');
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(selectedFormatId(container)).toBe('blockquote-numbered');
    });

    it('falls back to the default for an id with no successor', () => {
      // "advanced" was this dialog's own format before the engine was shared.
      // There is nothing to map it onto, and an unselected list with a blank
      // preview is worse than landing somewhere sensible.
      localStorage.setItem(COPY_PREFERENCE_KEYS.format, 'advanced');
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(selectedFormatId(container)).toBe('blockquote');
    });

    it('falls back to the default for a format that exists but is not offered', () => {
      localStorage.setItem(COPY_PREFERENCE_KEYS.format, 'template');
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(selectedFormatId(container)).toBe('blockquote');
    });

    it('survives a corrupt options blob, one field at a time', () => {
      localStorage.setItem(COPY_PREFERENCE_KEYS.format, 'heading-per-verse');
      localStorage.setItem(
        COPY_PREFERENCE_KEYS.markup,
        JSON.stringify({ 'heading-per-verse': { headingLevel: 99, verseNumbers: 'none' } }),
      );
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      // The bad heading level falls back to the format's default; the good
      // verse-number choice beside it survives.
      expect(optionSelect(container, 'Heading level').value).toBe('3');
      expect(optionSelect(container, 'Verse numbers').value).toBe('none');
    });

    it('ignores storage that is not an object at all', () => {
      localStorage.setItem(COPY_PREFERENCE_KEYS.markup, 'not json');
      localStorage.setItem(COPY_PREFERENCE_KEYS.advanced, '[]');
      const { container } = render(<CopyDialog isOpen={true} onClose={onClose} />);
      expect(selectedFormatId(container)).toBe('blockquote');
      expect(optionSelect(container, 'Text format').value).toBe('blockquote');
    });
  });
});
