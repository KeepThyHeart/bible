/**
 * Loads one chapter for chapter mode: its verses (in the chosen translation) plus the
 * verse notes with content, from ONE bulk read, and keeps the read-only rows in step with
 * saves made elsewhere (another window, another pane of this window, a delete/rename).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as fileNotesAPI from '../../../services/fileNotesAPI';
import type { VerseNoteRecord } from '../../../services/fileNotesAPI';
import { onLocalNoteSaved } from '../../../services/noteSavedLocal';
import { onVerseNotesChanged } from '../../../services/verseNoteMarkerEvents';
import { getVersesCached } from '../../../services/verseFetchCache';
import { bibleAPI } from '../../../services/electronAPI';
import { useBibleStore } from '../../../stores/useBibleStore';
import { getMainActiveTranslation } from '../../../utils/mainActiveTranslation';
import { calculateVerseId, getBookNameFromCache, loadBookNamesCache } from '../../../utils/verseReference';
import { noteHasContent } from '../../../../../electron/utils/noteHasContent';
import { parseVerseNotePath } from './verseNotePath';

export interface ChapterRow {
  verseId: number;
  verse: number;
  verseHtml: string;
  record: VerseNoteRecord | null;
}

export type ChapterNotesStatus = 'loading' | 'ready' | 'error' | 'no-translation';

export interface UseChapterNotesArgs {
  book: number;
  chapter: number;
  /** An abbreviation; undefined follows the Bible pane (or the main window's, in a pop-out). */
  translation?: string;
  /** This pane's save origin; its own local events are skipped. */
  origin: string;
}

export interface UseChapterNotesResult {
  status: ChapterNotesStatus;
  rows: ChapterRow[];
  folderName: string;
  /** The translation actually used ('' when none). */
  translation: string;
  moduleId: number;
  /** Replace one verse's record (null clears it); used after the active editor saved. */
  setRecord: (verse: number, record: VerseNoteRecord | null) => void;
  reload: () => void;
}

const EMPTY: never[] = [];

export function useChapterNotes({ book, chapter, translation, origin }: UseChapterNotesArgs): UseChapterNotesResult {
  const availableBibles = useBibleStore(s => s.availableBibles) ?? EMPTY;
  const loadAvailableBibles = useBibleStore(s => s.loadAvailableBibles);
  useEffect(() => {
    if (availableBibles.length === 0) void loadAvailableBibles?.();
  }, [availableBibles.length, loadAvailableBibles]);

  const resolved = translation || getMainActiveTranslation() || availableBibles[0]?.abbreviation || '';
  const moduleId = availableBibles.find(b => b.abbreviation === resolved)?.module_id ?? 0;

  const [status, setStatus] = useState<ChapterNotesStatus>('loading');
  const [rows, setRows] = useState<ChapterRow[]>([]);
  const [folderName, setFolderName] = useState('');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(n => n + 1), []);

  // The load that is current; older answers are dropped.
  const token = useRef(0);
  const live = useRef({ folderName: '', chapter, ready: false });
  const notesDir = useRef<Promise<string | undefined> | null>(null);
  const keyRef = useRef('');

  const toRecord = useCallback((verse: number, found: { note: VerseNoteRecord['note']; relativePath: string } | null): VerseNoteRecord | null => {
    if (!found || !noteHasContent(found.note.content)) return null;
    return { bookName: live.current.folderName, chapter: live.current.chapter, verse, relativePath: found.relativePath, note: found.note };
  }, []);

  useEffect(() => {
    const mine = ++token.current;
    const key = `${book}:${chapter}:${resolved}`;
    const sameChapter = keyRef.current === key;
    keyRef.current = key;
    live.current.ready = false;
    if (!sameChapter) {
      setStatus('loading');
      setRows([]);
    }
    if (!resolved) {
      setStatus('no-translation');
      return;
    }
    void (async () => {
      try {
        await loadBookNamesCache(bibleAPI);
        const name = getBookNameFromCache(book);
        const [verses, records] = await Promise.all([
          getVersesCached(resolved, calculateVerseId(book, chapter, 1), calculateVerseId(book, chapter, 999)),
          fileNotesAPI.readVerseNotes([{ bookName: name, chapter }]),
        ]);
        if (mine !== token.current) return;
        const byVerse = new Map(records.map(r => [r.verse, r]));
        live.current = { folderName: name, chapter, ready: true };
        setFolderName(name);
        setRows(verses.filter(v => v.verse >= 1).map(v => ({
          verseId: v.verse_id,
          verse: v.verse,
          verseHtml: v.text_html || v.text,
          record: byVerse.get(v.verse) ?? null,
        })));
        setStatus('ready');
      } catch (err) {
        if (mine !== token.current) return;
        console.error('Chapter notes failed to load:', err);
        setStatus('error');
      }
    })();
  }, [book, chapter, resolved, tick]);

  const setRecord = useCallback((verse: number, record: VerseNoteRecord | null) => {
    setRows(prev => prev.map(r => (r.verse === verse ? { ...r, record: record && noteHasContent(record.note.content) ? record : null } : r)));
  }, []);

  // Saves elsewhere refresh only the matching row; a delete/rename re-reads the whole chapter.
  useEffect(() => {
    const refreshVerse = async (verse: number, updated?: string): Promise<void> => {
      const mine = token.current;
      const { folderName: name, chapter: ch, ready } = live.current;
      if (!ready) return;
      try {
        const found = await fileNotesAPI.readVerseNote(name, ch, verse);
        if (mine !== token.current || live.current.chapter !== ch) return;
        const record = toRecord(verse, found);
        setRows(prev => prev.map(r => {
          if (r.verse !== verse) return r;
          if (updated && r.record && record && record.note.updated <= r.record.note.updated) return r;
          return { ...r, record };
        }));
      } catch (err) {
        console.error('Could not refresh a verse note:', err);
      }
    };
    const matches = (path: string, dir: string | undefined): number | null => {
      const p = parseVerseNotePath(path, dir);
      if (!p || !live.current.ready) return null;
      return p.folderName === live.current.folderName && p.chapter === live.current.chapter ? p.verse : null;
    };
    const offRemote = fileNotesAPI.onNoteSaved(e => {
      void (async () => {
        notesDir.current ??= fileNotesAPI.getNotesDir().catch(() => undefined);
        const verse = matches(e.absolutePath, await notesDir.current);
        if (verse !== null) await refreshVerse(verse, e.updated);
      })();
    });
    const offLocal = onLocalNoteSaved(e => {
      if (e.origin === origin) return;
      void (async () => {
        notesDir.current ??= fileNotesAPI.getNotesDir().catch(() => undefined);
        const verse = matches(e.path, await notesDir.current);
        if (verse !== null) await refreshVerse(verse, e.updated);
      })();
    });
    const offChanged = onVerseNotesChanged(() => {
      const mine = token.current;
      const { folderName: name, chapter: ch, ready } = live.current;
      if (!ready) return;
      void fileNotesAPI.readVerseNotes([{ bookName: name, chapter: ch }]).then(records => {
        if (mine !== token.current) return;
        const byVerse = new Map(records.map(r => [r.verse, r]));
        setRows(prev => prev.map(r => ({ ...r, record: byVerse.get(r.verse) ?? null })));
      }, err => console.error('Could not refresh the chapter notes:', err));
    });
    return () => { offRemote(); offLocal(); offChanged(); };
  }, [origin, toRecord]);

  return { status, rows, folderName, translation: resolved, moduleId, setRecord, reload };
}
