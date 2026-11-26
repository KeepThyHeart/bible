/**
 * Right-click menu placement and the verse-note Delete item (task 0216,
 * items 8 and 10). The menu must open AT the pointer even inside a dockview
 * pane (`.dv-dockview { contain: layout }` turns the pane into the containing
 * block of `position: fixed`), so it is portalled out of the pane.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {}, localizer: { formatVerseReference: () => 'John 3:16', formatDate: () => 'Jan 1' } }),
}));
vi.mock('../../services/fileNotesAPI', () => ({ listDirectory: vi.fn().mockResolvedValue([]) }));

import NotesFolderBrowser from './NotesFolderBrowser';
import type { FileEntry } from '../../services/fileNotesAPI';

const VERSE: FileEntry = { name: '16', path: 'Verse Notes/John/3/16.bn', isDirectory: false, modified: '2026-01-01T00:00:00.000Z' };
const DOC: FileEntry = { name: 'Romans 8', path: 'Documents/Romans 8.bn', isDirectory: false, modified: '2026-01-01T00:00:00.000Z' };

function renderInPane(overrides: Partial<React.ComponentProps<typeof NotesFolderBrowser>> = {}) {
  const props = {
    entries: [VERSE],
    currentPath: 'Verse Notes/John/3',
    isVerseNotesFolder: true,
    verseNotesFolderPath: 'Verse Notes',
    onOpenFolder: vi.fn(),
    onOpenNote: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onOpenInExplorer: vi.fn(),
    ...overrides,
  };
  const pane = document.createElement('div');
  pane.className = 'dv-dockview';
  document.body.appendChild(pane);
  const utils = render(<NotesFolderBrowser {...props} />, { container: pane.appendChild(document.createElement('div')) });
  return { pane, props, ...utils };
}

describe('NotesFolderBrowser context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('dir');
  });

  // Exact placement (pointer, edge clamping, RTL) is covered by shared/PointerMenu.test.tsx.
  it('opens as a fixed menu portalled out of the pane container', () => {
    const { pane } = renderInPane();
    fireEvent.contextMenu(screen.getByRole('button'), { clientX: 120, clientY: 80 });
    const menu = screen.getByRole('menu');
    expect(menu.style.position).toBe('fixed');
    expect(pane.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
  });

  it('also portals the menu of an ordinary note out of the pane', () => {
    const { pane } = renderInPane({ entries: [DOC], currentPath: 'Documents', isVerseNotesFolder: false });
    fireEvent.contextMenu(screen.getByRole('button'), { clientX: 33, clientY: 44 });
    const menu = screen.getByRole('menu');
    expect(pane.contains(menu)).toBe(false);
  });

  it('offers Delete on a verse note and hands the entry to onDelete (the pane confirms)', () => {
    const { props } = renderInPane();
    fireEvent.contextMenu(screen.getByRole('button'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: /notesFolderBrowser\.menuDelete/ }));
    expect(props.onDelete).toHaveBeenCalledWith(VERSE);
  });

  describe('Compile passage notes and Chapter button', () => {
    const BOOK: FileEntry = { name: 'Psalms', path: 'Verse Notes/Psalms', isDirectory: true, modified: '2026-01-01T00:00:00.000Z' };
    const CHAPTER: FileEntry = { name: '119', path: 'Verse Notes/Psalms/119', isDirectory: true, modified: '2026-01-01T00:00:00.000Z' };
    const ROOT_FOLDER: FileEntry = { name: 'Verse Notes', path: 'Verse Notes', isDirectory: true, modified: '2026-01-01T00:00:00.000Z' };
    const PLAIN: FileEntry = { name: 'Psalms', path: 'Documents/Psalms', isDirectory: true, modified: '2026-01-01T00:00:00.000Z' };

    it('is offered on a book folder and a chapter folder and passes the entry', () => {
      const onCompileFolder = vi.fn();
      renderInPane({ entries: [BOOK, CHAPTER], currentPath: 'Verse Notes', onCompileFolder });
      fireEvent.contextMenu(screen.getAllByRole('button')[0], { clientX: 5, clientY: 5 });
      fireEvent.click(screen.getByTestId('menu-compile-passage-notes'));
      expect(onCompileFolder).toHaveBeenCalledWith(BOOK);
    });

    it('is not offered on a verse note, the Verse Notes root, a folder outside Verse Notes, or without a handler', () => {
      const onCompileFolder = vi.fn();
      for (const [entry, currentPath, handler] of [
        [VERSE, 'Verse Notes/John/3', onCompileFolder],
        [ROOT_FOLDER, '', onCompileFolder],
        [PLAIN, '', onCompileFolder],
        [BOOK, 'Verse Notes', undefined],
      ] as const) {
        const { unmount } = renderInPane({ entries: [entry], currentPath, isVerseNotesFolder: currentPath.startsWith('Verse Notes'), onCompileFolder: handler });
        fireEvent.contextMenu(screen.getAllByRole('button').pop()!, { clientX: 5, clientY: 5 });
        expect(screen.queryByTestId('menu-compile-passage-notes')).toBeNull();
        unmount();
      }
    });

    it('shows the Chapter button only when onOpenChapter is given', () => {
      const onOpenChapter = vi.fn();
      const withIt = renderInPane({ breadcrumbs: [{ label: 'Home', path: '' }], onOpenChapter });
      fireEvent.click(screen.getByTestId('notes-open-chapter'));
      expect(onOpenChapter).toHaveBeenCalled();
      withIt.unmount();
      renderInPane({ breadcrumbs: [{ label: 'Home', path: '' }] });
      expect(screen.queryByTestId('notes-open-chapter')).toBeNull();
    });
  });
});
