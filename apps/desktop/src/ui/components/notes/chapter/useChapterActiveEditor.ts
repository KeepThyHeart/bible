/**
 * The single editor of chapter mode: one verse's note is open for editing, every other row is
 * read-only. State lives in refs (plus a render tick) rather than `useNoteEditorStore`, because
 * that store is one per window and two panes may share it.
 *
 * Saves follow `saveChapterNote`; a save of ours is never mistaken for someone else's because
 * the saver stores the returned `updated` before the same-window bus announces it (and our own
 * `origin` is skipped anyway). Conflicts pause autosave until settled.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import * as fileNotesAPI from '../../../services/fileNotesAPI';
import type { BnFile, VerseNoteRecord } from '../../../services/fileNotesAPI';
import { onLocalNoteSaved } from '../../../services/noteSavedLocal';
import { registerShutdownFlush } from '../../../services/activeNoteFlush';
import { useToastStore } from '../../../stores/useToastStore';
import { isSaveInFlight, saveConflictCopy, staleSaveKind } from '../UserNotesPane/hooks/noteSave';
import { saveChapterNote, type ChapterSaveDeps } from './chapterNoteSave';
import { parseVerseNotePath } from './verseNotePath';
import { buildDraftVerseNote, verseNoteRelativePath } from '../UserNotesPane/draftNote';

export const CHAPTER_AUTOSAVE_MS = 2000;

export interface ActiveVerseTarget {
  verseId: number;
  folderName: string;
  chapter: number;
  verse: number;
  record: VerseNoteRecord | null;
}

export interface ChapterActiveState {
  verseId: number;
  html: string;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  conflict: null | 'conflict';
  autoFocus: boolean;
}

export interface ChapterActiveEditor {
  active: ChapterActiveState | null;
  activate(t: ActiveVerseTarget, opts?: { focus?: boolean }): Promise<void>;
  deactivate(): Promise<void>;
  flush(): Promise<void>;
  setHtml(html: string): void;
  /** Adopt the editor's own reshaping of the document as the baseline, unless the user has edited. */
  normalize(html: string): void;
  resolveConflict(choice: 'overwrite' | 'reload'): Promise<void>;
  preserveSelectionFlag: { get(): boolean; clear(): void };
}

export interface ChapterActiveEditorDeps {
  save: ChapterSaveDeps;
  readVerseNote: typeof fileNotesAPI.readVerseNote;
  saveConflictCopy: (path: string, note: BnFile) => Promise<void>;
  getNotesDir: () => Promise<string>;
  onNoteSaved: typeof fileNotesAPI.onNoteSaved;
  onLocalNoteSaved: typeof onLocalNoteSaved;
  /** Called when text could not be saved on the way out. */
  notifyLeaveFailure: (kind: 'conflict-copy' | 'conflict-copy-failed' | 'missing' | 'failed', title: string) => void;
}

export interface UseChapterActiveEditorArgs {
  origin: string;
  deps?: Partial<ChapterActiveEditorDeps>;
  /** The record after a save, so the row and the filter update without another read. */
  onSaved?: (verse: number, record: VerseNoteRecord | null) => void;
}

interface Cur {
  target: ActiveVerseTarget;
  note: BnFile | null;
  relativePath: string | null;
  html: string;
  baseline: string;
  saving: boolean;
  loading: boolean;
  conflict: null | 'conflict';
  autoFocus: boolean;
}

/** The note a conflict copy is saved as: the loaded note, or a fresh verse note when the row was a draft. */
function conflictCopyNote(c: Cur): BnFile {
  const base = c.note
    ?? buildDraftVerseNote(c.target.folderName, c.target.chapter, c.target.verse, c.target.verseId).note;
  return { ...base, content: c.html };
}

function defaultNotify(kind: 'conflict-copy' | 'conflict-copy-failed' | 'missing' | 'failed', title: string): void {
  const msg =
    kind === 'conflict-copy' ? `"${title}" was changed elsewhere. Your last edits were saved as a separate note "(unsaved changes)".`
    : kind === 'missing' ? `"${title}" was renamed, moved or deleted, so your last edits were not saved.`
    : 'Failed to save note. Your changes may be lost.';
  useToastStore.getState().addToast(msg, 'error'); // allow-getstate: async error path - imperative toast dispatch outside render
}

const contentOf = (note: BnFile | null | undefined): string => (typeof note?.content === 'string' ? note.content : '');

export function useChapterActiveEditor({ origin, deps, onSaved }: UseChapterActiveEditorArgs): ChapterActiveEditor {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const curRef = useRef<Cur | null>(null);
  const seq = useRef(0);
  const preserve = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const notesDir = useRef<Promise<string | undefined> | null>(null);
  const unmounted = useRef(false);

  const depsRef = useRef({ origin, deps, onSaved });
  depsRef.current = { origin, deps, onSaved };
  const d = () => {
    const x = depsRef.current.deps;
    return {
      save: x?.save,
      readVerseNote: x?.readVerseNote ?? fileNotesAPI.readVerseNote,
      saveConflictCopy: x?.saveConflictCopy ?? saveConflictCopy,
      getNotesDir: x?.getNotesDir ?? fileNotesAPI.getNotesDir,
      onNoteSaved: x?.onNoteSaved ?? fileNotesAPI.onNoteSaved,
      onLocalNoteSaved: x?.onLocalNoteSaved ?? onLocalNoteSaved,
      notifyLeaveFailure: x?.notifyLeaveFailure ?? defaultNotify,
    };
  };

  const render = useCallback(() => { if (!unmounted.current) bump(); }, []);
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  const pathOf = (c: Cur): string =>
    c.relativePath ?? verseNoteRelativePath(c.target.folderName, c.target.chapter, c.target.verse);

  const recordOf = (c: Cur, note: BnFile, relativePath: string): VerseNoteRecord => ({
    bookName: c.target.folderName, chapter: c.target.chapter, verse: c.target.verse, relativePath, note,
  });

  // --- saving -------------------------------------------------------------

  const doSave = useCallback(async (): Promise<void> => {
    const c = curRef.current;
    if (!c || c.loading || c.conflict || c.html === c.baseline) return;
    const html = c.html;
    c.saving = true;
    render();
    try {
      const result = await saveChapterNote(
        { verseId: c.target.verseId, folderName: c.target.folderName, note: c.note, relativePath: c.relativePath, origin: depsRef.current.origin },
        html,
        d().save,
      );
      if (result) {
        c.note = result.note;
        c.relativePath = result.relativePath;
        c.baseline = html;
        depsRef.current.onSaved?.(c.target.verse, recordOf(c, result.note, result.relativePath));
      } else {
        // An empty draft: nothing written, nothing to save until it has content.
        c.baseline = html;
      }
    } catch (err) {
      const kind = staleSaveKind(err);
      if (kind === 'conflict') c.conflict = 'conflict';
      else if (kind === 'missing') {
        // The file is gone: the row becomes a draft, and the typed text is written
        // once as a new note. Only if that fails is the user told.
        c.note = null; c.relativePath = null;
        try {
          const again = await saveChapterNote(
            { verseId: c.target.verseId, folderName: c.target.folderName, note: null, relativePath: null, origin: depsRef.current.origin },
            html,
            d().save,
          );
          if (again) {
            c.note = again.note;
            c.relativePath = again.relativePath;
            c.baseline = html;
            depsRef.current.onSaved?.(c.target.verse, recordOf(c, again.note, again.relativePath));
          } else {
            c.baseline = html;
          }
        } catch (err2) {
          if (staleSaveKind(err2) === 'conflict') c.conflict = 'conflict';
          else {
            console.error('Chapter note re-save failed:', err2);
            d().notifyLeaveFailure('missing', c.note?.title ?? `${c.target.folderName} ${c.target.chapter}:${c.target.verse}`);
          }
        }
      }
      else console.error('Chapter note save failed:', err);
    } finally {
      c.saving = false;
      render();
    }
  }, [render]);

  const flush = useCallback((): Promise<void> => {
    clearTimer();
    saveChain.current = saveChain.current.then(doSave, doSave);
    return saveChain.current;
  }, [doSave]);

  const scheduleAutosave = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => { timer.current = null; void flush(); }, CHAPTER_AUTOSAVE_MS);
  }, [flush]);

  /** Save the open row; whatever still cannot be saved is kept as a conflict copy and reported. */
  const leave = useCallback(async (): Promise<void> => {
    const c = curRef.current;
    if (!c) return;
    await flush();
    if (c.html === c.baseline) return;
    const title = c.note?.title ?? `${c.target.folderName} ${c.target.chapter}:${c.target.verse}`;
    if (c.conflict) {
      try {
        await d().saveConflictCopy(pathOf(c), conflictCopyNote(c));
        d().notifyLeaveFailure('conflict-copy', title);
      } catch {
        d().notifyLeaveFailure('conflict-copy-failed', title);
      }
    } else {
      d().notifyLeaveFailure(c.note ? 'failed' : 'missing', title);
    }
  }, [flush]);

  // --- public actions -------------------------------------------------------

  const activate = useCallback(async (t: ActiveVerseTarget, opts?: { focus?: boolean }): Promise<void> => {
    const mine = ++seq.current;
    const prev = curRef.current;
    if (prev && prev.target.verseId === t.verseId) {
      if (opts?.focus) { prev.autoFocus = true; render(); }
      return;
    }
    await leave();
    if (mine !== seq.current) return;
    const focus = opts?.focus ?? false;
    const fresh: Cur = {
      target: t, note: null, relativePath: null, html: '', baseline: '',
      saving: false, loading: !t.record, conflict: null, autoFocus: focus,
    };
    if (t.record) {
      fresh.note = t.record.note;
      fresh.relativePath = t.record.relativePath;
      fresh.html = fresh.baseline = contentOf(t.record.note);
    }
    clearTimer();
    preserve.current = false;
    curRef.current = fresh;
    render();
    if (!t.record) {
      let found: Awaited<ReturnType<typeof fileNotesAPI.readVerseNote>> = null;
      try { found = await d().readVerseNote(t.folderName, t.chapter, t.verse); }
      catch (err) { console.error('Could not read the verse note:', err); }
      if (mine !== seq.current || curRef.current !== fresh) return;
      if (found) {
        fresh.note = found.note;
        fresh.relativePath = found.relativePath;
        fresh.html = fresh.baseline = contentOf(found.note);
      }
      fresh.loading = false;
      render();
    }
  }, [leave, render]);

  const deactivate = useCallback(async (): Promise<void> => {
    seq.current++;
    await leave();
    curRef.current = null;
    preserve.current = false;
    render();
  }, [leave, render]);

  const setHtml = useCallback((html: string) => {
    const c = curRef.current;
    if (!c || c.loading || html === c.html) return;
    c.html = html;
    preserve.current = false;
    if (html !== c.baseline && !c.conflict) scheduleAutosave();
    else if (html === c.baseline) clearTimer();
    render();
  }, [render, scheduleAutosave]);

  const normalize = useCallback((html: string) => {
    const c = curRef.current;
    if (!c || c.loading || c.html !== c.baseline) return; // the user has edited: keep it dirty
    if (html === c.html) return;
    c.html = c.baseline = html;
    render();
  }, [render]);

  const resolveConflict = useCallback(async (choice: 'overwrite' | 'reload'): Promise<void> => {
    const c = curRef.current;
    if (!c || !c.conflict) return;
    let found: Awaited<ReturnType<typeof fileNotesAPI.readVerseNote>> = null;
    try { found = await d().readVerseNote(c.target.folderName, c.target.chapter, c.target.verse); }
    catch (err) { console.error('Could not read the verse note:', err); return; }
    if (curRef.current !== c) return;
    if (found) { c.note = found.note; c.relativePath = found.relativePath; }
    else { c.note = null; c.relativePath = null; }
    c.conflict = null;
    if (choice === 'reload' && found) {
      const theirs = contentOf(found.note);
      preserve.current = false;
      c.html = c.baseline = theirs;
      render();
      return;
    }
    render();
    await flush();
  }, [flush, render]);

  // --- external saves -------------------------------------------------------

  useEffect(() => {
    const onExternal = async (path: string, updated: string, own: boolean): Promise<void> => {
      if (own) return;
      const c0 = curRef.current;
      if (!c0 || c0.loading) return;
      notesDir.current ??= d().getNotesDir().catch(() => undefined);
      const parsed = parseVerseNotePath(path, await notesDir.current);
      if (!parsed || parsed.folderName !== c0.target.folderName || parsed.chapter !== c0.target.chapter || parsed.verse !== c0.target.verse) return;
      const c = curRef.current;
      if (c !== c0) return;
      if (c.note && updated === c.note.updated) return; // already have it
      const settle = (): boolean => curRef.current !== c || seq.current !== mine;
      const mine = seq.current;
      const conflict = () => { c.conflict = 'conflict'; clearTimer(); render(); };
      if (c.saving || isSaveInFlight(pathOf(c))) { conflict(); return; }
      let found: Awaited<ReturnType<typeof fileNotesAPI.readVerseNote>>;
      try { found = await d().readVerseNote(c.target.folderName, c.target.chapter, c.target.verse); }
      catch { if (!settle() && c.html !== c.baseline) conflict(); return; }
      if (settle()) return;
      if (c.saving || isSaveInFlight(pathOf(c))) { conflict(); return; }
      const dirty = c.html !== c.baseline;
      if (!found) {
        // Deleted or moved elsewhere: back to a draft; any unsaved text stays dirty.
        c.note = null; c.relativePath = null; c.conflict = null;
        render();
        return;
      }
      const theirs = contentOf(found.note);
      if (dirty) {
        if (theirs === c.baseline) {
          if (!c.note || found.note.updated > c.note.updated) { c.note = { ...(c.note ?? found.note), updated: found.note.updated }; c.relativePath = found.relativePath; }
          return;
        }
        conflict();
        return;
      }
      if (c.note && found.note.updated <= c.note.updated) return;
      preserve.current = theirs !== c.html;
      c.note = found.note;
      c.relativePath = found.relativePath;
      c.html = c.baseline = theirs;
      c.conflict = null;
      render();
    };
    const offRemote = d().onNoteSaved(e => { void onExternal(e.absolutePath, e.updated, false); });
    const offLocal = d().onLocalNoteSaved(e => { void onExternal(e.path, e.updated, e.origin === depsRef.current.origin); });
    return () => { offRemote(); offLocal(); };
  }, [render]);

  // --- lifecycle: shutdown flush and unmount flush --------------------------------

  useEffect(() => {
    unmounted.current = false;
    // On quit a note still in conflict cannot be saved (autosave is paused), so keep
    // the text as a conflict copy next to the other version, without a toast.
    const shutdownFlush = async (): Promise<void> => {
      await flush();
      const c = curRef.current;
      if (c && c.conflict && c.html !== c.baseline) {
        await d().saveConflictCopy(pathOf(c), conflictCopyNote(c)).catch(() => undefined);
      }
    };
    const unregister = registerShutdownFlush(shutdownFlush);
    return () => {
      unregister();
      clearTimer();
      void leave();
      unmounted.current = true;
    };
  }, [flush, leave]);

  const preserveSelectionFlag = useMemo(() => ({
    get: () => preserve.current,
    clear: () => { preserve.current = false; },
  }), []);

  const c = curRef.current;
  const active: ChapterActiveState | null = c ? {
    verseId: c.target.verseId, html: c.html, dirty: c.html !== c.baseline, saving: c.saving,
    loading: c.loading, conflict: c.conflict, autoFocus: c.autoFocus,
  } : null;

  return { active, activate, deactivate, flush, setHtml, normalize, resolveConflict, preserveSelectionFlag };
}
