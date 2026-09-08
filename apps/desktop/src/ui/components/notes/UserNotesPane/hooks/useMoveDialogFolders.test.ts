/**
 * The Move-to-folder destination list.
 *
 * Listing `listDirectory('')` and stopping there would let a note move into
 * `Sermons` but never into `Sermons/2026` - and subfolders are the whole
 * reason anyone opens the dialog. The walk is recursive, and bounded,
 * because the notes directory is an ordinary folder on the user's disk.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../../services/fileNotesAPI', () => ({
  listDirectory: vi.fn(),
}));

import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { useMoveDialogFolders } from './useMoveDialogFolders';

const listDirectory = fileNotesAPI.listDirectory as ReturnType<typeof vi.fn>;

function dir(path: string) {
  return {
    name: path.split('/').pop() ?? path,
    path,
    isDirectory: true,
    modified: '2026-01-01T00:00:00.000Z',
  };
}

function file(path: string) {
  return { ...dir(path), isDirectory: false };
}

/** A tree, keyed by parent path. Anything unlisted is an empty folder. */
function installTree(tree: Record<string, ReturnType<typeof dir>[]>): void {
  listDirectory.mockImplementation(async (path: string) => tree[path] ?? []);
}

describe('useMoveDialogFolders', () => {
  beforeEach(() => {
    listDirectory.mockReset();
  });

  it('walks into subfolders, so a nested destination is reachable', async () => {
    installTree({
      '': [dir('Sermons'), dir('Journal'), file('Loose note.bn')],
      Sermons: [dir('Sermons/2026'), file('Sermons/Romans 8.bn')],
      'Sermons/2026': [dir('Sermons/2026/Advent')],
    });

    const { result } = renderHook(() => useMoveDialogFolders(true));

    await waitFor(() =>
      // Root first, then each folder immediately followed by its own children,
      // which is what makes the indented list read as a tree.
      expect(result.current).toEqual([
        '',
        'Sermons',
        'Sermons/2026',
        'Sermons/2026/Advent',
        'Journal',
      ]),
    );
    // Files are never destinations.
    expect(result.current).not.toContain('Loose note.bn');
  });

  it('stops descending at the depth cap rather than following a loop', async () => {
    // Every folder claims to contain one more folder, forever - what a symlink
    // loop looks like from here.
    listDirectory.mockImplementation(async (path: string) => [
      dir(path ? `${path}/deeper` : 'deeper'),
    ]);

    const { result } = renderHook(() => useMoveDialogFolders(true));

    await waitFor(() => expect(result.current.length).toBeGreaterThan(1));
    // Bounded, and bounded well short of "hung".
    expect(result.current.length).toBeLessThanOrEqual(9);
  });

  it('skips a folder the OS will not list, and keeps the rest', async () => {
    listDirectory.mockImplementation(async (path: string) => {
      if (path === '') return [dir('Locked'), dir('Journal')];
      if (path === 'Locked') throw new Error('EACCES');
      return [];
    });

    const { result } = renderHook(() => useMoveDialogFolders(true));

    await waitFor(() => expect(result.current).toEqual(['', 'Locked', 'Journal']));
  });

  it('does not touch the disk until the dialog opens', () => {
    installTree({ '': [dir('Sermons')] });

    renderHook(() => useMoveDialogFolders(false));

    expect(listDirectory).not.toHaveBeenCalled();
  });
});
