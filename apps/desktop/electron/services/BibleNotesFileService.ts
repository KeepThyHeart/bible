import * as fs from 'fs';
import * as path from 'path';
import { app, shell } from 'electron';
import log from 'electron-log';
import { NOTES_BACKUP_INTERVAL_MS } from '../config/constants';

/**
 * .bn file envelope structure
 */
export interface BnFile {
  bn: number; // Format version
  type: 'annotation' | 'document' | 'sermon' | 'study' | 'outline' | 'verse_note';
  title: string;
  tags: string[];
  passages: Array<{
    start: number; // verse_id
    end: number;   // verse_id
    association: 'primary' | 'supporting' | 'reference';
  }>;
  created: string; // ISO 8601
  updated: string; // ISO 8601
  content: any;    // TipTap JSON document
  metadata: Record<string, any>;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  modified: string; // ISO 8601
  size?: number;
}

const BN_VERSION = 1;

/**
 * Thrown by {@link BibleNotesFileService.saveNote} / `saveNoteAbsolute` when the
 * on-disk note's `updated` timestamp no longer matches the `expectedUpdated` the
 * caller loaded - i.e. another window (or process) saved the same file since it
 * was opened. Signals the write was refused so the other writer's edits are not
 * silently clobbered; the caller decides whether to warn, merge, or force-write.
 */
export class NoteConflictError extends Error {
  readonly diskUpdated: string;
  readonly expectedUpdated: string;

  constructor(diskUpdated: string, expectedUpdated: string) {
    super('Note was modified in another window since it was opened');
    this.name = 'NoteConflictError';
    this.diskUpdated = diskUpdated;
    this.expectedUpdated = expectedUpdated;
  }
}

/**
 * Service for managing .bn (Bible Notes) files on the filesystem.
 * Handles read/write, .bak backup history, directory listing, and OS integration.
 */
export class BibleNotesFileService {
  private notesDir: string;

  constructor(notesDir?: string) {
    this.notesDir = notesDir || this.getDefaultNotesDir();
  }

  /** Get the default notes directory: ~/Documents/BibleReader/ */
  getDefaultNotesDir(): string {
    const documentsDir = app.getPath('documents');
    return path.join(documentsDir, 'BibleReader');
  }

  /** Get the currently configured notes directory */
  getNotesDir(): string {
    return this.notesDir;
  }

  /** Set the notes directory */
  setNotesDir(dir: string): void {
    this.notesDir = dir;
  }

  /** Ensure the notes directory exists */
  ensureNotesDir(): void {
    if (!fs.existsSync(this.notesDir)) {
      fs.mkdirSync(this.notesDir, { recursive: true });
    }
  }

  /** Ensure a subdirectory exists within the notes directory */
  ensureSubDir(relativePath: string): void {
    const fullPath = this.safeResolve(relativePath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  /**
   * Create a new .bn file with default envelope
   */
  createNote(
    relativePath: string,
    title: string,
    type: BnFile['type'] = 'document',
    content: any = null
  ): BnFile {
    const now = new Date().toISOString();
    const note: BnFile = {
      bn: BN_VERSION,
      type,
      title,
      tags: [],
      passages: [],
      created: now,
      updated: now,
      content: content || { type: 'doc', content: [{ type: 'paragraph' }] },
      metadata: {}
    };

    this.saveNote(relativePath, note);
    return note;
  }

  /**
   * Save a .bn file, creating a backup of the previous version first.
   *
   * @param expectedUpdated - When provided, the `updated` timestamp the caller
   *   last loaded. If the on-disk file's `updated` differs (another window saved
   *   in the meantime), a {@link NoteConflictError} is thrown instead of blindly
   *   overwriting. Pass `undefined` to force an unconditional overwrite.
   * @returns The `updated` timestamp actually written to disk. This method
   *   regenerates `note.updated` itself (the caller-supplied value is not
   *   trusted), so callers MUST use this return value - not their own
   *   pre-IPC guess - as the new conflict-detection baseline. Using a
   *   client-side guess here is exactly what caused a false "changed in
   *   another window" conflict on every save after the first.
   */
  saveNote(relativePath: string, note: BnFile, expectedUpdated?: string): string {
    const fullPath = this.resolveNotePath(relativePath);
    const dir = path.dirname(fullPath);

    // Ensure the directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Guard against clobbering a concurrent write from another window.
    this.assertNoConflict(fullPath, expectedUpdated);

    // Update the timestamp
    note.updated = new Date().toISOString();

    // Append current version to .bak file before overwriting
    if (fs.existsSync(fullPath)) {
      this.appendBackup(fullPath);
    }

    // Write the note atomically so an interrupted save never truncates the file
    this.atomicWrite(fullPath, JSON.stringify(note));

    return note.updated;
  }

  /**
   * Save a .bn file by absolute path (for Save As / files outside notes dir).
   *
   * @param expectedUpdated - See {@link saveNote}. Pass `undefined` to force an
   *   unconditional overwrite (the default for Save As to a new file).
   * @returns The `updated` timestamp actually written to disk. See {@link saveNote}.
   */
  saveNoteAbsolute(absolutePath: string, note: BnFile, expectedUpdated?: string): string {
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Guard against clobbering a concurrent write from another window.
    this.assertNoConflict(absolutePath, expectedUpdated);

    note.updated = new Date().toISOString();

    if (fs.existsSync(absolutePath)) {
      this.appendBackup(absolutePath);
    }

    // Write the note atomically so an interrupted save never truncates the file
    this.atomicWrite(absolutePath, JSON.stringify(note));

    return note.updated;
  }

  /**
   * Read a .bn file by relative path within the notes directory
   */
  readNote(relativePath: string): BnFile | null {
    const fullPath = this.resolveNotePath(relativePath);
    return this.readNoteAbsolute(fullPath);
  }

  /**
   * Read a .bn file by absolute path
   */
  readNoteAbsolute(absolutePath: string): BnFile | null {
    try {
      if (!fs.existsSync(absolutePath)) return null;
      const raw = fs.readFileSync(absolutePath, 'utf-8');
      return JSON.parse(raw) as BnFile;
    } catch (err) {
      log.error(`Failed to read .bn file at ${absolutePath}:`, err);
      return null;
    }
  }

  /**
   * List contents of a directory (relative to notes dir)
   * Returns folders first, then files, both sorted alphabetically
   */
  listDirectory(relativePath: string = ''): FileEntry[] {
    const fullPath = this.safeResolve(relativePath);
    if (!fs.existsSync(fullPath)) return [];

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      // Skip .bak files and hidden files
      if (entry.name.startsWith('.') || entry.name.endsWith('.bak')) continue;

      const entryPath = path.join(fullPath, entry.name);
      const stat = fs.statSync(entryPath);

      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: path.join(relativePath, entry.name),
          isDirectory: true,
          modified: stat.mtime.toISOString()
        });
      } else if (entry.name.endsWith('.bn')) {
        result.push({
          name: entry.name.replace(/\.bn$/, ''),
          path: path.join(relativePath, entry.name),
          isDirectory: false,
          modified: stat.mtime.toISOString(),
          size: stat.size
        });
      }
    }

    // Sort: directories first, then files, alphabetically within each group
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  /**
   * Create a new folder within the notes directory
   */
  createFolder(relativePath: string): void {
    const fullPath = this.safeResolve(relativePath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  /**
   * Rename a file or folder
   */
  rename(oldRelativePath: string, newRelativePath: string): void {
    const oldFull = this.safeResolve(oldRelativePath);
    const newFull = this.safeResolve(newRelativePath);

    if (!fs.existsSync(oldFull)) {
      throw new Error(`Path does not exist: ${oldRelativePath}`);
    }

    // Ensure parent of new path exists
    const newDir = path.dirname(newFull);
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }

    fs.renameSync(oldFull, newFull);

    // Also rename .bak file if it exists
    const oldBak = oldFull + '.bak';
    const newBak = newFull + '.bak';
    if (fs.existsSync(oldBak)) {
      fs.renameSync(oldBak, newBak);
    }
  }

  /**
   * Delete a file or folder, using the OS recycling bin where possible
   */
  async deleteEntry(relativePath: string): Promise<void> {
    const fullPath = this.safeResolve(relativePath);
    if (!fs.existsSync(fullPath)) return;

    try {
      // Try to move to trash (recycling bin)
      await shell.trashItem(fullPath);

      // Also trash the .bak file if it exists
      const bakPath = fullPath + '.bak';
      if (fs.existsSync(bakPath)) {
        await shell.trashItem(bakPath);
      }
    } catch (err) {
      // Fallback: permanent delete (should be rare)
      log.warn('Could not move to trash, falling back to permanent delete:', err);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  }

  /**
   * Open the notes directory (or a specific path) in the OS file manager
   */
  openInFileManager(relativePath: string = ''): void {
    const fullPath = this.safeResolve(relativePath);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        shell.openPath(fullPath);
      } else {
        // Show the file's containing folder with the file selected
        shell.showItemInFolder(fullPath);
      }
    } else {
      // Open the notes root
      shell.openPath(this.notesDir);
    }
  }

  /**
   * Check if the notes directory has been set up (exists and is accessible)
   */
  isInitialized(): boolean {
    return fs.existsSync(this.notesDir);
  }

  // --- Verse Notes ---

  static readonly VERSE_NOTES_FOLDER = 'Verse Notes';

  /** Ensure the Verse Notes folder exists */
  ensureVerseNotesFolder(): void {
    this.ensureSubDir(BibleNotesFileService.VERSE_NOTES_FOLDER);
  }

  /**
   * Get the relative path for a verse note file.
   * Structure: Verse Notes/BookName/Chapter/Verse.bn
   */
  getVerseNotePath(bookName: string, chapter: number, verse: number): string {
    return path.join(
      BibleNotesFileService.VERSE_NOTES_FOLDER,
      bookName,
      String(chapter),
      `${verse}.bn`
    );
  }

  /**
   * Create or open a verse note for a specific verse.
   * Creates the folder structure if needed.
   */
  createVerseNote(
    bookName: string,
    chapter: number,
    verse: number,
    verseId: number
  ): { note: BnFile; relativePath: string } {
    const relativePath = this.getVerseNotePath(bookName, chapter, verse);
    const fullPath = this.resolveNotePath(relativePath);

    // If note already exists, read and return it
    if (fs.existsSync(fullPath)) {
      const existing = this.readNoteAbsolute(fullPath);
      if (existing) return { note: existing, relativePath };
    }

    const title = `${bookName} ${chapter}:${verse}`;
    const note = this.createNote(relativePath, title, 'verse_note');
    note.passages = [{
      start: verseId,
      end: verseId,
      association: 'primary'
    }];
    this.saveNote(relativePath, note);
    return { note, relativePath };
  }

  /**
   * Read a verse note if it exists.
   */
  readVerseNote(
    bookName: string,
    chapter: number,
    verse: number
  ): { note: BnFile; relativePath: string } | null {
    const relativePath = this.getVerseNotePath(bookName, chapter, verse);
    const note = this.readNote(relativePath);
    if (!note) return null;
    return { note, relativePath };
  }

  /**
   * List books that have verse notes (subdirectories under Verse Notes/)
   */
  listVerseNoteBooks(): FileEntry[] {
    return this.listDirectory(BibleNotesFileService.VERSE_NOTES_FOLDER);
  }

  /**
   * List chapters for a book that have verse notes
   */
  listVerseNoteChapters(bookName: string): FileEntry[] {
    const relPath = path.join(BibleNotesFileService.VERSE_NOTES_FOLDER, bookName);
    return this.listDirectory(relPath);
  }

  /**
   * List verse notes in a chapter
   */
  listVerseNotesInChapter(bookName: string, chapter: number): FileEntry[] {
    const relPath = path.join(
      BibleNotesFileService.VERSE_NOTES_FOLDER,
      bookName,
      String(chapter)
    );
    return this.listDirectory(relPath);
  }

  /**
   * Check if a verse has a note file
   */
  hasVerseNote(bookName: string, chapter: number, verse: number): boolean {
    const relativePath = this.getVerseNotePath(bookName, chapter, verse);
    const fullPath = this.resolveNotePath(relativePath);
    return fs.existsSync(fullPath);
  }

  // --- Private helpers ---

  /**
   * Throw a {@link NoteConflictError} if the file at `fullPath` exists and its
   * on-disk `updated` timestamp differs from `expectedUpdated`. A no-op when
   * `expectedUpdated` is undefined (unconditional overwrite) or the file does
   * not yet exist (first write / Save As to a new path).
   */
  private assertNoConflict(fullPath: string, expectedUpdated: string | undefined): void {
    if (expectedUpdated === undefined) return;
    if (!fs.existsSync(fullPath)) return;

    const onDisk = this.readNoteAbsolute(fullPath);
    // If the file can't be parsed, don't block the save - atomic writes make a
    // truncated read unlikely, and refusing to save an unreadable file would
    // strand the user's edits.
    if (onDisk && onDisk.updated !== expectedUpdated) {
      throw new NoteConflictError(onDisk.updated, expectedUpdated);
    }
  }

  /**
   * Resolve a relative path to absolute within the notes directory.
   * Ensures .bn extension is present and validates against traversal.
   */
  private resolveNotePath(relativePath: string): string {
    if (!relativePath.endsWith('.bn')) {
      relativePath += '.bn';
    }
    return this.safeResolve(relativePath);
  }

  /**
   * Resolve a caller-supplied relative path to an absolute path, rejecting
   * anything that would escape the notes directory. The renderer is an
   * untrusted input boundary, so every relative path that flows into fs APIs
   * must pass through here.
   */
  private safeResolve(relativePath: string): string {
    if (typeof relativePath !== 'string') {
      throw new Error('Invalid path: must be a string');
    }
    if (relativePath.length > 1000) {
      throw new Error('Invalid path: too long');
    }
    if (relativePath.includes('\0')) {
      throw new Error('Invalid path: contains null byte');
    }
    if (path.isAbsolute(relativePath)) {
      throw new Error('Invalid path: absolute paths not allowed');
    }

    const base = path.resolve(this.notesDir);
    const resolved = path.resolve(base, relativePath);

    // Must be the notes dir itself or a descendant. Appending the separator
    // prevents "/notes-evil" from being accepted when base is "/notes".
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new Error('Invalid path: escapes notes directory');
    }
    return resolved;
  }

  /** Minimum interval between backup entries (15 minutes). Centralized in config/constants.ts. */
  private static readonly BACKUP_INTERVAL_MS = NOTES_BACKUP_INTERVAL_MS;

  /**
   * Append the current file content to its .bak file as a timestamped entry.
   * Format: each entry is a line with timestamp + tab + JSON content.
   * Skips if the last backup entry was less than 15 minutes ago.
   */
  private appendBackup(fullPath: string): void {
    try {
      const bakPath = fullPath + '.bak';

      // Check if last backup was recent enough to skip
      if (fs.existsSync(bakPath)) {
        const stat = fs.statSync(bakPath);
        const msSinceLastBackup = Date.now() - stat.mtimeMs;
        if (msSinceLastBackup < BibleNotesFileService.BACKUP_INTERVAL_MS) {
          return; // Too recent, skip this backup
        }
      }

      const currentContent = fs.readFileSync(fullPath, 'utf-8');
      const timestamp = new Date().toISOString();
      const backupEntry = `${timestamp}\t${currentContent}\n`;

      // Append atomically: read the existing history, concat the new entry, and
      // replace via a temp file + rename so an interrupted append can never
      // leave a half-written backup line that corrupts the whole .bak history.
      const existing = fs.existsSync(bakPath) ? fs.readFileSync(bakPath, 'utf-8') : '';
      this.atomicWrite(bakPath, existing + backupEntry);
    } catch (err) {
      log.error('Failed to create backup:', err);
      // Don't throw - backup failure should not prevent saving
    }
  }

  /**
   * Atomically write `data` to `fullPath`.
   *
   * Writes to a sibling `.tmp` file, fsyncs it to durable storage, then renames
   * it over the destination. `rename` is atomic on the same volume, so a reader
   * (or a crash) ever only observes either the previous complete file or the new
   * complete file - never a truncated/partial write. Callers keep their own
   * pre-write `.bak` history before invoking this.
   */
  private atomicWrite(fullPath: string, data: string): void {
    const tmpPath = fullPath + '.tmp';
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeFileSync(fd, data, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, fullPath);
  }
}
