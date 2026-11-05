import { ENGLISH_BOOK_NAMES, getBookName } from '@bible/core';
import type { FileEntry } from '../../services/fileNotesAPI';
import type { useI18n } from '../../contexts/useI18n';

type Localizer = ReturnType<typeof useI18n>['localizer'];

/**
 * The reader-facing name of a notes entry.
 *
 * Verse notes are stored as `Verse Notes/<Book>/<chapter>/<verse>.bn`, so the
 * bare file name is just "4". This returns "Psalm 23:4" (localized book name)
 * for those, and the plain entry name for everything else. Used wherever an
 * entry is named to the reader - the list row, the row's context menu and the
 * delete confirmation - so they never disagree.
 */
export function entryDisplayName(
  entry: FileEntry,
  verseNotesFolderPath: string | undefined,
  localizer: Localizer,
): string {
  if (entry.isDirectory) return entry.name;
  const parts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== verseNotesFolderPath) return entry.name;
  const [, bookFolder, chapter] = parts;
  const verse = parts[3].replace(/\.bn$/i, '');
  if (!/^\d+$/.test(chapter) || !/^\d+$/.test(verse)) return entry.name;
  const bookNumber =
    localizer.referenceParserConfig?.bookNames?.get(bookFolder.toLowerCase()) ??
    ENGLISH_BOOK_NAMES.get(bookFolder.toLowerCase());
  const bookName = bookNumber !== undefined
    ? (localizer.referenceParserConfig?.displayNames?.[bookNumber - 1] ?? getBookName(bookNumber))
    : bookFolder;
  return `${bookName} ${chapter}:${verse}`;
}
