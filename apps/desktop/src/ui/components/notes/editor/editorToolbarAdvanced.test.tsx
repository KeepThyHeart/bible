/**
 * The editor toolbar's "advanced" row (task 0216, item 7): writing-direction
 * buttons (LTR / RTL / Auto) and subscript / superscript live in a row that
 * opens on demand, remembered per user. Auto stays the default direction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));
vi.mock('../../../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'bible_default',
  useBibleStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ navigateToVerseInPrimary: vi.fn(), availableBibles: [], loadAvailableBibles: vi.fn() }),
    { getState: () => ({ panels: new Map() }) },
  ),
}));
vi.mock('../../../services/electronAPI', () => ({
  bibleAPI: { getVerses: vi.fn().mockResolvedValue([]), getVerse: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../../VersePreviewTooltip', () => ({ default: () => null }));

import NoteEditor from './NoteEditor';
import { flushTiptapDestroyOnTeardown } from './flushTiptapDestroy';

flushTiptapDestroyOnTeardown();

const KEY = 'notesToolbarAdvancedOpen';
const toggle = () => screen.getByRole('button', { name: 'editorToolbar.advancedTitle' });

describe('editor toolbar advanced row', () => {
  beforeEach(() => localStorage.clear());

  it('hides the direction buttons and sub/superscript until opened', () => {
    render(<NoteEditor value="<p>Hi</p>" onChange={vi.fn()} />);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'editorToolbar.directionGroup' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('editorToolbar.directionRtlTitle')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('editorToolbar.subscriptTitle')).not.toBeInTheDocument();
  });

  it('opens on demand with Auto as the active direction, and closes again', () => {
    render(<NoteEditor value="<p>Hi</p>" onChange={vi.fn()} />);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'editorToolbar.directionGroup' })).toBeInTheDocument();
    expect(screen.getByLabelText('editorToolbar.directionAutoTitle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('editorToolbar.directionRtlTitle')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('editorToolbar.directionLtrTitle')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('editorToolbar.subscriptTitle')).toBeInTheDocument();
    expect(screen.getByLabelText('editorToolbar.superscriptTitle')).toBeInTheDocument();

    fireEvent.click(toggle());
    expect(screen.queryByLabelText('editorToolbar.directionRtlTitle')).not.toBeInTheDocument();
  });

  it('remembers open/closed in localStorage', () => {
    const first = render(<NoteEditor value="<p>Hi</p>" onChange={vi.fn()} />);
    fireEvent.click(toggle());
    expect(localStorage.getItem(KEY)).toBe('1');
    first.unmount();

    render(<NoteEditor value="<p>Hi</p>" onChange={vi.fn()} />);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('editorToolbar.directionRtlTitle')).toBeInTheDocument();

    fireEvent.click(toggle());
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('still works when storage throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<NoteEditor value="<p>Hi</p>" onChange={vi.fn()} />);
    fireEvent.click(toggle());
    expect(screen.getByLabelText('editorToolbar.directionRtlTitle')).toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
  });
});
