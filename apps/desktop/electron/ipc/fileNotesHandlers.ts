import { dialog, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { BibleNotesFileService, BnFile, NoteConflictError } from '../services/BibleNotesFileService';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { blessPath, isPathBlessed, isPathWithin } from './blessedPaths';
import { t } from '../services/MainI18n';

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
  ipcHandler<[string, BnFile, string | undefined], string>(
    'file-notes:save-note',
    (relativePath, note, expectedUpdated) => {
      try {
        return getService().saveNote(relativePath, note, expectedUpdated);
      } catch (err) {
        throw toConflictError(err);
      }
    }
  );

  ipcHandler<[string, BnFile, string | undefined], string>(
    'file-notes:save-note-absolute',
    (absolutePath, note, expectedUpdated) => {
      assertAbsolutePathAllowed(absolutePath);
      try {
        return getService().saveNoteAbsolute(absolutePath, note, expectedUpdated);
      } catch (err) {
        throw toConflictError(err);
      }
    }
  );

  // --- Folder / file management ------------------------------------------

  ipcHandler<[string], void>('file-notes:create-folder', (relativePath) => {
    getService().createFolder(relativePath);
  });

  ipcHandler<[string, string], void>('file-notes:rename', (oldPath, newPath) => {
    getService().rename(oldPath, newPath);
  });

  ipcHandler<[string], void>('file-notes:delete', async (relativePath) => {
    await getService().deleteEntry(relativePath);
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
  ipcHandler<[string, string], void>(
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
        return;
      }

      const fs = await import('fs');
      fs.writeFileSync(result.filePath, markdownContent, 'utf-8');
    }
  );

  // Export note as DOCX - converts HTML to DOCX and saves via dialog.
  ipcHandler<[string, string, string], void>(
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
        return;
      }

      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');
      const fs = await import('fs');

      // Parse HTML into DOCX paragraphs
      const paragraphs = htmlToDocxParagraphs(htmlContent, noteTitle, { Document, Paragraph, TextRun, HeadingLevel, AlignmentType });

      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs
        }]
      });

      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(result.filePath, buffer);
    }
  );
}

/**
 * Convert HTML content to docx Paragraph objects.
 * Lightweight parser - handles common TipTap output tags.
 */
function htmlToDocxParagraphs(html: string, title: string, docx: any): any[] {
  const { Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;
  const paragraphs: any[] = [];

  // Add title
  paragraphs.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    children: [new TextRun({ text: title, bold: true })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 }
  }));

  // Simple HTML parser using regex - handles p, h1-h3, li, blockquote, hr
  const blockPattern = /<(h[1-3]|p|li|blockquote|hr)\b[^>]*>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let blockMatch: RegExpExecArray | null;

  // If no block tags found, treat entire content as one paragraph
  const hasBlocks = blockPattern.test(html);
  blockPattern.lastIndex = 0;

  if (!hasBlocks) {
    const text = html.replace(/<[^>]+>/g, '').trim();
    if (text) {
      paragraphs.push(new Paragraph({ children: parseInlineRuns(text, TextRun) }));
    }
    return paragraphs;
  }

  while ((blockMatch = blockPattern.exec(html)) !== null) {
    const tag = (blockMatch[1] || 'hr').toLowerCase();
    const inner = blockMatch[2] || '';

    if (tag === 'hr') {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: '───────────────────────────' })],
        spacing: { before: 100, after: 100 }
      }));
      continue;
    }

    const plainText = inner.replace(/<[^>]+>/g, '').trim();
    if (!plainText && tag !== 'hr') continue;

    const runs = parseInlineRuns(inner, TextRun);

    switch (tag) {
      case 'h1':
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs }));
        break;
      case 'h2':
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs }));
        break;
      case 'h3':
        paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs }));
        break;
      case 'blockquote':
        // Parse inner paragraphs within blockquote
        const bqInner = inner.replace(/<\/?blockquote[^>]*>/g, '');
        const bqParas = bqInner.split(/<\/?p[^>]*>/g).filter((s: string) => s.trim());
        for (const bp of bqParas) {
          const bpText = bp.replace(/<[^>]+>/g, '').trim();
          if (bpText) {
            paragraphs.push(new Paragraph({
              children: [new TextRun({ text: bpText, italics: true })],
              indent: { left: 720 },
              spacing: { before: 40, after: 40 }
            }));
          }
        }
        break;
      case 'li':
        paragraphs.push(new Paragraph({
          children: runs,
          bullet: { level: 0 }
        }));
        break;
      default:
        paragraphs.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
    }
  }

  return paragraphs;
}

/**
 * Parse inline HTML (bold, italic, underline, sup) into TextRun objects
 */
function parseInlineRuns(html: string, TextRun: any): any[] {
  const runs: any[] = [];

  // Simple approach: split by tags, track formatting state
  const tagPattern = /<(\/?)(?:strong|b|em|i|u|s|del|sup|sub)\b[^>]*>|([^<]+)/gi;
  let match: RegExpExecArray | null;
  let bold = false, italic = false, underline = false, strike = false, superscript = false;

  while ((match = tagPattern.exec(html)) !== null) {
    if (match[2]) {
      // Text node
      const text = match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
      if (text.trim() || text === ' ') {
        runs.push(new TextRun({
          text,
          bold,
          italics: italic,
          underline: underline ? {} : undefined,
          strike,
          superScript: superscript
        }));
      }
    } else {
      // Tag
      const isClosing = match[1] === '/';
      const tagFull = match[0].toLowerCase();
      if (tagFull.includes('strong') || tagFull.includes('<b>') || tagFull.includes('</b>')) bold = !isClosing;
      if (tagFull.includes('em') || tagFull.includes('<i>') || tagFull.includes('</i>')) italic = !isClosing;
      if (tagFull.includes('<u') || tagFull.includes('</u>')) underline = !isClosing;
      if (tagFull.includes('<s') || tagFull.includes('del')) strike = !isClosing;
      if (tagFull.includes('sup')) superscript = !isClosing;
    }
  }

  if (runs.length === 0) {
    const text = html.replace(/<[^>]+>/g, '').trim();
    if (text) {
      runs.push(new TextRun({ text }));
    }
  }

  return runs;
}

/**
 * Get the file notes service instance (for use by other handlers)
 */
export function getFileNotesService(): BibleNotesFileService | null {
  return fileNotesService;
}
