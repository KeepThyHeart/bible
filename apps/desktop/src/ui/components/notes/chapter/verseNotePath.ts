/**
 * Recognise `Verse Notes/<Book>/<chapter>/<verse>.bn` paths in any spelling the
 * save events use: relative or absolute, forward or back slashes.
 */
import { VERSE_NOTES_FOLDER } from '../UserNotesPane/utils';

export interface ParsedVerseNotePath {
  folderName: string;
  chapter: number;
  verse: number;
}

const slashed = (p: string): string => p.replace(/\\/g, '/');
const SHAPE = /^Verse Notes\/([^/]+)\/(\d+)\/(\d+)\.bn$/;

/**
 * @param notesDir - the notes folder; an absolute path inside it is made relative to it.
 *   Without it, the path is read from its last `Verse Notes/` segment.
 */
export function parseVerseNotePath(path: string, notesDir?: string): ParsedVerseNotePath | null {
  let p = slashed(path);
  if (notesDir) {
    const dir = slashed(notesDir).replace(/\/+$/, '');
    const win = /^[A-Za-z]:/.test(dir);
    const starts = win ? p.toLowerCase().startsWith(dir.toLowerCase() + '/') : p.startsWith(dir + '/');
    if (starts) p = p.slice(dir.length + 1);
  }
  if (!SHAPE.test(p)) {
    const marker = `/${VERSE_NOTES_FOLDER}/`;
    const at = p.lastIndexOf(marker);
    if (at < 0) return null;
    p = p.slice(at + 1);
  }
  const m = SHAPE.exec(p);
  if (!m) return null;
  return { folderName: m[1], chapter: Number(m[2]), verse: Number(m[3]) };
}
