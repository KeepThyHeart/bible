/**
 * "+ Bible Passage" and "type a reference, press Tab" are one feature.
 *
 * The toolbar opens the same dialog Tab does, with a reference field on top,
 * and what it inserts is indistinguishable from what Tab inserts. Keeping
 * them as two - the toolbar button opening its own `InsertPassageDialog`,
 * with its own HTML, its own options, and no stamped expansion mark - would
 * make the same passage inserted two ways come out looking different, with
 * only one of the two re-formattable afterwards. These tests pin the merge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

let activeTabs: Array<{ abbreviation: string }> = [{ abbreviation: 'KJV' }];
const loadAvailableBibles = vi.fn();
let availableBibles: Array<{ abbreviation: string; name: string }> = [
  { abbreviation: 'KJV', name: 'King James Version' },
];

vi.mock('../../../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'bible_default',
  useBibleStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ navigateToVerseInPrimary: vi.fn(), availableBibles, loadAvailableBibles }),
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
import { __clearVerseFetchCache } from '../../../services/verseFetchCache';
import { enString, enT } from '../../../testing/enCatalog';

const JOHN_3_16 = {
  verse_id: 43003016,
  book_number: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world',
  text_html: 'For God so loved the world',
};

const JOHN_3_17 = {
  verse_id: 43003017,
  book_number: 43,
  chapter: 3,
  verse: 17,
  text: 'For God sent not his Son',
  text_html: 'For God sent not his Son',
};

function lastHtml(onChange: ReturnType<typeof vi.fn>): string {
  return String(onChange.mock.calls.at(-1)?.[0] ?? '');
}

/** Open the unified dialog the way the toolbar button does. */
async function openFromToolbar(onChange = vi.fn()) {
  const utils = render(<NoteEditor value="<p>Writing here</p>" onChange={onChange} />);
  fireEvent.click(screen.getByTitle(enString('editorToolbar.insertPassageTitle')));
  return { ...utils, onChange };
}

describe('the toolbar and Tab open the same passage dialog', () => {
  beforeEach(() => {
    __clearVerseFetchCache();
    localStorage.clear();
    getVerses.mockReset();
    getVerses.mockResolvedValue([JOHN_3_16]);
    activeTabs = [{ abbreviation: 'KJV' }];
    availableBibles = [{ abbreviation: 'KJV', name: 'King James Version' }];
  });

  it('asks for a reference, and offers nothing to format until it has one', async () => {
    await openFromToolbar();

    expect(await screen.findByTestId('passage-reference-input')).toBeInTheDocument();
    // No preview and no format list yet - there is nothing to lay out.
    expect(screen.queryByTestId('verse-expand-preview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled();
  });

  it('resolves the typed reference and previews it in the chosen format', async () => {
    await openFromToolbar();

    fireEvent.change(await screen.findByTestId('passage-reference-input'), {
      target: { value: 'John 3:16' },
    });

    const preview = await screen.findByTestId('verse-expand-preview', {}, { timeout: 3000 });
    expect(preview.textContent).toContain('For God so loved the world');
    expect(getVerses).toHaveBeenCalledWith('KJV', 43003016, 43003016);
  });

  it('says so when the reference cannot be parsed, rather than fetching', async () => {
    await openFromToolbar();

    fireEvent.change(await screen.findByTestId('passage-reference-input'), {
      target: { value: 'not a reference' },
    });

    await waitFor(() =>
      expect(screen.getByTestId('passage-reference-status').textContent).toBe(
        'Invalid reference',
      ),
    );
    expect(getVerses).not.toHaveBeenCalled();
  });

  // The whole point of the merge: a toolbar insertion carries the same
  // expansion identity a Tab insertion does, so "Change format..." works on it.
  it('stamps the expansion mark, so the passage stays re-formattable', async () => {
    const { onChange } = await openFromToolbar();

    fireEvent.change(await screen.findByTestId('passage-reference-input'), {
      target: { value: 'John 3:16' },
    });
    await screen.findByTestId('verse-expand-preview', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

    await waitFor(() => expect(lastHtml(onChange)).toContain('data-expansion-id'));
    const out = lastHtml(onChange);
    expect(out).toContain('For God so loved the world');
    expect(out).toContain('data-expansion-ref="John 3:16"');
  });

  it('inserts as a blockquote without writing quote characters into the text', async () => {
    const { onChange } = await openFromToolbar();

    fireEvent.change(await screen.findByTestId('passage-reference-input'), {
      target: { value: 'John 3:16' },
    });
    await screen.findByTestId('verse-expand-preview', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

    await waitFor(() => expect(lastHtml(onChange)).toContain('blockquote'));
    // The quote bar says "quoted"; curly quotes in the content would be a
    // second, redundant marker - and one the document would actually contain.
    expect(lastHtml(onChange)).not.toContain('“');
    expect(lastHtml(onChange)).not.toContain('”');
  });

  it('offers comment room under each verse for the verse-by-verse layout', async () => {
    getVerses.mockResolvedValue([JOHN_3_16, JOHN_3_17]);
    const { onChange } = await openFromToolbar();

    fireEvent.change(await screen.findByTestId('passage-reference-input'), {
      target: { value: 'John 3:16-17' },
    });
    await screen.findByTestId('verse-expand-preview', {}, { timeout: 3000 });

    fireEvent.click(screen.getByRole('radio', { name: /Verse headings/ }));
    fireEvent.click(
      screen.getByLabelText('Room to comment under each verse', { exact: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

    await waitFor(() => expect(lastHtml(onChange)).toContain('Comments for'));
    const out = lastHtml(onChange);
    expect(out).toContain('John 3:16');
    expect(out).toContain('John 3:17');
  });

  // The digit shortcuts pick a format by its catalog number - but "John 3:16"
  // is mostly digits, and this entry point opens with the caret in the
  // reference field. Claiming them there would make the field unusable, so the
  // shortcut is guarded on focus rather than on a modifier.
  it('leaves the digits to the reference field while it has focus', async () => {
    getVerses.mockResolvedValue([JOHN_3_16, JOHN_3_17]);
    await openFromToolbar();

    const input = (await screen.findByTestId('passage-reference-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'John 3:16-17' } });
    await screen.findByTestId('verse-expand-preview', {}, { timeout: 3000 });

    input.focus();
    fireEvent.keyDown(input, { key: '3' });

    // Still on the shape the toolbar entry point names, not on format 3.
    expect((screen.getByRole('radio', { name: /Block quote/ }) as HTMLInputElement).checked)
      .toBe(true);

    // Out of the field, the same key picks a format.
    const picker = screen.getByRole('radio', { name: /Block quote/ });
    picker.focus();
    fireEvent.keyDown(picker, { key: '3' });
    expect((screen.getByRole('radio', { name: /Inline quote/ }) as HTMLInputElement).checked)
      .toBe(true);
  });

  it('says the number keys pick a format, so the badges mean something', async () => {
    await openFromToolbar();

    fireEvent.change(await screen.findByTestId('passage-reference-input'), {
      target: { value: 'John 3:16' },
    });
    await screen.findByTestId('verse-expand-preview', {}, { timeout: 3000 });

    expect(screen.getByTestId('format-shortcut-hint').textContent).toMatch(/1.*5/);
  });

  // "Always use this format" governs what Tab does. From the toolbar the user
  // has come here precisely to choose, so the offer would be noise.
  it('does not offer the Tab shortcut checkbox from the toolbar', async () => {
    await openFromToolbar();
    await screen.findByTestId('passage-reference-input');
    expect(screen.queryByText(/Always use this format/)).not.toBeInTheDocument();
  });


  // The dialog opened three rows tall (one status line) and jumped to its full
  // height when the debounced fetch landed, moving Insert out from under the
  // pointer. jsdom does no layout, so what is asserted is the box itself: the
  // same declared height before and after, and a status line that fills the
  // space the controls will occupy rather than leaving it empty.
  it('is the same size before and after the passage resolves', async () => {
    await openFromToolbar();

    const boxBefore = (await screen.findByTestId('passage-dialog')).className;
    expect(boxBefore).toContain('h-[85vh]');
    expect(boxBefore).toContain('max-h-[54rem]');
    expect((await screen.findByTestId('passage-reference-status')).className).toContain('flex-1');

    fireEvent.change(await screen.findByTestId('passage-reference-input'), {
      target: { value: 'John 3:16' },
    });
    await screen.findByTestId('verse-expand-preview', {}, { timeout: 3000 });

    expect(screen.getByTestId('passage-dialog').className).toBe(boxBefore);
  });

  // A one-verse passage and a failed lookup are the two ends of the range the
  // fixed box has to look right at; both keep the pinned footer reachable.
  it('keeps its shape for a one-verse passage and for a failed lookup', async () => {
    await openFromToolbar();
    const dialog = await screen.findByTestId('passage-dialog');
    const box = dialog.className;

    fireEvent.change(await screen.findByTestId('passage-reference-input'), {
      target: { value: 'John 3:16' },
    });
    await screen.findByTestId('verse-expand-preview', {}, { timeout: 3000 });
    expect(screen.getByTestId('passage-dialog').className).toBe(box);

    getVerses.mockResolvedValue([]);
    fireEvent.change(screen.getByTestId('passage-reference-input'), {
      target: { value: 'John 99:1' },
    });
    await screen.findByTestId('passage-reference-status', {}, { timeout: 3000 });
    expect(screen.getByTestId('passage-dialog').className).toBe(box);
    // Cancel/Insert are outside the scrolling region, fixed height or not.
    expect(screen.getByRole('button', { name: 'Insert' }).closest('.overflow-y-auto')).toBeNull();
  });

  it('hides the translation picker when only one Bible is installed', async () => {
    await openFromToolbar();
    await screen.findByTestId('passage-reference-input');
    expect(screen.queryByTestId('passage-translation-select')).not.toBeInTheDocument();
  });

  it('offers the translation picker when more than one is installed', async () => {
    availableBibles = [
      { abbreviation: 'KJV', name: 'King James Version' },
      { abbreviation: 'ASV', name: 'American Standard Version' },
    ];
    await openFromToolbar();
    expect(await screen.findByTestId('passage-translation-select')).toBeInTheDocument();
  });
});
