import { dialog, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { readFile } from 'fs/promises';
import { extname, resolve as resolvePath, isAbsolute } from 'path';
import { BibleNotesFileService, BnFile, NoteConflictError, NoteMissingError } from '../services/BibleNotesFileService';
import { ipcHandler, ipcHandlerWithSender, IpcKnownError } from './handler-helper';
import { broadcastNoteSaved } from './noteSavedBroadcast';
import { blessPath, isPathBlessed, isPathWithin } from './blessedPaths';
import { t } from '../services/MainI18n';
import { buildNoteDocx } from './noteDocx';
import { moveNoteDirectionKeys, clearNoteDirectionKeys } from './noteDirectionHandlers';
import { isEmptyNoteContent } from '../services/noteContent';

let fileNotesService: BibleNotesFileService | null = null;

/**
 * Initialize the file-based notes service.
 * Called on app startup.
 */
export function initializeFileNotesService(notesDir?: string): BibleNotesFileService {
  fileNotesService = new BibleNotesFileService(notesDir);
  return fileNotesService;
}

function getService(): BibleNotesFileService {
  if (!fileNotesService) {
    throw new IpcKnownError('unavailable', 'File notes service not initialized');
  }
  return fileNotesService;
}

/**
 * Translate a {@link NoteConflictError} into a classified `conflict` IPC error so
 * the renderer can branch on `err.code === 'conflict'` (see `ipcResult.ts`) and
 * warn/merge instead of treating it as an unexpected internal failure. Any other
 * error is returned unchanged for the default `internal` classification.
 */
function toConflictError(err: unknown): unknown {
  if (err instanceof NoteConflictError) {
    return new IpcKnownError('conflict', err.message);
  }
  if (err instanceof NoteMissingError) {
    return new IpcKnownError('not_found', err.message);
  }
  return err;
}

/**
 * Guard the absolute-path read/save channels. An absolute path is
 * permitted only when the user actually chose it through a main-process file
 * dialog this session (recorded in the blessed-path registry) or when it falls
 * inside the user's own configured notes directory (already reachable through
 * the relative-path handlers). Any other absolute path - e.g. one fabricated by
 * a compromised renderer - is refused so it cannot read or overwrite arbitrary
 * files on disk. Throws `IpcKnownError('unauthorized', ...)` on refusal.
 */
function assertAbsolutePathAllowed(absolutePath: string): void {
  if (isPathBlessed(absolutePath)) return;

  const notesDir = getService().getNotesDir();
  if (notesDir && isPathWithin(absolutePath, notesDir)) return;

  throw new IpcKnownError(
    'unauthorized',
    'This file path was not authorized. Open or save the file through the file dialog first.'
  );
}

/**
 * Register all IPC handlers for file-based notes.
 *
 * Uses the `Result<T>` envelope convention. The
 * renderer side lives in `src/ui/services/fileNotesAPI.ts` and uses `unwrap`
 * from `src/ui/services/ipcResult.ts`. Dialog handlers return `null` when
 * the user cancels (that is success, not an error).
 */
export function registerFileNotesHandlers(): void {
  // --- Directory / setup -------------------------------------------------

  ipcHandler<[], string>('file-notes:get-notes-dir', () => {
    return getService().getNotesDir();
  });

  ipcHandler<[], boolean>('file-notes:is-initialized', () => {
    return getService().isInitialized();
  });

  ipcHandler<[string | undefined], string>('file-notes:initialize', (notesDir) => {
    const service = getService();
    if (notesDir) {
      service.setNotesDir(notesDir);
    }
    service.ensureNotesDir();
    return service.getNotesDir();
  });

  // --- File tree ----------------------------------------------------------

  ipcHandler<[string | undefined], unknown[]>('file-notes:list-directory', (relativePath) => {
    return getService().listDirectory(relativePath ?? '');
  });

  // --- Note read/write ---------------------------------------------------

  ipcHandler<[string], BnFile | null>('file-notes:read-note', (relativePath) => {
    return getService().readNote(relativePath);
  });

  ipcHandler<[string], BnFile | null>('file-notes:read-note-absolute', (absolutePath) => {
    assertAbsolutePathAllowed(absolutePath);
    return getService().readNoteAbsolute(absolutePath);
  });

  ipcHandler<[string, string, string | undefined], BnFile>(
    'file-notes:create-note',
    (relativePath, title, type) => {
      return getService().createNote(relativePath, title, (type as BnFile['type']) || 'document');
    }
  );

  // Both handlers return the `updated` timestamp actually written to disk -
  // the main process regenerates it, so it is the only trustworthy value for
  // the renderer's next conflict-detection baseline (see
  // BibleNotesFileService.saveNote/saveNoteAbsolute).
  // After a successful save the other windows are told (`file-notes:note-saved`)
  // so a note open in two windows stays in step. The saving window is excluded:
  // it is still dirty when the push would arrive and would raise a false conflict.
  ipcHandlerWithSender<[string, BnFile, string | undefined], string>(
    'file-notes:save-note',
    async (senderId, relativePath, note, expectedUpdated) => {
      // A verse note whose text was cleared is removed rather than kept as an
      // empty file (which would leave the verse showing a note marker). The
      // empty `updated` tells the editor the note is no longer on disk, so
      // typing again re-creates it.
      if (getService().isVerseNotePath(relativePath) && isEmptyNoteContent(note.content)) {
        try {
          await getService().removeEmptiedVerseNote(relativePath, expectedUpdated);
        } catch (err) {
          throw toConflictError(err);
        }
        await clearNoteDirectionKeys(relativePath);
        return '';
      }
      let updated: string;
      try {
        updated = getService().saveNote(relativePath, note, expectedUpdated);
      } catch (err) {
        throw toConflictError(err);
      }
      const notesDir = getService().getNotesDir();
      broadcastNoteSaved({
        absolutePath: isAbsolute(relativePath) ? resolvePath(relativePath) : resolvePath(notesDir, relativePath),
        updated,
        senderId,
      });
      return updated;
    }
  );

  ipcHandlerWithSender<[string, BnFile, string | undefined], string>(
    'file-notes:save-note-absolute',
    (senderId, absolutePath, note, expectedUpdated) => {
      assertAbsolutePathAllowed(absolutePath);
      let updated: string;
      try {
        updated = getService().saveNoteAbsolute(absolutePath, note, expectedUpdated);
      } catch (err) {
        throw toConflictError(err);
      }
      broadcastNoteSaved({ absolutePath: resolvePath(absolutePath), updated, senderId });
      return updated;
    }
  );

  // --- Folder / file management ------------------------------------------

  ipcHandler<[string], void>('file-notes:create-folder', (relativePath) => {
    getService().createFolder(relativePath);
  });

  ipcHandler<[string, string], void>('file-notes:rename', async (oldPath, newPath) => {
    getService().rename(oldPath, newPath);
    await moveNoteDirectionKeys(oldPath, newPath);
  });

  ipcHandler<[string], void>('file-notes:delete', async (relativePath) => {
    await getService().deleteEntry(relativePath);
    await clearNoteDirectionKeys(relativePath);
  });

  ipcHandler<[string | undefined], void>('file-notes:open-in-file-manager', (relativePath) => {
    getService().openInFileManager(relativePath || '');
  });

  // --- Dialogs -----------------------------------------------------------

  ipcHandler<[], string | null>('file-notes:show-open-dialog', async () => {
    const window = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(window!, {
      title: t('main.dialog.openBibleNote'),
      filters: [
        { name: t('main.filter.bibleNotes'), extensions: ['bn'] },
        { name: t('main.filter.allFiles'), extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    // The user explicitly picked this path via a native dialog - authorize it
    // for the absolute read/save channels this session.
    blessPath(result.filePaths[0]);
    return result.filePaths[0];
  });

  // Pick an image file and return it as a base64 data URL. Returns null on
  // cancel or on failure - the renderer already treats null as "no image".
  ipcHandler<[], string | null>('file-notes:pick-image', async () => {
    try {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(window!, {
        title: t('main.dialog.insertImage'),
        filters: [
          { name: t('main.filter.images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
          { name: t('main.filter.allFiles'), extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const filePath = result.filePaths[0];
      const ext = extname(filePath).toLowerCase().replace('.', '');
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
      };
      const mime = mimeMap[ext] || 'image/png';
      const data = await readFile(filePath);
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch (error: unknown) {
      log.error('Failed to pick image:', error);
      return null;
    }
  });

  ipcHandler<[string | undefined], string | null>(
    'file-notes:show-save-dialog',
    async (defaultName) => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(window!, {
        title: t('main.dialog.saveBibleNoteAs'),
        defaultPath: defaultName ? `${defaultName}.bn` : undefined,
        filters: [
          { name: t('main.filter.bibleNotes'), extensions: ['bn'] },
          { name: t('main.filter.allFiles'), extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return null;
      }
      // The user explicitly picked this path via a native dialog - authorize it
      // for the absolute read/save channels this session.
      blessPath(result.filePath);
      return result.filePath;
    }
  );

  ipcHandler<[string | undefined], string | null>(
    'file-notes:show-folder-dialog',
    async (defaultPath) => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(window!, {
        title: t('main.dialog.chooseNotesFolder'),
        defaultPath: defaultPath || undefined,
        properties: ['openDirectory', 'createDirectory']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    }
  );

  // --- Verse Notes --------------------------------------------------------

  ipcHandler<
    [string, number, number, number],
    { note: BnFile; relativePath: string }
  >('file-notes:create-verse-note', (bookName, chapter, verse, verseId) => {
    return getService().createVerseNote(bookName, chapter, verse, verseId);
  });

  ipcHandler<
    [string, number, number],
    { note: BnFile; relativePath: string } | null
  >('file-notes:read-verse-note', (bookName, chapter, verse) => {
    return getService().readVerseNote(bookName, chapter, verse);
  });

  ipcHandler<[string, number, number], boolean>(
    'file-notes:has-verse-note',
    (bookName, chapter, verse) => {
      return getService().hasVerseNote(bookName, chapter, verse);
    }
  );

  ipcHandler<[], unknown[]>('file-notes:list-verse-note-books', () => {
    return getService().listVerseNoteBooks();
  });

  ipcHandler<[string], unknown[]>('file-notes:list-verse-note-chapters', (bookName) => {
    return getService().listVerseNoteChapters(bookName);
  });

  ipcHandler<[string, number], unknown[]>(
    'file-notes:list-verse-notes-in-chapter',
    (bookName, chapter) => {
      return getService().listVerseNotesInChapter(bookName, chapter);
    }
  );

  ipcHandler<[], void>('file-notes:ensure-verse-notes-folder', () => {
    getService().ensureVerseNotesFolder();
  });

  // --- Exports ------------------------------------------------------------

  // Export note as Markdown - shows save dialog then writes file. When the
  // user cancels the dialog this resolves with no value (cancellation is
  // success, not an error).
  ipcHandler<[string, string], string | null>(
    'file-notes:export-markdown',
    async (defaultName, markdownContent) => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(window!, {
        title: t('main.dialog.exportMarkdown'),
        defaultPath: `${defaultName}.md`,
        filters: [
          { name: t('main.filter.markdown'), extensions: ['md'] },
          { name: t('main.filter.allFiles'), extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      const fs = await import('fs');
      fs.writeFileSync(result.filePath, markdownContent, 'utf-8');
      return result.filePath;
    }
  );

  // Export note as DOCX - converts HTML to DOCX and saves via dialog.
  ipcHandler<[string, string, string], string | null>(
    'file-notes:export-docx',
    async (defaultName, htmlContent, noteTitle) => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(window!, {
        title: t('main.dialog.exportWord'),
        defaultPath: `${defaultName}.docx`,
        filters: [
          { name: t('main.filter.wordDocument'), extensions: ['docx'] },
          { name: t('main.filter.allFiles'), extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      const fs = await import('fs');
      const buffer = await buildNoteDocx(htmlContent, noteTitle);
      fs.writeFileSync(result.filePath, buffer);
      return result.filePath;
    }
  );
}

/**
 * Get the file notes service instance (for use by other handlers)
 */
export function getFileNotesService(): BibleNotesFileService | null {
  return fileNotesService;
}
