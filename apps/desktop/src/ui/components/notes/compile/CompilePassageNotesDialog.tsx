/**
 * "Compile passage notes": turns a list of passages into one document made of
 * the verse notes written for them (plus optional verse text), then creates a
 * note from it or prints / exports it without creating one.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../contexts/useI18n';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { PopupPortal } from '../../../hooks/usePopupPosition';
import { useBibleStore } from '../../../stores/useBibleStore';
import { useFileNotesStore } from '../../../stores/useFileNotesStore';
import { useToastStore } from '../../../stores/useToastStore';
import * as fileNotesAPI from '../../../services/fileNotesAPI';
import { getVersesCached } from '../../../services/verseFetchCache';
import { getActiveTranslation } from '../../../services/verseExpansionService';
import { getBookNameFromCache } from '../../../utils/verseReference';
import { getLocalizedReferenceParser } from '../../../services/localizedReferenceParser';
import { parsePassageList, type PassageSpec } from '../../../services/compile/parsePassageList';
import {
  compilePassageNotes,
  type CompileDeps,
  type CompileOptions,
  type CompileResult,
} from '../../../services/compile/compilePassageNotes';
import {
  loadCompileOptions,
  saveCompileOptions,
  loadCompileFolder,
  saveCompileFolder,
} from '../../../services/compile/compileOptionsStorage';
import { buildNoteDocumentHtml, exportFileName } from '../../../services/noteDocument';
import { useMoveDialogFolders } from '../UserNotesPane/hooks/useMoveDialogFolders';
import { isInVerseNotesFolderPath } from '../UserNotesPane/utils';
import { buildNoteTemplates } from '../NewNoteDialog';
import NoteViewer from '../editor/NoteViewer';

const PREVIEW_DEBOUNCE_MS = 300;
const TITLE_MAX = 80;
const EMPTY_BIBLES: Array<{ abbreviation: string; name: string }> = [];

export interface CompilePassageNotesDialogProps {
  open: boolean;
  initialReference?: string;
  initialOptions?: Partial<CompileOptions>;
  onClose: () => void;
  onCreated: (path: string) => void;
}

/** Unique `.bn`-less file name in `folder`: `Name`, `Name (2)`, `Name (3)`... */
export async function uniqueNoteName(folder: string, base: string): Promise<string> {
  let taken = new Set<string>();
  try {
    const entries = await fileNotesAPI.listDirectory(folder);
    taken = new Set(entries.filter((e) => !e.isDirectory).map((e) => e.name.replace(/\.bn$/i, '').toLowerCase()));
  } catch {
    // A folder that cannot be listed is treated as empty; createNote will report a real problem.
  }
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

const secondaryBtn =
  'px-lg py-sm text-sm border border-border rounded hover:bg-background-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const CompilePassageNotesDialog: React.FC<CompilePassageNotesDialogProps> = ({
  open,
  initialReference,
  initialOptions,
  onClose,
  onCreated,
}) => {
  const { t, localizer } = useI18n();
  const dialogRef = useFocusTrap<HTMLDivElement>(open, onClose);

  const availableBibles = useBibleStore((s) => s.availableBibles) ?? EMPTY_BIBLES;
  const loadAvailableBibles = useBibleStore((s) => s.loadAvailableBibles);

  const [text, setText] = useState('');
  const [options, setOptions] = useState<CompileOptions>(() => loadCompileOptions());
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [folder, setFolder] = useState('');
  const [templateId, setTemplateId] = useState('blank');
  const [result, setResult] = useState<CompileResult | null>(null);
  const [unrecognized, setUnrecognized] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [compiling, setCompiling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  const allFolders = useMoveDialogFolders(open);
  const folders = useMemo(
    () => allFolders.filter((f) => f === '' || !isInVerseNotesFolderPath(f)),
    [allFolders],
  );
  const templates = useMemo(() => buildNoteTemplates(t, localizer, title), [t, localizer, title]);

  // Reset on every open.
  useEffect(() => {
    if (!open) return;
    setText(initialReference ?? '');
    setOptions({ ...loadCompileOptions(), ...(initialOptions ?? {}) });
    setTitle('');
    setTitleEdited(false);
    setFolder(loadCompileFolder());
    setTemplateId('blank');
    setResult(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && availableBibles.length === 0) void loadAvailableBibles?.();
  }, [open, availableBibles.length, loadAvailableBibles]);

  // The folder remembered last time may be gone.
  useEffect(() => {
    if (folders.length > 1 && !folders.includes(folder)) setFolder('');
  }, [folders, folder]);

  // The translation actually used: the chosen one, else the Bible pane's, else the first installed.
  const effectiveTranslation = useMemo(() => {
    const pick = (name: string) => availableBibles.find((b) => b.abbreviation.toLowerCase() === name.toLowerCase());
    if (options.translation) return pick(options.translation)?.abbreviation ?? options.translation;
    const active = getActiveTranslation();
    return (active && pick(active)?.abbreviation) || active || availableBibles[0]?.abbreviation || '';
  }, [options.translation, availableBibles]);

  // Recompile after the last change (stale-guarded).
  useEffect(() => {
    if (!open) return;
    const mine = ++token.current;
    setCompiling(true);
    const timer = setTimeout(() => {
      void (async () => {
        let specs: PassageSpec[] = [];
        let unrec: string[] = [];
        try {
          const parsed = parsePassageList(text, { canonical: options.canonicalOrder });
          specs = parsed.passages;
          unrec = parsed.unrecognized;
        } catch {
          // fall through with nothing parsed
        }
        const parser = getLocalizedReferenceParser();
        const deps: CompileDeps = {
          getVerses: (tr, a, b) => getVersesCached(tr, a, b),
          readVerseNotes: (q) => fileNotesAPI.readVerseNotes(q),
          folderName: (book) => getBookNameFromCache(book),
          bookName: (book) => parser.getBookName(book),
        };
        let res: CompileResult;
        try {
          res = await compilePassageNotes(specs, { ...options, translation: effectiveTranslation }, deps);
        } catch {
          res = { ok: false, reason: 'not-found' };
        }
        if (mine !== token.current) return;
        setUnrecognized(unrec);
        setLabels(specs.map((s) => s.label));
        setResult(res);
        setCompiling(false);
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, text, options, effectiveTranslation]);

  // Default title until the user edits it.
  useEffect(() => {
    if (titleEdited) return;
    setTitle(labels.join('; ').slice(0, TITLE_MAX));
  }, [labels, titleEdited]);

  const update = useCallback(<K extends keyof CompileOptions>(key: K, value: CompileOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const ok = result?.ok === true;
  const html = result && result.ok ? result.html : '';
  const effectiveTitle = title.trim() || t('compileNotes.defaultTitle');
  const actionsDisabled = !ok || busy || compiling;

  const statusText = (() => {
    if (compiling && !result) return t('compileNotes.status.working');
    if (!result) return '';
    if (result.ok) {
      return t('compileNotes.status.ok', {
        v1: labels.length,
        v2: result.verseCount,
        v3: result.noteCount,
      });
    }
    switch (result.reason) {
      case 'empty':
        return t('compileNotes.status.empty');
      case 'too-many-verses':
        return t('compileNotes.status.tooMany', { v1: result.verseCount ?? 0 });
      case 'not-found':
        return t('compileNotes.status.notFound');
      default:
        return t('compileNotes.status.noNotes');
    }
  })();

  const rememberChoices = () => {
    saveCompileOptions(options);
    saveCompileFolder(folder);
  };

  const handleCreate = async () => {
    if (!result || !result.ok) return;
    setBusy(true);
    setError(null);
    try {
      rememberChoices();
      const base = exportFileName(effectiveTitle);
      const name = await uniqueNoteName(folder, base);
      const relativePath = folder ? `${folder}/${name}` : name;
      const notePath = `${relativePath}.bn`;
      const tpl = templates.find((x) => x.id === templateId) ?? templates[0];
      const note = await fileNotesAPI.createNote(relativePath, effectiveTitle, 'study');
      const saved = { ...note, content: (tpl?.content ?? '') + result.html };
      saved.updated = await fileNotesAPI.saveNote(notePath, saved);
      useFileNotesStore.getState().addRecentFile(notePath, effectiveTitle); // allow-getstate: async create callback - imperative store update outside render
      onCreated(notePath);
      onClose();
    } catch (err: unknown) {
      setError(t('compileNotes.error.create', { v1: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const runExport = async (kind: 'print' | 'pdf' | 'docx') => {
    if (!result || !result.ok) return;
    setBusy(true);
    setError(null);
    try {
      rememberChoices();
      let failure: string | undefined;
      if (kind === 'docx') {
        const savedTo = await fileNotesAPI.exportNoteDocx(exportFileName(effectiveTitle), result.html, effectiveTitle);
        if (savedTo) useToastStore.getState().addToast(t('compileNotes.exported', { v1: savedTo }), 'info'); // allow-getstate: async export callback - imperative toast outside render
      } else {
        const doc = buildNoteDocumentHtml(effectiveTitle, result.html);
        const res =
          kind === 'print'
            ? await fileNotesAPI.printNote(doc)
            : await fileNotesAPI.exportNotePdf(doc, exportFileName(effectiveTitle));
        if (res && !res.success && !res.canceled) failure = res.error ?? 'unknown error';
      }
      if (failure) setError(t('compileNotes.error.export', { v1: failure }));
    } catch (err: unknown) {
      setError(t('compileNotes.error.export', { v1: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const radio = (name: string, value: string, checked: boolean, label: string, onChange: () => void, disabled = false) => (
    <label className="flex items-center gap-1 text-sm">
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );

  return (
    <PopupPortal>
      <div className="fixed inset-0 bg-background-overlay flex items-center justify-center" style={{ zIndex: 9999 }}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="compile-notes-title"
          data-testid="compile-notes-dialog"
          className="bg-surface rounded-lg shadow-xl flex flex-col"
          style={{ width: 'min(960px, 95vw)', height: 'min(680px, 90vh)' }}
        >
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 id="compile-notes-title" className="text-lg font-bold text-text-heading">
              {t('compileNotes.title')}
            </h2>
            <button type="button" onClick={onClose} aria-label={t('compileNotes.close')} data-testid="compile-close">
              ×
            </button>
          </div>

          <div className="flex flex-1 min-h-0">
            <div className="w-80 shrink-0 p-4 border-e border-border overflow-y-auto flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                {t('compileNotes.references')}
                <textarea
                  data-testid="compile-references"
                  className="border border-border rounded p-2 bg-background text-text-primary"
                  rows={4}
                  value={text}
                  placeholder={t('compileNotes.referencesPlaceholder')}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <div className="flex flex-col gap-1">
                {radio('compile-order', 'typed', !options.canonicalOrder, t('compileNotes.orderTyped'), () =>
                  update('canonicalOrder', false)
                )}
                {radio('compile-order', 'canonical', options.canonicalOrder, t('compileNotes.orderCanonical'), () =>
                  update('canonicalOrder', true)
                )}
              </div>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  data-testid="compile-include-text"
                  checked={options.includeVerseText}
                  onChange={(e) => update('includeVerseText', e.target.checked)}
                />
                {t('compileNotes.includeText')}
              </label>
              {options.includeVerseText && (
                <>
                  {availableBibles.length > 1 && (
                    <select
                      data-testid="compile-translation"
                      aria-label={t('compileNotes.translation')}
                      className="border border-border rounded p-1 bg-background text-text-primary text-sm"
                      value={effectiveTranslation}
                      onChange={(e) => update('translation', e.target.value)}
                    >
                      {availableBibles.map((b) => (
                        <option key={b.abbreviation} value={b.abbreviation}>
                          {b.abbreviation} - {b.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      data-testid="compile-red-letters"
                      checked={options.redLetters}
                      onChange={(e) => update('redLetters', e.target.checked)}
                    />
                    {t('compileNotes.redLetters')}
                  </label>
                </>
              )}
              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-medium">{t('compileNotes.withoutNotes')}</legend>
                {radio('compile-without', 'skip', options.versesWithoutNotes === 'skip', t('compileNotes.withoutSkip'), () =>
                  update('versesWithoutNotes', 'skip')
                )}
                {radio(
                  'compile-without',
                  'blank-space',
                  options.versesWithoutNotes === 'blank-space',
                  t('compileNotes.withoutBlank'),
                  () => update('versesWithoutNotes', 'blank-space')
                )}
                {radio(
                  'compile-without',
                  'text-only',
                  options.versesWithoutNotes === 'text-only' && options.includeVerseText,
                  t('compileNotes.withoutTextOnly'),
                  () => update('versesWithoutNotes', 'text-only'),
                  !options.includeVerseText
                )}
              </fieldset>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  data-testid="compile-headings"
                  checked={options.passageHeadings}
                  onChange={(e) => update('passageHeadings', e.target.checked)}
                />
                {t('compileNotes.headings')}
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  data-testid="compile-show-translation"
                  checked={options.showTranslation}
                  disabled={!options.passageHeadings}
                  onChange={(e) => update('showTranslation', e.target.checked)}
                />
                {t('compileNotes.showTranslation')}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t('compileNotes.verseLabel')}
                <select
                  data-testid="compile-verse-label"
                  className="border border-border rounded p-1 bg-background text-text-primary"
                  value={options.verseLabel}
                  onChange={(e) => update('verseLabel', e.target.value as CompileOptions['verseLabel'])}
                >
                  <option value="reference">{t('compileNotes.labelReference')}</option>
                  <option value="number">{t('compileNotes.labelNumber')}</option>
                  <option value="none">{t('compileNotes.labelNone')}</option>
                </select>
              </label>
            </div>

            <div className="flex-1 min-w-0 flex flex-col p-4 gap-2">
              <div role="status" data-testid="compile-status" data-ok={ok ? 'true' : 'false'} className="text-sm">
                {statusText}
              </div>
              {unrecognized.length > 0 && (
                <div data-testid="compile-unrecognized" className="text-sm text-text-secondary">
                  {t('compileNotes.unrecognized')}{' '}
                  {unrecognized.map((u, i) => (
                    <span key={i} className="me-2 font-mono">
                      {u}
                    </span>
                  ))}
                </div>
              )}
              {error && (
                <div role="alert" data-testid="compile-error" className="text-sm text-red-600">
                  {error}
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-y-auto border border-border rounded p-3" data-testid="compile-preview">
                {ok && <NoteViewer content={html} rich />}
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-border flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm flex-1 min-w-40">
              {t('compileNotes.noteTitle')}
              <input
                data-testid="compile-title"
                className="border border-border rounded p-1 bg-background text-text-primary"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleEdited(true);
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('compileNotes.folder')}
              <select
                data-testid="compile-folder"
                className="border border-border rounded p-1 bg-background text-text-primary"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              >
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f === '' ? t('compileNotes.rootFolder') : f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('compileNotes.template')}
              <select
                data-testid="compile-template"
                className="border border-border rounded p-1 bg-background text-text-primary"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex w-full flex-wrap items-center justify-end gap-sm pt-sm">
              <button type="button" data-testid="compile-cancel" onClick={onClose} className={secondaryBtn}>
                {t('compileNotes.cancel')}
              </button>
              <span className="flex items-center gap-sm ms-md" role="group">
                <button type="button" data-testid="compile-print" disabled={actionsDisabled} onClick={() => void runExport('print')} className={secondaryBtn}>
                  {t('compileNotes.print')}
                </button>
                <button type="button" data-testid="compile-pdf" disabled={actionsDisabled} onClick={() => void runExport('pdf')} className={secondaryBtn}>
                  {t('compileNotes.pdf')}
                </button>
                <button type="button" data-testid="compile-docx" disabled={actionsDisabled} onClick={() => void runExport('docx')} className={secondaryBtn}>
                  {t('compileNotes.word')}
                </button>
              </span>
              <button
                type="button"
                data-testid="compile-create"
                disabled={actionsDisabled}
                onClick={() => void handleCreate()}
                className="px-lg py-sm text-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('compileNotes.create')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PopupPortal>
  );
};

export default CompilePassageNotesDialog;
