/**
 * VerseSelector: pick a verse, a verse range or a whole chapter, by typing a reference or with dropdowns,
 * and preview the text through a host-provided async lookup.
 *
 * SEED MODEL (design-r2 section 13, item 27): there is ONE seed, `initialReference`, a typed reference string
 * ("John 3:16"). It is uncontrolled: the component owns its text and selection afterwards, and reports every
 * valid change through `onChange`. A later, different `initialReference` re-seeds (the same rule as the kit's
 * reference picker); an equal one changes nothing. There is no controlled `value` and no `defaultReference`.
 * The kit element maps its string `value` attribute to `initialReference`.
 *
 * Row 1 is a ReferencePicker (ranges and whole chapters are NEVER rejected by it; `noRanges` is not passed).
 * Row 2 holds native selects (Book, Chapter, Verse, to). The two rows stay in step. Typed text commits live
 * (every parseable value), Enter on a valid selection also calls `onSubmit`. The preview is debounced and
 * aborted when the selection changes. Labels are props with English defaults; no i18n library is used here.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MAX_CHAPTERS, directionForTag, versesInChapter } from '@bible/core/browser';
import { ReferencePicker } from './ReferencePicker';
import { getPickerParsers, parseReferenceInput } from './referenceInput';
import type { ReferenceValue } from './referenceInput';

export interface VerseSelection {
  verseId: number;
  endVerseId?: number;
  /** Canonical reference in the selector's locale. */
  ref: string;
  /** A bare chapter: `verseId` is chapter:1 and there is no `endVerseId`. */
  wholeChapter?: boolean;
}

/**
 * Host-provided text lookup. `range.endVerseId` is always set for a whole chapter (its last verse) and is absent
 * for a single verse. Resolve `null` for "no text available". Must honor `signal` (reject on abort).
 */
export type VerseTextLookup = (
  range: { verseId: number; endVerseId?: number },
  signal: AbortSignal,
) => Promise<readonly { verseId: number; text: string }[] | null>;

export interface VerseSelectorLabels {
  group: string;
  reference: string;
  placeholder: string;
  book: string;
  chapter: string;
  verse: string;
  to: string;
  /** Verse option meaning the whole chapter. */
  all: string;
  /** "to" option meaning a single verse (no range end). */
  single: string;
  /** "to" option for a later chapter; `{chapter}` is replaced. */
  endOfChapter: string;
  invalid: string;
  crossChapterNotAllowed: string;
  preview: string;
  loading: string;
  unavailable: string;
  /** `{count}` is replaced. */
  more: string;
}

export const DEFAULT_VERSE_SELECTOR_LABELS: VerseSelectorLabels = {
  group: 'Verse selector',
  reference: 'Bible reference',
  placeholder: 'e.g. John 3:16',
  book: 'Book',
  chapter: 'Chapter',
  verse: 'Verse',
  to: 'To verse',
  all: 'All',
  single: '-',
  endOfChapter: 'End of chapter {chapter}',
  invalid: 'Not a valid reference',
  crossChapterNotAllowed: 'A range cannot span chapters here',
  preview: 'Verse text',
  loading: 'Loading...',
  unavailable: 'No text available',
  more: 'and {count} more',
};

export interface VerseSelectorProps {
  id?: string;
  /** The only seed (uncontrolled): typed text, e.g. "John 3:16". */
  initialReference?: string;
  /** Every valid change; `null` when the text stops being a valid selection. */
  onChange(sel: VerseSelection | null): void;
  /** Enter with a valid selection. */
  onSubmit?(sel: VerseSelection): void;
  /** Absent = no preview. */
  lookup?: VerseTextLookup;
  /** Default 12, then "and {count} more". */
  previewMaxVerses?: number;
  /** Chapter ranges allowed (default true). */
  crossChapter?: boolean;
  /** A bare chapter allowed (default true). */
  wholeChapter?: boolean;
  locale?: string;
  dir?: 'ltr' | 'rtl';
  disabled?: boolean;
  autoFocus?: boolean;
  labels?: Partial<VerseSelectorLabels>;
}

interface Pos {
  book: number;
  chapter: number;
  /** 0 = the whole chapter. */
  verse: number;
  to: { chapter: number; verse: number } | null;
}

const PREVIEW_DEBOUNCE_MS = 200;
const idOf = (book: number, chapter: number, verse: number) => book * 1_000_000 + chapter * 1000 + verse;
const decode = (id: number) => ({ book: Math.floor(id / 1_000_000), chapter: Math.floor(id / 1000) % 1000, verse: id % 1000 });
const sameSel = (a: VerseSelection | null, b: VerseSelection | null) =>
  a === b || (!!a && !!b && a.verseId === b.verseId && a.endVerseId === b.endVerseId && !!a.wholeChapter === !!b.wholeChapter);

function posFromSelection(sel: VerseSelection): Pos {
  const s = decode(sel.verseId);
  const to = sel.endVerseId !== undefined ? decode(sel.endVerseId) : null;
  return { book: s.book, chapter: s.chapter, verse: sel.wholeChapter ? 0 : s.verse, to: to ? { chapter: to.chapter, verse: to.verse } : null };
}

function selectionFromPos(pos: Pos, locale: string): VerseSelection {
  const { primary } = getPickerParsers(locale);
  const base = { isValid: true, book: pos.book, chapter: pos.chapter, originalText: '' };
  if (pos.verse === 0) {
    return { verseId: idOf(pos.book, pos.chapter, 1), ref: primary.format(base), wholeChapter: true };
  }
  const sel: VerseSelection = { verseId: idOf(pos.book, pos.chapter, pos.verse), ref: '' };
  const parsed: Record<string, unknown> = { ...base, verse: pos.verse };
  if (pos.to && !(pos.to.chapter === pos.chapter && pos.to.verse === pos.verse)) {
    sel.endVerseId = idOf(pos.book, pos.to.chapter, pos.to.verse);
    parsed.endVerse = pos.to.verse;
    if (pos.to.chapter !== pos.chapter) parsed.endChapter = pos.to.chapter;
  }
  sel.ref = primary.format(parsed as unknown as Parameters<typeof primary.format>[0]);
  return sel;
}

function toValue(v: ReferenceValue): VerseSelection {
  const sel: VerseSelection = { verseId: v.verseId, ref: v.ref };
  if (v.endVerseId !== undefined) sel.endVerseId = v.endVerseId;
  if (v.wholeChapter) sel.wholeChapter = true;
  return sel;
}

const spansChapters = (sel: VerseSelection) =>
  sel.endVerseId !== undefined && decode(sel.verseId).chapter !== decode(sel.endVerseId).chapter;

interface Preview {
  state: 'idle' | 'loading' | 'ready' | 'unavailable';
  verses: readonly { verseId: number; text: string }[];
}

export function VerseSelector({
  id: idProp,
  initialReference = '',
  onChange,
  onSubmit,
  lookup,
  previewMaxVerses = 12,
  crossChapter = true,
  wholeChapter = true,
  locale = 'en',
  dir,
  disabled,
  autoFocus,
  labels: labelOverrides,
}: VerseSelectorProps) {
  const labels: VerseSelectorLabels = { ...DEFAULT_VERSE_SELECTOR_LABELS, ...labelOverrides };
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const parsers = getPickerParsers(locale);
  const rtl = (dir ?? directionForTag(locale)) === 'rtl';

  const [text, setText] = useState(initialReference);
  const [sel, setSel] = useState<VerseSelection | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [problem, setProblem] = useState<'invalid' | 'cross' | null>(null);
  const [preview, setPreview] = useState<Preview>({ state: 'idle', verses: [] });

  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;
  const selRef = useRef<VerseSelection | null>(null);

  const setSelection = (next: VerseSelection | null, nextPos: Pos | null) => {
    const changed = !sameSel(selRef.current, next);
    selRef.current = next;
    setSel(next);
    if (nextPos) setPos(nextPos);
    if (changed) onChangeRef.current(next);
  };

  /** Accept a parsed/typed selection, or reject it (cross-chapter when not allowed). Returns whether accepted. */
  const accept = (next: VerseSelection): boolean => {
    if (!crossChapter && spansChapters(next)) {
      setProblem('cross');
      setSelection(null, null);
      return false;
    }
    setProblem(null);
    setSelection(next, posFromSelection(next));
    return true;
  };

  const parseText = (t: string): VerseSelection | null => {
    const r = parseReferenceInput(t, locale, { noWholeChapter: wholeChapter ? undefined : true });
    return r.ok ? toValue(r.value) : null;
  };

  // Seed / re-seed: only on a real change of `initialReference` (an effect that also overwrote typed text after
  // mount would lose input).
  const seeded = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (seeded.current === initialReference) return;
    const first = seeded.current === undefined;
    seeded.current = initialReference;
    if (!first) setText(initialReference);
    const parsed = parseText(initialReference);
    if (parsed) accept(parsed);
    else if (!first) {
      setProblem(null);
      setSelection(null, null);
    }
  }, [initialReference]);

  const onInput = (t: string) => {
    setText(t);
    const parsed = parseText(t);
    if (parsed) {
      accept(parsed);
    } else {
      setProblem(t.trim() === '' || selRef.current === null ? null : 'invalid');
      setSelection(null, null);
    }
  };

  const onPickerCommit = (v: ReferenceValue) => {
    const next = toValue(v);
    setText(v.ref);
    if (accept(next)) onSubmitRef.current?.(next);
  };

  const applyPos = (next: Pos) => {
    const s = selectionFromPos(next, locale);
    setText(s.ref);
    setProblem(null);
    setSelection(s, next);
  };

  // --- preview ----------------------------------------------------------------------------------------------
  const selKey = sel ? `${sel.verseId}-${sel.endVerseId ?? ''}-${sel.wholeChapter ? 'w' : ''}` : '';
  useEffect(() => {
    if (!lookup || !sel) {
      setPreview({ state: 'idle', verses: [] });
      return undefined;
    }
    const ctrl = new AbortController();
    const range: { verseId: number; endVerseId?: number } = { verseId: sel.verseId };
    if (sel.wholeChapter) {
      const d = decode(sel.verseId);
      range.endVerseId = idOf(d.book, d.chapter, Math.max(1, versesInChapter(d.book, d.chapter)));
    } else if (sel.endVerseId !== undefined) range.endVerseId = sel.endVerseId;
    setPreview((p) => ({ state: 'loading', verses: p.verses }));
    const timer = setTimeout(() => {
      lookup(range, ctrl.signal).then(
        (rows) => {
          if (ctrl.signal.aborted) return;
          setPreview(rows && rows.length > 0 ? { state: 'ready', verses: rows } : { state: 'unavailable', verses: [] });
        },
        () => {
          if (!ctrl.signal.aborted) setPreview({ state: 'unavailable', verses: [] });
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [selKey, lookup]);

  // --- selects -----------------------------------------------------------------------------------------------
  const book = pos?.book ?? 0;
  const chapter = pos?.chapter ?? 0;
  const verseCount = pos ? Math.max(1, versesInChapter(pos.book, pos.chapter)) : 0;
  const chapterCount = pos ? ((MAX_CHAPTERS[pos.book] as number | undefined) ?? 1) : 0;

  const toOptions = useMemo(() => {
    if (!pos || pos.verse === 0) return [];
    const out: { key: string; label: string }[] = [];
    for (let v = pos.verse + 1; v <= verseCount; v++) out.push({ key: `${pos.chapter}:${v}`, label: String(v) });
    if (crossChapter) {
      for (let c = pos.chapter + 1; c <= chapterCount; c++) {
        out.push({ key: `${c}:${Math.max(1, versesInChapter(pos.book, c))}`, label: labels.endOfChapter.replace('{chapter}', String(c)) });
      }
    }
    const cur = pos.to;
    if (cur && !out.some((o) => o.key === `${cur.chapter}:${cur.verse}`) && !(cur.chapter === pos.chapter && cur.verse === pos.verse)) {
      out.push({ key: `${cur.chapter}:${cur.verse}`, label: `${cur.chapter}:${cur.verse}` });
    }
    return out;
  }, [pos, verseCount, chapterCount, crossChapter, labels.endOfChapter]);

  const onBook = (b: number) => applyPos({ book: b, chapter: 1, verse: wholeChapter ? 0 : 1, to: null });
  const onChapter = (c: number) => {
    if (!pos) return;
    const max = Math.max(1, versesInChapter(pos.book, c));
    applyPos({ book: pos.book, chapter: c, verse: pos.verse === 0 ? 0 : Math.min(pos.verse, max), to: null });
  };
  const onVerse = (v: number) => {
    if (!pos) return;
    const keepTo = v !== 0 && pos.to && (pos.to.chapter > pos.chapter || pos.to.verse > v) ? pos.to : null;
    applyPos({ ...pos, verse: v, to: keepTo });
  };
  const onTo = (key: string) => {
    if (!pos) return;
    if (key === '') return applyPos({ ...pos, to: null });
    const [c, v] = key.split(':').map(Number);
    applyPos({ ...pos, to: { chapter: c, verse: v } });
  };

  const bookNames = parsers.displayNames;
  const message = problem === 'cross' ? labels.crossChapterNotAllowed : problem === 'invalid' ? labels.invalid : '';
  const shown = preview.verses.slice(0, Math.max(1, previewMaxVerses));
  const hidden = preview.verses.length - shown.length;
  const nums = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from);

  const field = (suffix: string, label: string, control: (fid: string) => JSX.Element) => (
    <div className="kth-verse-selector__field">
      <label className="kth-verse-selector__label" htmlFor={`${id}-${suffix}`}>
        {label}
      </label>
      {control(`${id}-${suffix}`)}
    </div>
  );

  return (
    <div className="kth-verse-selector" role="group" aria-label={labels.group} dir={dir ?? (rtl ? 'rtl' : 'ltr')}>
      <div className="kth-verse-selector__row">
        <div className="kth-verse-selector__ref">
        <ReferencePicker
          id={`${id}-ref`}
          value={text}
          onInputChange={onInput}
          onChange={onPickerCommit}
          locale={locale}
          dir={dir}
          disabled={disabled}
          autoFocus={autoFocus}
          noWholeChapter={wholeChapter ? undefined : true}
          labels={{ label: labels.reference, placeholder: labels.placeholder, invalid: labels.invalid }}
          showLabel
        />
        </div>
      </div>
      <div className="kth-verse-selector__row">
        {field('book', labels.book, (fid) => (
          <select
            id={fid}
            className="kth-select kth-verse-selector__select"
            disabled={disabled}
            value={book || ''}
            onChange={(e) => onBook(Number(e.currentTarget.value))}
          >
            {!book ? <option value="" /> : null}
            {nums(66).map((b) => (
              <option key={b} value={b}>
                {bookNames[b - 1] ?? `Book ${b}`}
              </option>
            ))}
          </select>
        ))}
        {field('chapter', labels.chapter, (fid) => (
          <select
            id={fid}
            className="kth-select kth-verse-selector__select"
            disabled={disabled || !pos}
            value={chapter || ''}
            onChange={(e) => onChapter(Number(e.currentTarget.value))}
          >
            {!pos ? <option value="" /> : null}
            {nums(chapterCount).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ))}
        {field('verse', labels.verse, (fid) => (
          <select
            id={fid}
            className="kth-select kth-verse-selector__select"
            disabled={disabled || !pos}
            value={pos ? pos.verse : ''}
            onChange={(e) => onVerse(Number(e.currentTarget.value))}
          >
            {!pos ? <option value="" /> : null}
            {wholeChapter || pos?.verse === 0 ? <option value={0}>{labels.all}</option> : null}
            {nums(verseCount).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ))}
        {field('to', labels.to, (fid) => (
          <select
            id={fid}
            className="kth-select kth-verse-selector__select"
            disabled={disabled || !pos || pos.verse === 0}
            value={pos?.to ? `${pos.to.chapter}:${pos.to.verse}` : ''}
            onChange={(e) => onTo(e.currentTarget.value)}
          >
            <option value="">{labels.single}</option>
            {toOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
      </div>
      <div className="kth-verse-selector__status" role="status">
        {message}
      </div>
      {lookup ? (
        <blockquote className="kth-verse-selector__preview" aria-live="polite" aria-label={labels.preview} aria-busy={preview.state === 'loading'}>
          {sel && preview.state === 'loading' && preview.verses.length === 0 ? labels.loading : null}
          {sel && preview.state === 'unavailable' ? labels.unavailable : null}
          {sel && preview.verses.length > 0
            ? shown.map((v) => (
                <span key={v.verseId} className="kth-verse-selector__verse">
                  <sup>{v.verseId % 1000}</sup> <bdi>{v.text}</bdi>{' '}
                </span>
              ))
            : null}
          {sel && hidden > 0 ? <span className="kth-verse-selector__more">{labels.more.replace('{count}', String(hidden))}</span> : null}
        </blockquote>
      ) : null}
    </div>
  );
}
