import { useCallback, useEffect, useState } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';

/**
 * How deep the walk goes. Notes folders are organised by hand, so anything
 * past this is either a mistake or a symlink loop; either way the dialog is
 * better off short than hung.
 */
const MAX_DEPTH = 8;

/**
 * How many folders the dialog will offer. A flat list past this length is
 * unusable anyway, and the cap is what keeps a pathological tree from firing
 * thousands of `listDirectory` round-trips.
 */
const MAX_FOLDERS = 300;

/**
 * Loads the list of folders shown in the Move-to-folder dialog whenever the
 * dialog is opened. Returns the current folder list, root ('') first.
 *
 * The walk is **recursive**: listing `''` only would let a note be moved into
 * `Sermons` but never into `Sermons/2026` - and organising notes into
 * subfolders is the entire reason someone opens this dialog. Depth and count
 * are bounded (see the constants above) rather than trusted, because the
 * notes directory is an ordinary folder on the user's disk: it can contain a
 * symlink loop or a checked-out repository, and neither should hang the dialog.
 */
export function useMoveDialogFolders(showMoveDialog: boolean): string[] {
  const [moveFolders, setMoveFolders] = useState<string[]>([]);

  const loadFolders = useCallback(async () => {
    const found: string[] = [];

    const walk = async (path: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || found.length >= MAX_FOLDERS) return;
      // A folder the OS refuses to list is skipped, not fatal: the rest of the
      // tree is still a valid set of destinations.
      const items = await fileNotesAPI.listDirectory(path).catch(() => []);
      const directories = items.filter(e => e.isDirectory);
      for (const dir of directories) {
        if (found.length >= MAX_FOLDERS) return;
        found.push(dir.path);
        await walk(dir.path, depth + 1);
      }
    };

    await walk('', 1);
    // Root is always offered, and always first - it is the "take this back out
    // of wherever I filed it" destination.
    setMoveFolders(['', ...found]);
  }, []);

  useEffect(() => {
    if (showMoveDialog) {
      void loadFolders();
    }
  }, [showMoveDialog, loadFolders]);

  return moveFolders;
}
