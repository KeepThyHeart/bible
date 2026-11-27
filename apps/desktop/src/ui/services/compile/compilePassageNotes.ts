/**
 * Compile the verse notes of a list of passages into one HTML document:
 * passage headings, the verse text (optional), and each verse's note.
 *
 * Pure and injectable: verses, note reads and book names come in through
 * `CompileDeps`. Types for the bulk note read are local and structural so this
 * file does not depend on the IPC layer.
 */
import { sanitizeHtml } from '../../utils/sanitize';
import { buildInsertHtml, loadInsertOptions } from '../verseExpansionService';
import type { CachedVerse } from '../verseFetchCache';
import type { PassageSpec } from './parsePassageList';

export const MAX_COMPILE_VERSES = 2000;

export interface CompileOptions {
  canonicalOrder: boolean;
  includeVerseText: boolean;
  translation: string;
  redLetters: boolean;
  /** `text-only` is treated as `skip` when verse text is off. */
  versesWithoutNotes: 'skip' | 'blank-space' | 'text-only';
  blankLines: number;
  passageHeadings: boolean;
  showTranslation: boolean;
  verseLabel: 'reference' | 'number' | 'none';
}

/** Structural twin of the IPC `VerseNoteQuery`. */
export interface CompileNoteQuery {
  bookName: string;
  chapter: number;
  fromVerse?: number;
  toVerse?: number;
}

export interface CompileDeps {
  getVerses(tr: string, startId: number, endId: number): Promise<CachedVerse[]>;
  readVerseNotes(
    q: CompileNoteQuery[],
  ): Promise<Array<{ bookName: string; chapter: number; verse: number; note: { content: unknown } }>>;
  /** Folder name of a book under `Verse Notes`. */
  folderName(book: number): string;
  /** Localized book name, for labels. */
  bookName(book: number): string;
}

export type CompileResult =
  | { ok: true; html: string; verseCount: number; noteCount: number; emptyPassages: string[] }
  | { ok: false; reason: 'empty' | 'too-many-verses' | 'not-found' | 'no-notes'; verseCount?: number };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function noteKey(bookName: string, chapter: number, verse: number): string {
  return `${bookName}\u0000${chapter}\u0000${verse}`;
}

function noteHtml(content: unknown): string | null {
  if (typeof content !== 'string' || content.trim() === '') return null;
  const clean = sanitizeHtml(content);
  return clean.trim() === '' ? null : clean;
}

export async function compilePassageNotes(
  passages: PassageSpec[],
  o: CompileOptions,
  d: CompileDeps,
): Promise<CompileResult> {
  if (passages.length === 0) return { ok: false, reason: 'empty' };

  const tr = o.translation;
  const fetched: CachedVerse[][] = [];
  let verseCount = 0;
  for (const p of passages) {
    // Verse 0 carries legacy chapter prefaces; they never have notes.
    const verses = (await d.getVerses(tr, p.startId, p.endId)).filter((v) => v.verse > 0);
    fetched.push(verses);
    verseCount += verses.length;
    // Stop fetching further passages once the total is already over the limit.
    if (verseCount > MAX_COMPILE_VERSES) return { ok: false, reason: 'too-many-verses', verseCount };
  }
  if (verseCount === 0) return { ok: false, reason: 'not-found', verseCount: 0 };
  if (verseCount > MAX_COMPILE_VERSES) return { ok: false, reason: 'too-many-verses', verseCount };

  // One query per (book, chapter) per passage, with that passage's verse span in the chapter.
  const queries: CompileNoteQuery[] = [];
  const seenQueries = new Set<string>();
  for (const verses of fetched) {
    const spans = new Map<string, { book: number; chapter: number; from: number; to: number }>();
    for (const v of verses) {
      const key = `${v.book_number}:${v.chapter}`;
      const s = spans.get(key);
      if (s) {
        s.from = Math.min(s.from, v.verse);
        s.to = Math.max(s.to, v.verse);
      } else {
        spans.set(key, { book: v.book_number, chapter: v.chapter, from: v.verse, to: v.verse });
      }
    }
    for (const s of spans.values()) {
      const q: CompileNoteQuery = {
        bookName: d.folderName(s.book),
        chapter: s.chapter,
        fromVerse: s.from,
        toVerse: s.to,
      };
      const id = `${q.bookName}|${q.chapter}|${q.fromVerse}|${q.toVerse}`;
      if (seenQueries.has(id)) continue;
      seenQueries.add(id);
      queries.push(q);
    }
  }
  const records = await d.readVerseNotes(queries);
  const notes = new Map<string, string>();
  for (const r of records) {
    const html = noteHtml(r.note?.content);
    if (html !== null) notes.set(noteKey(r.bookName, r.chapter, r.verse), html);
  }

  const withText = o.includeVerseText;
  const mode = o.versesWithoutNotes === 'text-only' && !withText ? 'skip' : o.versesWithoutNotes;
  const insertOptions = {
    ...loadInsertOptions('blockquote'),
    displayVersionNumber: false,
    wordsOfChristInRed: o.redLetters,
    referencePosition: o.verseLabel === 'reference' ? 'before' : 'none',
    verseNumbers: o.verseLabel === 'number' ? 'parenthetical' : 'none',
    commentPlaceholders: false,
  } as Parameters<typeof buildInsertHtml>[3];

  const out: string[] = [];
  const emptyPassages: string[] = [];
  let noteCount = 0;

  passages.forEach((p, i) => {
    const parts: string[] = [];
    for (const v of fetched[i]) {
      const note = notes.get(noteKey(d.folderName(v.book_number), v.chapter, v.verse)) ?? null;
      if (note === null && mode === 'skip') continue;
      if (withText) {
        parts.push(buildInsertHtml([v], tr, 'blockquote', insertOptions));
      } else if (o.verseLabel !== 'none') {
        const label =
          o.verseLabel === 'reference' ? `${d.bookName(v.book_number)} ${v.chapter}:${v.verse}` : `${v.chapter}:${v.verse}`;
        parts.push(`<h3>${esc(label)}</h3>`);
      }
      if (note !== null) {
        parts.push(note);
        noteCount++;
      } else if (mode === 'blank-space') {
        for (let n = 0; n < o.blankLines; n++) parts.push('<p>&nbsp;</p>');
      }
    }
    if (parts.length === 0) {
      emptyPassages.push(p.label);
      return;
    }
    if (o.passageHeadings) {
      out.push(`<h2>${esc(p.label)}${o.showTranslation && tr ? ` (${esc(tr)})` : ''}</h2>`);
    }
    out.push(...parts);
  });

  if (out.length === 0) return { ok: false, reason: 'no-notes', verseCount };
  return { ok: true, html: out.join(''), verseCount, noteCount, emptyPassages };
}
