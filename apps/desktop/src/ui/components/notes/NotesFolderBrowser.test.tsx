/**
 * The browser's right-click menu.
 *
 * "Move to..." is here because the move it opens already existed twice over -
 * in the editor sidebar, and as drag-and-drop onto a folder in the current
 * listing - and users could find neither. "Export To..." is *not* here: it was
 * rendered only when an `onExport` prop was supplied, and the one component
 * that renders this browser never supplied one, so it was a menu item that did
 * nothing. These tests pin both facts.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

vi.mock('../../services/fileNotesAPI', () => ({
  listDirectory: vi.fn().mockResolvedValue([]),
}));

import NotesFolderBrowser from './NotesFolderBrowser';
import type { FileEntry } from '../../services/fileNotesAPI';
import { enT } from '../../testing/enCatalog';

const NOTE: FileEntry = {
  name: 'Romans 8',
  path: 'Documents/Romans 8.bn',
  isDirectory: false,
  modified: '2026-01-01T00:00:00.000Z',
};

const FOLDER: FileEntry = {
  name: 'Sermons',
  path: 'Documents/Sermons',
  isDirectory: true,
  modified: '2026-01-01T00:00:00.000Z',
};

function renderBrowser(
  overrides: Partial<React.ComponentProps<typeof NotesFolderBrowser>> = {},
) {
  const onMoveTo = vi.fn();
  const props = {
    entries: [NOTE, FOLDER],
    currentPath: 'Documents',
    onOpenFolder: vi.fn(),
    onOpenNote: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onOpenInExplorer: vi.fn(),
    onMoveTo,
    ...overrides,
  };
  render(<NotesFolderBrowser {...props} />);
  return { onMoveTo };
}

/** Right-click the row for `name`, which is what opens the context menu. */
function openContextMenu(name: string): void {
  fireEvent.contextMenu(screen.getByText(name));
}

describe('NotesFolderBrowser context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers "Move to..." on a note, and hands the entry to the caller', () => {
    const { onMoveTo } = renderBrowser();

    openContextMenu('Romans 8');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to...' }));

    expect(onMoveTo).toHaveBeenCalledWith(NOTE);
  });

  // Folders are not draggable either: a folder can be dropped into its own
  // subtree, and the destination list has no way to refuse that.
  it('does not offer "Move to..." on a folder', () => {
    renderBrowser();

    openContextMenu('Sermons');

    expect(screen.queryByRole('menuitem', { name: 'Move to...' })).not.toBeInTheDocument();
  });

  it('does not offer it inside Verse Notes, where nothing is user-filed', () => {
    renderBrowser({ isVerseNotesFolder: true });

    openContextMenu('Romans 8');

    expect(screen.queryByRole('menuitem', { name: 'Move to...' })).not.toBeInTheDocument();
  });

  it('no longer shows the dead "Export To..." item', () => {
    renderBrowser();

    openContextMenu('Romans 8');

    expect(screen.queryByRole('menuitem', { name: /Export/i })).not.toBeInTheDocument();
    // The menu is otherwise intact.
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reveal in Explorer' })).toBeInTheDocument();
  });
});
