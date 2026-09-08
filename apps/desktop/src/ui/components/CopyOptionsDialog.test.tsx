/**
 * "Copy Passage" - the Bible pane's mode of the shared {@link PassageDialog}.
 *
 * The dialog itself moved: copying a passage to the clipboard and inserting
 * one into a note are one dialog now, with `mode` the only difference. These
 * tests cover it through `CopyOptionsDialog`, the Bible pane's adapter, which
 * is what the pane actually opens - so they pin the copy mode end to end
 * rather than the shared component in isolation. `notes/editor/*` covers the
 * insert and re-format modes through their own adapter.
 *
 * Two consequences of the merge show up throughout:
 *
 *   - the dialog is **portaled to `document.body`** (dockview's
 *     `contain: layout` makes a `fixed inset-0` backdrop cover only the pane),
 *     so everything here queries through `screen`, never the render container;
 *   - the format list is **five**, not seven. "Standard" and "Combined" were
 *     restatements of "Numbered quote" and "Inline quote" in a weaker engine,
 *     which is why nobody could say what the difference was. They still
 *     render, so old notes keep their shape, but they are not offered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import CopyOptionsDialog from './CopyOptionsDialog';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import {
  PASSAGE_INSERT_KEYS,
  getPassageFormatCatalog,
} from '../services/copyFormats';
import enUi from '../../../locales/en/ui.json';
import { enT } from '../testing/enCatalog';

// Resolved against the real `en` catalog rather than a hand-written map, so a
// mistyped key renders `[key]` and fails the assertion instead of matching a
// copy of the same typo.
const catalog = enUi as Record<string, string>;

// Mock the IPC services
vi.mock('../services/verseRangeService', () => ({
  fetchVersesByReference: vi.fn().mockResolvedValue([]),
  getDisplayReference: vi.fn().mockReturnValue('John 3:16'),
}));

// The shared reference resolver reaches for the Bible store (for the
// translation list) and for IPC (to fetch a re-typed reference). The dialog
// opens seeded with the verses it was handed, so neither is exercised unless a
// test edits the reference.
const loadAvailableBibles = vi.fn();
vi.mock('../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'bible_default',
  useBibleStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        availableBibles: [{ abbreviation: 'KJV', name: 'King James Version' }],
        loadAvailableBibles,
      }),
    {
      getState: () => ({
        panels: new Map([
          ['bible_default', { openTabs: [{ abbreviation: 'KJV' }], activeTabIndex: 0 }],
        ]),
      }),
    },
  ),
}));

vi.mock('../services/electronAPI', () => ({
  bibleAPI: {
    getVerses: vi.fn().mockResolvedValue([]),
    getVerse: vi.fn().mockResolvedValue(null),
  },
}));

// The registry itself is *not* mocked: the dialog's format list is part of what
// this file covers, and a hand-written list of ids would have kept passing
// after the redesign removed two of them.
vi.mock('../services/verseCopyService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/verseCopyService')>();
  return {
    ...actual,
    copyToClipboard: vi.fn().mockResolvedValue(true),
    getLastUsedFormatOptions: vi.fn().mockReturnValue({
      displayVersionNumber: true,
      wordsOfChristInRed: false,
    }),
    setLastUsedFormatId: vi.fn(),
    setLastUsedFormatOptions: vi.fn(),
  };
});

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const JOHN_3_16 = 'For God so loved the world';
const JOHN_3_17 = 'For God sent not his Son';

const mockVerses = [
  { verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: JOHN_3_16 },
  { verse_id: 43003017, book_number: 43, chapter: 3, verse: 17, text: JOHN_3_17 },
];
const mockVerse = mockVerses[0];
const mockContext = { bookName: 'John', chapter: 3, translation: 'KJV' };

function openDialog(verses: typeof mockVerses | typeof mockVerse = mockVerse, onClose = vi.fn()) {
  return renderWithProviders(
    <CopyOptionsDialog verses={verses} context={mockContext} onClose={onClose} />,
  );
}

/** The dialog's preview pane, which renders exactly what Copy would write. */
function previewText(): string {
  return screen.getByRole('region', { name: 'Preview' }).textContent ?? '';
}

function format(name: string): HTMLInputElement {
  return screen.getByRole('radio', { name: new RegExp(name, 'i') }) as HTMLInputElement;
}

/** The primary action. Its accessible name is the bare verb, by design. */
function copyButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement;
}

describe('CopyOptionsDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('chrome', () => {
    it('renders the dialog title', () => {
      openDialog(mockVerse, onClose);
      expect(screen.getByText('Copy Passage')).toBeInTheDocument();
    });

    it('has an accessible dialog role', () => {
      openDialog(mockVerse, onClose);
      expect(screen.getByRole('dialog', { name: 'Copy Passage' })).toBeInTheDocument();
    });

    // Not in the render container: dockview's `contain: layout` makes a
    // `fixed inset-0` backdrop cover the pane rather than the window, so the
    // dialog has to be portaled to leave the dock grid behind.
    it('renders outside the pane it was opened from', () => {
      const { container } = openDialog(mockVerse, onClose);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('shows reference input with the verse reference', () => {
      openDialog(mockVerse, onClose);
      expect(screen.getByDisplayValue('John 3:16')).toBeInTheDocument();
    });

    it('shows the preview region', () => {
      openDialog(mockVerse, onClose);
      expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument();
    });

    // The verb alone, so a screen reader announces the action rather than the
    // action plus a keyboard hint plus a verse count.
    it('names the primary action after what it does', () => {
      openDialog(mockVerses, onClose);
      expect(copyButton()).toBeEnabled();
      expect(copyButton().textContent).toContain('(Enter)');
    });

    it('calls onClose when Cancel is clicked', async () => {
      const user = userEvent.setup();
      openDialog(mockVerse, onClose);
      await user.click(screen.getByText(/Cancel/));
      expect(onClose).toHaveBeenCalled();
    });

    it('closes when Escape key is pressed', async () => {
      const user = userEvent.setup();
      openDialog(mockVerse, onClose);
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('format list', () => {
    // One list, one order, one set of numbers - shared with the notes editor's
    // insert mode through `formatCatalog`, so "2" means the same shape
    // wherever it is typed.
    it('offers the five formats, as radios, in the catalog order', () => {
      openDialog(mockVerse, onClose);

      const radios = screen.getAllByRole('radio') as HTMLInputElement[];
      expect(radios.map(r => r.value)).toEqual(getPassageFormatCatalog().map(f => f.id));
      expect(radios.map(r => r.value)).toEqual([
        'blockquote',
        'blockquote-numbered',
        'inline-quote',
        'heading-per-verse',
        'template',
      ]);
    });

    it('shows each format’s number, so the shortcut is discoverable', () => {
      openDialog(mockVerse, onClose);

      const badges = Array.from(
        document.body.querySelectorAll('[data-format-number]'),
      ) as HTMLElement[];
      expect(badges.map(b => b.textContent)).toEqual(['1', '2', '3', '4', '5']);
      // A hint, not part of the format's name: a screen reader reading "three
      // inline quote" would announce a count.
      expect(badges.every(b => b.getAttribute('aria-hidden') === 'true')).toBe(true);
      expect(screen.getByTestId('format-shortcut-hint').textContent).toMatch(/1.*5/);
    });

    // The question this whole change answers: "what's the difference between
    // Standard and Numbered Quote?" - the answer was "nothing worth a list
    // entry", so they are gone, and every surviving entry says what it does.
    it('does not offer the formats the consolidation removed', () => {
      openDialog(mockVerse, onClose);

      for (const gone of ['Standard', 'Combined', 'Inline', 'Plain', 'Advanced']) {
        expect(screen.queryByRole('radio', { name: new RegExp(`^${gone}$`, 'i') })).toBeNull();
      }
    });

    it('describes every format it offers', () => {
      openDialog(mockVerse, onClose);
      for (const entry of getPassageFormatCatalog()) {
        expect(screen.getByText(catalog[`${entry.labelKey}.description`])).toBeInTheDocument();
      }
    });

    it('names the group so the radios are announced together', () => {
      openDialog(mockVerse, onClose);
      expect(screen.getByRole('radiogroup', { name: 'Format' })).toBeInTheDocument();
    });
  });

  describe('per-format option visibility', () => {
    it('shows a shape’s own controls, and only the ones it uses', async () => {
      const user = userEvent.setup();
      openDialog(mockVerse, onClose);

      await user.click(format('Verse headings'));
      expect(screen.getByRole('combobox', { name: /^Reference$/i })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /Verse numbers/i })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /Heading level/i })).toBeInTheDocument();

      // A block quote has no heading to level and no quote marks to choose.
      await user.click(format('Block quote'));
      expect(screen.queryByRole('combobox', { name: /Heading level/i })).toBeNull();
    });

    it('replaces the options with the template editor for Custom Template', async () => {
      const user = userEvent.setup();
      openDialog(mockVerse, onClose);

      await user.click(format('Custom Template'));

      // A template is fully user-controlled, so none of the shape options apply.
      expect(screen.queryByRole('combobox', { name: /Verse numbers/i })).toBeNull();
      expect(screen.queryByRole('combobox', { name: /^Reference$/i })).toBeNull();
      expect(screen.getByLabelText('Template')).toBeInTheDocument();
    });

    // `{{#blockquote}}` is the one helper a hand-written template cannot
    // reasonably do for itself - the passage's line count is not known when the
    // template is written - so it has to be discoverable where the variables are.
    it('lists the block-quote helper among the template variables', async () => {
      const user = userEvent.setup();
      openDialog(mockVerse, onClose);

      await user.click(format('Custom Template'));
      await user.click(screen.getByRole('button', { name: /template variables/i }));

      expect(screen.getByText('{{#blockquote}}...{{/blockquote}}')).toBeInTheDocument();
    });
  });

  describe('the verse-numbers control', () => {
    // "(16)" was the first option's entire label - an example with no name, so
    // the list read as a specimen rather than a choice.
    it('names each style and shows its example beside it', async () => {
      const user = userEvent.setup();
      openDialog(mockVerse, onClose);

      await user.click(format('Numbered quote'));
      const select = screen.getByRole('combobox', { name: /Verse numbers/i });
      const labels = Array.from(select.querySelectorAll('option')).map(o => o.textContent);

      expect(labels).toEqual(['In parentheses (16)', 'Superscript ¹⁶', 'None']);
    });
  });

  describe('output shapes', () => {
    it('previews a numbered quote as the source text the clipboard will get', async () => {
      const user = userEvent.setup();
      openDialog(mockVerses, onClose);

      await user.click(format('Numbered quote'));

      expect(previewText()).toBe(
        `John 3:16-17 (KJV)\n\n    (16) ${JOHN_3_16}\n    (17) ${JOHN_3_17}`,
      );
    });

    it('writes the quote bar as Markdown when asked', async () => {
      const user = userEvent.setup();
      openDialog(mockVerses, onClose);

      await user.click(format('Numbered quote'));
      await user.click(screen.getByRole('checkbox', { name: /Markdown/i }));

      // Two trailing spaces are Markdown's own Shift+Enter: they end the line
      // without ending the paragraph, which is what separates the verses of a
      // numbered quote. A bare `>` - a blank quoted line - is a paragraph
      // break, and belongs only where the source text actually has one.
      expect(previewText()).toBe(
        `John 3:16-17 (KJV)\n\n> (16) ${JOHN_3_16}  \n> (17) ${JOHN_3_17}`,
      );
    });

    it('drops the block-quote indent for the Inline text format', async () => {
      const user = userEvent.setup();
      openDialog(mockVerses, onClose);

      await user.click(format('Numbered quote'));
      await user.selectOptions(screen.getByRole('combobox', { name: /Text format/i }), 'inline');

      expect(previewText()).toBe(
        `John 3:16-17 (KJV)\n\n(16) ${JOHN_3_16}\n(17) ${JOHN_3_17}`,
      );
    });

    it('renders a custom template through the shared engine', async () => {
      const user = userEvent.setup();
      openDialog(mockVerses, onClose);

      await user.click(format('Custom Template'));
      const editor = screen.getByLabelText('Template') as HTMLTextAreaElement;
      // `fireEvent`, not `user.type`: userEvent reads `{` as the start of a
      // key descriptor, and a Handlebars template is almost entirely braces.
      fireEvent.change(editor, {
        target: { value: '{{#blockquote}}{{#each verses}}{{text}}{{/each}}{{/blockquote}}' },
      });

      expect(previewText()).toBe(`> ${JOHN_3_16}${JOHN_3_17}`);
    });
  });

  describe('clipboard flavours', () => {
    // The plain-text renderer puts exactly one blank line between the reference
    // and the passage. The rich-text flavour - the one a Notes paste actually
    // consumes - must map each newline to exactly one <br>: mapping an empty
    // line to its own <br> *and* taking another from the join would turn a
    // single blank line into three <br> and show two blank lines in the note.
    it('writes one <br> per newline, so a blank line stays one blank line', async () => {
      const user = userEvent.setup();
      const { copyToClipboard } = await import('../services/verseCopyService');

      openDialog(mockVerses, onClose);
      // A template, because it is the remaining format whose clipboard HTML is
      // built by joining source lines with <br> - a markup shape brings its own
      // structure instead (see the note-insertion block below).
      await user.click(format('Custom Template'));
      fireEvent.change(screen.getByLabelText('Template'), {
        target: { value: '{{reference}}\n\n{{#each verses}}{{text}}\n{{/each}}' },
      });
      // The rich-text flavour is only written when this option is on.
      await user.click(screen.getByRole('checkbox', { name: /Words of Christ in red/i }));
      await user.click(copyButton());

      const html = vi.mocked(copyToClipboard).mock.calls.at(-1)?.[1] ?? '';
      expect(html).not.toContain('<br><br>');
      expect(html.match(/<br>/g)?.length).toBe(
        (vi.mocked(copyToClipboard).mock.calls.at(-1)?.[0] ?? '').split('\n').length - 1,
      );
    });
  });
});

/**
 * The note-insertion shapes on the clipboard.
 *
 * They are offered here too, not only by the notes editor: a `<blockquote>`
 * means nothing to a clipboard *as markup* - but written out as source text
 * it is exactly what a clipboard consumer wants, which is what
 * `passageMarkupToSourceText` is for. These tests pin that the copy mode
 * renders them, offers their per-format shape controls, and still honours
 * the two clipboard-level choices (Markdown, and whether the quote is
 * decorated at all).
 */
describe('CopyOptionsDialog: the note-insertion shapes', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('previews Verse headings as source text, not as an approximation', async () => {
    const user = userEvent.setup();
    openDialog(mockVerses, onClose);

    await user.click(format('Verse headings'));

    expect(previewText()).toBe(
      [
        'John 3:16-17 (KJV)',
        '',
        'Verse 16',
        '',
        `    (16) ${JOHN_3_16}`,
        '',
        'Verse 17',
        '',
        `    (17) ${JOHN_3_17}`,
      ].join('\n'),
    );
  });

  it('writes the headings and the quote bar as Markdown when asked', async () => {
    const user = userEvent.setup();
    openDialog(mockVerses, onClose);

    await user.click(format('Verse headings'));
    await user.click(screen.getByRole('checkbox', { name: /Markdown/i }));

    expect(previewText()).toContain('### Verse 16');
    expect(previewText()).toContain(`> (16) ${JOHN_3_16}`);
  });

  // A note's blockquote is a *shape*; a clipboard's is a decoration, and
  // someone pasting into a plain field may want neither.
  it('drops the quote decoration for the Inline text format', async () => {
    const user = userEvent.setup();
    openDialog(mockVerses, onClose);

    await user.click(format('Block quote'));
    expect(previewText()).toContain(`    ${JOHN_3_16}`);

    await user.selectOptions(screen.getByRole('combobox', { name: /Text format/i }), 'inline');
    expect(previewText()).not.toContain(`    ${JOHN_3_16}`);
    expect(previewText()).toContain(JOHN_3_16);
  });

  it('does not offer the quote decoration to an inline quotation', async () => {
    const user = userEvent.setup();
    openDialog(mockVerses, onClose);

    await user.click(format('Inline quote'));
    // There is no quote block to decorate, so the control would do nothing.
    expect(screen.queryByRole('combobox', { name: /Text format/i })).toBeNull();
  });

  it('remembers each shape’s options per format, as the notes editor does', async () => {
    const user = userEvent.setup();
    const { unmount } = openDialog(mockVerses, onClose);

    await user.click(format('Verse headings'));
    await user.selectOptions(screen.getByRole('combobox', { name: /Heading level/i }), '2');

    const stored = JSON.parse(localStorage.getItem(PASSAGE_INSERT_KEYS.options) ?? '{}');
    expect(stored['heading-per-verse']).toMatchObject({ headingLevel: 2 });
    // And against that format alone.
    expect(stored['blockquote']).toBeUndefined();

    unmount();
    openDialog(mockVerses, onClose);
    await user.click(format('Verse headings'));
    expect(
      (screen.getByRole('combobox', { name: /Heading level/i }) as HTMLSelectElement).value,
    ).toBe('2');
  });

  // The block tree already knows its own structure, so the rich flavour is
  // that structure rather than the source text with line breaks in it.
  it('writes real headings and a real block quote as the HTML flavour', async () => {
    const user = userEvent.setup();
    const { copyToClipboard } = await import('../services/verseCopyService');
    openDialog(mockVerses, onClose);

    await user.click(format('Verse headings'));
    await user.click(copyButton());

    const html = vi.mocked(copyToClipboard).mock.calls.at(-1)?.[1] ?? '';
    expect(html).toContain('<h3>');
    expect(html).toContain('<blockquote>');
  });

  it('suppresses the HTML flavour for Markdown, like every other format', async () => {
    const user = userEvent.setup();
    const { copyToClipboard } = await import('../services/verseCopyService');
    openDialog(mockVerses, onClose);

    await user.click(format('Verse headings'));
    await user.click(screen.getByRole('checkbox', { name: /Markdown/i }));
    await user.click(copyButton());

    expect(vi.mocked(copyToClipboard).mock.calls.at(-1)?.[1]).toBeUndefined();
  });
});

/**
 * The digit shortcuts.
 *
 * The number beside a format is a key, and it is the *same* key in every mode.
 * The guard is the interesting half: the copy mode opens with the reference
 * box focused, and "John 3:16" is mostly digits.
 */
describe('CopyOptionsDialog: the number-key shortcuts', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('picks the format with that number when focus is outside a text field', async () => {
    const user = userEvent.setup();
    openDialog(mockVerses, onClose);

    // Clicking a radio moves focus out of the reference box.
    await user.click(format('Block quote'));

    await user.keyboard('4');
    expect(format('Verse headings').checked).toBe(true);

    await user.keyboard('3');
    expect(format('Inline quote').checked).toBe(true);
  });

  it('claims no digit beyond the formats that exist', async () => {
    const user = userEvent.setup();
    openDialog(mockVerses, onClose);

    await user.click(format('Inline quote'));
    await user.keyboard('6');
    expect(format('Inline quote').checked).toBe(true);
  });

  it('leaves digits alone while the reference is being typed', async () => {
    const user = userEvent.setup();
    openDialog(mockVerses, onClose);

    // The dialog focuses the reference box on open, and "Romans 3:23" is
    // mostly digits - claiming them here would make the field unusable.
    const reference = screen.getByDisplayValue('John 3:16') as HTMLInputElement;
    await user.clear(reference);
    await user.type(reference, 'Romans 3:23');

    expect(reference.value).toBe('Romans 3:23');
    expect(format('Block quote').checked).toBe(true);
  });

  it('leaves digits alone inside the template editor', async () => {
    const user = userEvent.setup();
    openDialog(mockVerses, onClose);

    await user.click(format('Custom Template'));
    const editor = screen.getByLabelText('Template') as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, '2 verses');

    expect(editor.value).toBe('2 verses');
    expect(format('Custom Template').checked).toBe(true);
  });
});
