/**
 * Right-click a detected Bible reference in a note -> pick a format -> the
 * reference is replaced by the verse text.
 *
 * Driven through the real `NoteEditor`, because the parts most likely to
 * break are the wiring, not the pieces: that the menu opens only over a
 * `.verse-ref-detected` decoration, that the ProseMirror range is resolved
 * from the DOM correctly, and that what the preview shows is what lands in
 * the document.
 *
 * This is testable in jsdom only because the hit-test uses `posAtDOM` (a
 * DOM->document mapping, no layout) rather than `posAtCoords`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
import { __clearVerseFetchCache } from '../../../services/verseFetchCache';
import { enT } from '../../../testing/enCatalog';

const JOHN_3_16 = {
  verse_id: 43003016,
  book_number: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world',
  text_html: 'For God so loved the world',
};

function renderEditor(onChange = vi.fn()) {
  const utils = render(
    <NoteEditor value="<p>See John 3:16 today</p>" onChange={onChange} />,
  );
  return { ...utils, onChange };
}

function lastHtml(onChange: ReturnType<typeof vi.fn>): string {
  return String(onChange.mock.calls.at(-1)?.[0] ?? '');
}

function refDecoration(): HTMLElement {
  const el = document.querySelector('.verse-ref-detected');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe('notes editor verse expansion', () => {
  beforeEach(() => {
    __clearVerseFetchCache();
    localStorage.clear();
    getVerses.mockReset();
    getVerses.mockResolvedValue([JOHN_3_16]);
    activeTabs = [{ abbreviation: 'KJV' }];
  });

  it('detects the reference and decorates it in the rendered document', async () => {
    renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());
    expect(refDecoration().textContent).toBe('John 3:16');
  });

  it('opens the verse menu on right-click over the reference', async () => {
    renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());

    fireEvent.contextMenu(refDecoration());
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Expand to full text…' })).toBeInTheDocument();
  });

  it('leaves right-click on ordinary prose alone', async () => {
    const { container } = renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());

    const paragraph = container.querySelector('.ProseMirror p') as HTMLElement;
    fireEvent.contextMenu(paragraph);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('replaces the reference with the chosen format and keeps the sentence intact', async () => {
    const { onChange } = renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());

    fireEvent.contextMenu(refDecoration());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand to full text…' }));

    // The popover appears once the verses have been fetched.
    const preview = await screen.findByTestId('verse-expand-preview');
    expect(preview.textContent).toContain('For God so loved the world');

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] as string | undefined;
      expect(html).toBeDefined();
      expect(html).toContain('For God so loved the world');
      expect(html).not.toContain('John 3:16 today');
    });
    // The surrounding prose survives - this replaces the reference, not the line.
    const finalHtml = onChange.mock.calls.at(-1)?.[0] as string;
    expect(finalHtml).toContain('See ');
    expect(finalHtml).toContain('today');
  });

  /**
   * "John 3:16-17, Tab, 2, Enter."
   *
   * The dialog is driven here through right-click rather than Tab because
   * jsdom will not let a DOM selection move ProseMirror's caret, so Tab needs
   * a raw `Editor` - that half (Tab claims the key and hands the host a
   * request to open *this* dialog, with the verses already resolved) is pinned
   * in `verseExpandTab.test.tsx`. From the dialog on, the two are the same
   * object in the same state, which is what this covers: a digit picks the
   * format by its catalog number, and Enter inserts it with that format's
   * remembered options and no further interaction.
   */
  it('picks a format by its number and inserts on Enter, with no mouse at all', async () => {
    const { onChange } = renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());

    fireEvent.contextMenu(refDecoration());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand to full text…' }));
    await screen.findByTestId('verse-expand-preview');

    // The dialog takes focus on a format *radio*, not a text field, so the
    // digits are live from the moment it opens - which is what makes the whole
    // flow work without touching anything else first. (The copy mode focuses
    // the reference box instead, because there the passage is what the user
    // came to change.)
    const focused = document.activeElement as HTMLElement;
    expect(focused.closest('[data-format-id]')).toBeTruthy();

    fireEvent.keyDown(focused, { key: '4' });
    expect((screen.getByRole('radio', { name: /Verse headings/ }) as HTMLInputElement).checked)
      .toBe(true);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: '2' });
    expect((screen.getByRole('radio', { name: /Numbered quote/ }) as HTMLInputElement).checked)
      .toBe(true);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });

    await waitFor(() =>
      expect(lastHtml(onChange)).toContain('data-expansion-format="blockquote-numbered"'),
    );
    expect(lastHtml(onChange)).toContain('For God so loved the world');
  });

  it('remembers the chosen format for the next expansion', async () => {
    renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());

    fireEvent.contextMenu(refDecoration());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand to full text…' }));
    await screen.findByTestId('verse-expand-preview');

    // A clipboard format, chosen from the notes editor: it is written to
    // *both* stores, so "the format I was last using" does not disagree
    // between the two surfaces.
    fireEvent.click(screen.getByRole('radio', { name: /Custom Template/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

    // Persisted, so it is still the choice after a restart - not just for the
    // rest of this session.
    await waitFor(() => expect(localStorage.getItem('bible-desktop-last-copy-format')).toBe('template'));
  });

  it('offers the note-insertion formats and quotes the passage into the note', async () => {
    const { onChange } = renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());

    fireEvent.contextMenu(refDecoration());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand to full text…' }));
    await screen.findByTestId('verse-expand-preview');

    // The shapes a note has and a plain line of text does not.
    fireEvent.click(screen.getByRole('radio', { name: /Numbered quote/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] as string | undefined;
      expect(html).toContain('<blockquote>');
    });
    const finalHtml = onChange.mock.calls.at(-1)?.[0] as string;
    expect(finalHtml).toContain('(16) For God so loved the world');
    // Still stamped, so it can be re-formatted like any other expansion.
    expect(finalHtml).toContain('data-expansion-format="blockquote-numbered"');
    // And remembered for the next insertion.
    expect(localStorage.getItem('bible-desktop-last-insert-format')).toBe('blockquote-numbered');
  });

  it('remembers each format’s own options, keyed by format', async () => {
    renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());

    fireEvent.contextMenu(refDecoration());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand to full text…' }));
    await screen.findByTestId('verse-expand-preview');

    fireEvent.click(screen.getByRole('radio', { name: /Verse headings/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Heading level' }), {
      target: { value: '2' },
    });

    // The preview is the same call Insert makes, so this is the real output.
    expect(screen.getByTestId('verse-expand-preview').querySelector('h2')).not.toBeNull();

    // Saved as it changes - dismissing the picker must not throw the setting
    // away - and against this format alone.
    const saved = JSON.parse(localStorage.getItem('bible-desktop-passage-insert-options') ?? '{}');
    expect(saved['heading-per-verse'].headingLevel).toBe(2);
    expect(saved.blockquote).toBeUndefined();
  });

  it('closes the menu on Escape without touching the document', async () => {
    const { onChange } = renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());
    const callsBefore = onChange.mock.calls.length;

    fireEvent.contextMenu(refDecoration());
    await screen.findByRole('menu');
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(onChange.mock.calls.length).toBe(callsBefore);
  });

  /**
   * An anchored popover was reported as "the button cuts off", for two
   * independent causes - one test each below.
   */
  describe('the picker is a centered modal', () => {
    async function openPicker(): Promise<HTMLElement> {
      await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());
      fireEvent.contextMenu(refDecoration());
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand to full text…' }));
      await screen.findByTestId('verse-expand-preview');
      return screen.getByRole('dialog');
    }

    it('portals out of the pane instead of rendering inside it', async () => {
      // Cause 1: dockview sets `.dv-dockview { contain: layout }`, which makes
      // the dock pane the containing block for `position: fixed` descendants.
      // A dialog declared inside the pane is displaced by the dock grid's
      // origin; only a portal to document.body escapes that.
      const { container } = renderEditor();
      const dialog = await openPicker();

      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(container.contains(dialog)).toBe(false);
      expect(document.body.contains(dialog)).toBe(true);
    });

    it('keeps Cancel/Insert out of the scrolling region', async () => {
      // Cause 2: `usePopupPosition` always set `overflowY: auto` plus a
      // maxHeight from the space left below the anchor, so with the caret low
      // in the pane the whole dialog scrolled and the action row fell below
      // the fold. The footer is now a sibling of the scrolling body.
      renderEditor();
      const dialog = await openPicker();

      const insert = screen.getByRole('button', { name: 'Insert' });
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(insert.closest('.overflow-y-auto')).toBeNull();
      expect(cancel.closest('.overflow-y-auto')).toBeNull();

      // The body does scroll - the footer is pinned beside it, not above a
      // dialog that has no scrolling region at all.
      const preview = screen.getByTestId('verse-expand-preview');
      expect(preview.parentElement?.closest('.overflow-y-auto')).not.toBeNull();

      // And nothing computes a height for it from an anchor point any more.
      expect(dialog.style.maxHeight).toBe('');
      expect(dialog.style.top).toBe('');
    });

    it('cancels on Escape without touching the document', async () => {
      const { onChange } = renderEditor();
      await openPicker();
      const callsBefore = onChange.mock.calls.length;

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() =>
        expect(screen.queryByTestId('verse-expand-preview')).not.toBeInTheDocument(),
      );
      expect(onChange.mock.calls.length).toBe(callsBefore);
    });

    it('cancels when the backdrop behind it is clicked', async () => {
      const { onChange } = renderEditor();
      const dialog = await openPicker();
      const backdrop = dialog.parentElement as HTMLElement;
      const callsBefore = onChange.mock.calls.length;

      fireEvent.mouseDown(backdrop);

      await waitFor(() =>
        expect(screen.queryByTestId('verse-expand-preview')).not.toBeInTheDocument(),
      );
      expect(onChange.mock.calls.length).toBe(callsBefore);
    });

    it('still offers the "always use this format" checkbox', async () => {
      // It moved into the pinned footer with the buttons; it must not have
      // been lost in the move.
      renderEditor();
      await openPicker();

      const skip = screen.getByRole('checkbox', {
        name: /Always use this format/,
      });
      expect((skip as HTMLInputElement).checked).toBe(false);

      fireEvent.click(skip);
      expect(localStorage.getItem('bible-desktop-passage-insert-skip-menu')).toBe('true');
    });
  });

  it('navigates when "Go to verse" is chosen', async () => {
    renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('navigate-to-verse', listener);

    fireEvent.contextMenu(refDecoration());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Go to verse' }));

    window.removeEventListener('navigate-to-verse', listener);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({ book: '43', chapter: '3', verse: '16' });
  });

  it('does not open the popover when no Bible translation is available', async () => {
    activeTabs = [];
    renderEditor();
    await waitFor(() => expect(document.querySelector('.verse-ref-detected')).not.toBeNull());

    fireEvent.contextMenu(refDecoration());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand to full text…' }));

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(screen.queryByTestId('verse-expand-preview')).not.toBeInTheDocument();
    expect(getVerses).not.toHaveBeenCalled();
  });
});
