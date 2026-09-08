// Shared utilities for UserNotesPane sub-modules.

export const VERSE_NOTES_FOLDER = 'Verse Notes';

// Escape a user-supplied string for safe interpolation as text inside HTML.
// Used for <title> and <h1> in the print document where DOMPurify isn't applied.
export function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// True when a path is absolute (Windows drive letter or POSIX root).
export function isAbsolutePath(p: string): boolean {
  return p.includes(':') || p.startsWith('/');
}

// True when the given relative path is the Verse Notes folder or inside it.
export function isInVerseNotesFolderPath(currentPath: string): boolean {
  return (
    currentPath === VERSE_NOTES_FOLDER ||
    currentPath.startsWith(VERSE_NOTES_FOLDER + '/') ||
    currentPath.startsWith(VERSE_NOTES_FOLDER + '\\')
  );
}
