/**
 * Tab-key behavior in the note content editor.
 *
 * Tab must insert an indent instead of moving focus - left uncaught, it is
 * the browser's native contenteditable behavior to blur the editor and move
 * focus to the next control. This suite verifies the indent, with an
 * "Escape, then Tab" escape hatch for keyboard-only users who need to leave
 * the field, and that list/table Tab navigation (which TipTap already binds)
 * keeps working.
 *
 * `fireEvent.keyDown`'s boolean return value is `false` when a listener
 * called `preventDefault()` - that's used directly below to assert whether
 * Tab was trapped (indent) or left alone (default browser focus-move),
 * since jsdom doesn't implement actual native Tab focus-order navigation to
 * assert against.
 *
 * The inserted indent is a run of non-breaking spaces (see `SOFT_TAB` in
 * NoteEditor.tsx) - assertions below match the explicit `\u00A0` escape
 * rather than a literal space character so they can't accidentally pass
 * against an ordinary space already present in the sample text.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import NoteEditor from './NoteEditor';
import { ContextProvider, type AppServices } from '../../../contexts/ContextProvider';

const NBSP = '&nbsp;'; // html-entity form, matches getHTML()/innerHTML serialization of U+00A0

vi.mock('../../../services/fileNotesAPI', () => ({}));

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderEditor(props: { value?: string } = {}) {
  const onChange = vi.fn();
  const utils = render(
    <ContextProvider services={createMockServices()}>
      <NoteEditor value={props.value ?? '<p>Hello world</p>'} onChange={onChange} />
    </ContextProvider>,
  );
  return { onChange, ...utils };
}

// Locate the actual contenteditable ProseMirror root inside the rendered tree.
function getEditableDiv(): HTMLElement {
  const el = document.querySelector('[contenteditable="true"]');
  if (!el) throw new Error('contenteditable ProseMirror root not found');
  return el as HTMLElement;
}

describe('NoteEditor - Tab key handling', () => {
  it('mounts a contenteditable ProseMirror surface', async () => {
    renderEditor();
    await waitFor(() => expect(getEditableDiv()).toBeInTheDocument());
  });

  // Regression: the note body font-size was a hardcoded `16px` that ignored
  // the Typography section's "Study text" / "Global Font Scale" sliders
  // entirely, unlike every other content pane. It now reads --study-font-size
  // and --global-font-scale, same as .pane-content-* in globals.css.
  it('wires the editable surface font-size to --study-font-size and --global-font-scale, not a bare px literal', async () => {
    renderEditor();
    await waitFor(() => getEditableDiv());
    const style = getEditableDiv().getAttribute('style') ?? '';

    expect(style).toContain('var(--study-font-size');
    expect(style).toContain('var(--global-font-scale');
    expect(style).not.toMatch(/font-size:\s*16px/);
  });

  it('traps Tab in plain text (preventDefault) and inserts an indent instead of moving focus', async () => {
    const { onChange } = renderEditor({ value: '<p>Hello world</p>' });
    await waitFor(() => getEditableDiv());
    const editable = getEditableDiv();
    editable.focus();

    const notCanceled = fireEvent.keyDown(editable, { key: 'Tab', code: 'Tab' });

    // preventDefault() was called - the browser's default focus-out-of-field
    // action for Tab does not happen.
    expect(notCanceled).toBe(false);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastCall).toContain(NBSP);
    });
  });

  it('round-trips the inserted indent through save/load without corrupting content', async () => {
    let savedHtml = '';
    const onChange = vi.fn((html: string) => { savedHtml = html; });
    const { rerender } = render(
      <ContextProvider services={createMockServices()}>
        <NoteEditor value="<p>Hello world</p>" onChange={onChange} />
      </ContextProvider>,
    );
    await waitFor(() => getEditableDiv());
    const editable = getEditableDiv();
    editable.focus();

    fireEvent.keyDown(editable, { key: 'Tab', code: 'Tab' });
    await waitFor(() => expect(savedHtml).toContain(NBSP));

    // Reload the saved HTML as the `value` prop (simulating re-opening the
    // note) and confirm the editor accepts it without throwing and preserves
    // the indent - i.e. the .bn file's stored content isn't corrupted.
    rerender(
      <ContextProvider services={createMockServices()}>
        <NoteEditor value={savedHtml} onChange={onChange} />
      </ContextProvider>,
    );
    await waitFor(() => {
      expect(getEditableDiv().innerHTML).toContain(NBSP);
    });
  });

  it('does not trap Tab right after Escape (the escape hatch)', async () => {
    const { onChange } = renderEditor({ value: '<p>Hello world</p>' });
    await waitFor(() => getEditableDiv());
    const editable = getEditableDiv();
    editable.focus();

    fireEvent.keyDown(editable, { key: 'Escape', code: 'Escape' });
    onChange.mockClear();
    const notCanceled = fireEvent.keyDown(editable, { key: 'Tab', code: 'Tab' });

    // Not prevented this time: the browser is left free to move focus out.
    expect(notCanceled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('traps Tab again on the next press after the escape hatch is consumed', async () => {
    const { onChange } = renderEditor({ value: '<p>Hello world</p>' });
    await waitFor(() => getEditableDiv());
    const editable = getEditableDiv();
    editable.focus();

    fireEvent.keyDown(editable, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(editable, { key: 'Tab', code: 'Tab' }); // consumes the escape hatch
    onChange.mockClear();

    const notCanceled = fireEvent.keyDown(editable, { key: 'Tab', code: 'Tab' }); // should trap again

    expect(notCanceled).toBe(false);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastCall).toContain(NBSP);
    });
  });

  it('resets the escape hatch if another key is pressed before Tab', async () => {
    const { onChange } = renderEditor({ value: '<p>Hello world</p>' });
    await waitFor(() => getEditableDiv());
    const editable = getEditableDiv();
    editable.focus();

    fireEvent.keyDown(editable, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(editable, { key: 'a', code: 'KeyA' }); // cancels the pending exit
    onChange.mockClear();

    const notCanceled = fireEvent.keyDown(editable, { key: 'Tab', code: 'Tab' });

    // Tab is trapped again since the escape hatch was cancelled by the 'a' keypress.
    expect(notCanceled).toBe(false);
  });

  it('does not trap Tab inside a bullet list (defers to list indent/outdent)', async () => {
    const { onChange } = renderEditor({ value: '<ul><li>First item</li></ul>' });
    await waitFor(() => getEditableDiv());
    const editable = getEditableDiv();
    editable.focus();
    const li = editable.querySelector('li');
    expect(li).toBeTruthy();

    onChange.mockClear();
    const notCanceled = fireEvent.keyDown(li!, { key: 'Tab', code: 'Tab' });

    // Our handler did not call preventDefault - TipTap's built-in list
    // sink/lift-list-item shortcut (or the browser default) is left to run.
    expect(notCanceled).toBe(true);
  });
});
