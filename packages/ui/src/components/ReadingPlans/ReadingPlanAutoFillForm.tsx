/**
 * ReadingPlanAutoFillForm: "spread these passages over N days". Pick what to read (books and passages), an order,
 * a pace and a split, watch the live preview, then replace or extend the plan's days with the result. It renders
 * its own action row and no dialog chrome (the app shows it inside a Dialog). The result is ordinary days.
 */
import { useId, useMemo, useState } from 'react';
import { ReadingPlans, getBookName } from '@bible/core/browser';
import { ReferencePicker } from '../ReferencePicker';
import { parseReferenceInput } from '../referenceInput';
import type { ReferenceValue } from '../ReferencePicker';
import { Checkbox, Radio } from '../Checkbox';

type PaceKind = 'days' | 'endDate' | 'chaptersPerDay' | 'versesPerDay';

export interface ReadingPlanAutoFillFormLabels {
  intro: string;
  whatToRead: string;
  wholeBible: string;
  oldTestament: string;
  newTestament: string;
  gospels: string;
  clear: string;
  books: string;
  chooseBooks: string;
  addPassage: string;
  removePassage: (label: string) => string;
  passages: string;
  addPassagePlaceholder: string;
  addPassageSuggestions: string;
  addPassageInvalid: string;
  addPassageCount: string;
  order: string;
  orderCanonical: string;
  orderAsListed: string;
  orderChronological: string;
  pace: string;
  paceDays: string;
  paceEndDate: string;
  paceChapters: string;
  paceVerses: string;
  split: string;
  splitChapter: string;
  splitVerse: string;
  preview: string;
  chooseSomething: string;
  errorEmptyScope: string;
  errorInvalidRange: string;
  errorInvalidPace: string;
  errorTooManyDays: string;
  errorTooManyReadings: string;
  previewSummary: (days: number, minutes: number) => string;
  previewDay: (day: number, readings: string) => string;
  noteSplit: string;
  noteFewerDays: (days: number) => string;
  replace: string;
  append: (afterDay: number) => string;
  apply: string;
  cancel: string;
}

export const DEFAULT_READING_PLAN_AUTO_FILL_FORM_LABELS: ReadingPlanAutoFillFormLabels = {
  intro: 'Choose what to read and how fast. The result is ordinary days you can edit afterwards.',
  whatToRead: 'What to read',
  wholeBible: 'Whole Bible',
  oldTestament: 'Old Testament',
  newTestament: 'New Testament',
  gospels: 'Gospels',
  clear: 'Clear',
  books: 'Books',
  chooseBooks: 'Choose books',
  addPassage: 'Add passage',
  removePassage: (l) => `Remove ${l}`,
  passages: 'Passages',
  addPassagePlaceholder: 'Add passage, e.g. John 1-3',
  addPassageSuggestions: 'Suggestions',
  addPassageInvalid: 'That is not a passage. Try John 3, John 1-3 or John 3:16-18.',
  addPassageCount: '{count} suggestions',
  order: 'Order',
  orderCanonical: 'Canonical (Bible order)',
  orderAsListed: 'As listed (books, then passages)',
  orderChronological: 'Chronological',
  pace: 'Pace',
  paceDays: 'Number of days',
  paceEndDate: 'Finish by',
  paceChapters: 'Chapters a day',
  paceVerses: 'Verses a day',
  split: 'Daily readings',
  splitChapter: 'Whole chapters',
  splitVerse: 'Balanced by verses (may split chapters)',
  preview: 'Preview',
  chooseSomething: 'Choose something to read',
  errorEmptyScope: 'Choose something to read',
  errorInvalidRange: 'The passage range is not valid',
  errorInvalidPace: 'The pace is not valid',
  errorTooManyDays: 'That would take too many days',
  errorTooManyReadings: 'That would make too many readings in a day',
  previewSummary: (d, m) => `${d} ${d === 1 ? 'day' : 'days'} · about ${m} min a day`,
  previewDay: (d, r) => `Day ${d}: ${r}`,
  noteSplit: 'There are fewer chapters than days, so chapters are split into shorter readings.',
  noteFewerDays: (d) => `This makes only ${d} ${d === 1 ? 'day' : 'days'}: there is not enough to read for more.`,
  replace: 'Replace all days',
  append: (n) => `Add after day ${n}`,
  apply: 'Fill plan',
  cancel: 'Cancel',
};

export interface ReadingPlanAutoFillFormProps {
  /** Today, YYYY-MM-DD (start of a "finish by" pace). */
  today: string;
  /** Days the plan already has: 0 shows one "Fill plan" button, otherwise "Replace all days" and "Add after day N". */
  existingDays: number;
  onApply: (days: ReadingPlans.PlanDay[], mode: 'replace' | 'append') => void;
  onCancel: () => void;
  locale?: string;
  bookName?: (book: number) => string;
  labels?: Partial<ReadingPlanAutoFillFormLabels>;
  dir?: 'ltr' | 'rtl';
}

const OT = Array.from({ length: 39 }, (_, i) => i + 1);
const NT = Array.from({ length: 27 }, (_, i) => i + 40);
const defaultBookName = (b: number) => getBookName(b);

/** A whole number of at least 1 (blank or invalid input becomes 1). */
function wholeAtLeast1(raw: string): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Consecutive selected books folded into `booksRange(from, to)` scope ranges. */
function booksToRanges(books: ReadonlySet<number>): ReadingPlans.ScopeRange[] {
  const sorted = [...books].sort((a, b) => a - b);
  const out: ReadingPlans.ScopeRange[] = [];
  let from = -1;
  let prev = -1;
  for (const b of sorted) {
    if (from === -1) from = b;
    else if (b !== prev + 1) {
      out.push(ReadingPlans.booksRange(from, prev));
      from = b;
    }
    prev = b;
  }
  if (from !== -1) out.push(ReadingPlans.booksRange(from, prev));
  return out;
}

function passageRange(v: ReferenceValue): ReadingPlans.ScopeRange {
  if (v.wholeChapter) {
    const { book, chapter } = ReadingPlans.splitVid(v.verseId);
    return { start: ReadingPlans.vid(book, chapter, 1), end: ReadingPlans.vid(book, chapter, ReadingPlans.versesInChapter(book, chapter)) };
  }
  return { start: v.verseId, end: v.endVerseId ?? v.verseId };
}

export function ReadingPlanAutoFillForm({
  today, existingDays, onApply, onCancel, locale, bookName = defaultBookName, labels, dir,
}: ReadingPlanAutoFillFormProps) {
  const L = { ...DEFAULT_READING_PLAN_AUTO_FILL_FORM_LABELS, ...labels };
  const uid = useId();
  const [books, setBooks] = useState<ReadonlySet<number>>(new Set());
  const [passages, setPassages] = useState<ReadingPlans.ScopeRange[]>([]);
  const [passageText, setPassageText] = useState('');
  const [order, setOrder] = useState<ReadingPlans.BuilderOrder>('canonical');
  const [paceKind, setPaceKind] = useState<PaceKind>('days');
  const [daysN, setDaysN] = useState('30');
  const [endDate, setEndDate] = useState('');
  const [chapters, setChapters] = useState('1');
  const [verses, setVerses] = useState('20');
  const [split, setSplit] = useState<ReadingPlans.BuilderSplit>('chapter');

  const spec = useMemo<ReadingPlans.BuilderSpec>(() => {
    let pace: ReadingPlans.BuilderPace;
    switch (paceKind) {
      case 'days': pace = { by: 'days', days: wholeAtLeast1(daysN) }; break;
      case 'endDate': pace = { by: 'endDate', startDate: today, endDate }; break;
      case 'chaptersPerDay': pace = { by: 'chaptersPerDay', chapters: wholeAtLeast1(chapters) }; break;
      default: pace = { by: 'versesPerDay', verses: wholeAtLeast1(verses) };
    }
    // A passage that is typed but not yet entered counts too, so the preview answers at once and nothing typed is lost.
    const pending = parseReferenceInput(passageText, locale);
    const typed = pending.ok ? [passageRange(pending.value)] : [];
    return { name: 'plan', scope: [...booksToRanges(books), ...passages, ...typed], order, pace, split };
  }, [books, passages, passageText, locale, order, paceKind, daysN, today, endDate, chapters, verses, split]);

  // Built only when the spec changes; error text is mapped at render so labels never rebuild the preview.
  const built = useMemo(() => {
    if (spec.scope.length === 0) return { kind: 'error', code: 'empty_scope' } as const;
    try {
      const days = ReadingPlans.buildPlanDays(spec);
      const perDay = days.map((d) => d.readings.reduce((n, r) => n + ReadingPlans.countVerses(r.start, r.end), 0));
      const verseTotal = perDay.reduce((a, b) => a + b, 0);
      return { kind: 'ok', days, avgMinutes: ReadingPlans.estimateMinutes(verseTotal / Math.max(1, days.length)) } as const;
    } catch (e) {
      return { kind: 'error', code: e instanceof ReadingPlans.PlanBuildError ? e.code : null } as const;
    }
  }, [spec]);
  const errorText = (code: ReadingPlans.PlanBuildError['code'] | null): string => {
    switch (code) {
      case 'empty_scope': return spec.scope.length === 0 ? L.chooseSomething : L.errorEmptyScope;
      case 'invalid_range': return L.errorInvalidRange;
      case 'invalid_pace': return L.errorInvalidPace;
      case 'too_many_days': return L.errorTooManyDays;
      case 'too_many_readings': return L.errorTooManyReadings;
      default: return L.chooseSomething;
    }
  };

  const setBookSet = (list: number[]) => setBooks(new Set(list));
  const toggleBook = (b: number) => {
    const next = new Set(books);
    if (next.has(b)) next.delete(b); else next.add(b);
    setBooks(next);
  };
  const fmt = (r: ReadingPlans.Reading) => ReadingPlans.formatReading(r, bookName);
  const valid = built.kind === 'ok';

  const apply = (mode: 'replace' | 'append') => {
    if (built.kind !== 'ok') return;
    onApply(built.days.map((d) => ({ readings: d.readings.map((r) => ({ start: r.start, end: r.end })) })), mode);
  };

  const bookCheck = (b: number) => (
    <Checkbox key={b} checked={books.has(b)} onChange={() => toggleBook(b)} label={bookName(b)} />
  );

  let paceInput;
  switch (paceKind) {
    case 'days':
      paceInput = <input type="number" min={1} step={1} className="kth-input kth-rp-autofill__number" aria-label={L.paceDays} value={daysN}
        onChange={(e) => setDaysN(e.currentTarget.value)} />;
      break;
    case 'endDate':
      paceInput = <input type="date" className="kth-input kth-rp-autofill__date" aria-label={L.paceEndDate} value={endDate}
        onChange={(e) => setEndDate(e.currentTarget.value)} />;
      break;
    case 'chaptersPerDay':
      paceInput = <input type="number" min={1} step={1} className="kth-input kth-rp-autofill__number" aria-label={L.paceChapters} value={chapters}
        onChange={(e) => setChapters(e.currentTarget.value)} />;
      break;
    default:
      paceInput = <input type="number" min={1} step={1} className="kth-input kth-rp-autofill__number" aria-label={L.paceVerses} value={verses}
        onChange={(e) => setVerses(e.currentTarget.value)} />;
  }

  const showSplitNote = built.kind === 'ok' && split === 'chapter' && built.days.some((d) => d.readings.some((r) => !ReadingPlans.isWholeChapters(r)));
  const askedDays = spec.pace.by === 'days' ? spec.pace.days : 0;
  const showFewer = built.kind === 'ok' && paceKind === 'days' && built.days.length < askedDays;

  return (
    <div className="kth-rp-autofill" dir={dir}>
      <p className="kth-text-muted">{L.intro}</p>

      <fieldset className="kth-fieldset">
        <legend>{L.whatToRead}</legend>
        <div className="kth-rp-autofill__row">
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => setBookSet([...OT, ...NT])}>{L.wholeBible}</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => setBookSet(OT)}>{L.oldTestament}</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => setBookSet(NT)}>{L.newTestament}</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => setBookSet([40, 41, 42, 43])}>{L.gospels}</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => { setBookSet([]); setPassages([]); setPassageText(''); }}>{L.clear}</button>
        </div>
        <div className="kth-rp-autofill__passage">
          <ReferencePicker
            id={`${uid}-ref`}
            locale={locale}
            dir={dir}
            value={passageText}
            onInputChange={setPassageText}
            labels={{
              label: L.addPassage, placeholder: L.addPassagePlaceholder, suggestions: L.addPassageSuggestions,
              invalid: L.addPassageInvalid, count: L.addPassageCount,
            }}
            showInvalidMessage
            showLabel={false}
            onChange={(v) => {
              setPassages((p) => [...p, passageRange(v)]);
              setPassageText('');
            }}
          />
        </div>
        {passages.length > 0 ? (
          <ul className="kth-rp-autofill__chips" aria-label={L.passages}>
            {passages.map((p, i) => (
              <li key={`${p.start}-${p.end}-${i}`} className="kth-rp-autofill__chip">
                {fmt(p)}
                <button type="button" className="kth-rp-autofill__chip-remove" aria-label={L.removePassage(fmt(p))}
                  onClick={() => setPassages((all) => all.filter((_, j) => j !== i))}>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <details className="kth-rp-autofill__details">
          <summary>{books.size > 0 ? `${L.chooseBooks} (${books.size})` : L.chooseBooks}</summary>
          <div className="kth-rp-autofill__books" role="group" aria-label={`${L.books}: ${L.oldTestament}`}>{OT.map(bookCheck)}</div>
          <div className="kth-rp-autofill__books" role="group" aria-label={`${L.books}: ${L.newTestament}`}>{NT.map(bookCheck)}</div>
        </details>
      </fieldset>

      <div className="kth-rp-autofill__grid">
        <div className="kth-field">
          <label htmlFor={`${uid}-pace`}>{L.pace}</label>
          <div className="kth-rp-autofill__pace">
            <select id={`${uid}-pace`} className="kth-select kth-rp-autofill__select" value={paceKind} onChange={(e) => setPaceKind(e.currentTarget.value as PaceKind)}>
              <option value="days">{L.paceDays}</option>
              <option value="endDate">{L.paceEndDate}</option>
              <option value="chaptersPerDay">{L.paceChapters}</option>
              <option value="versesPerDay">{L.paceVerses}</option>
            </select>
            {paceInput}
          </div>
        </div>

        <div className="kth-field">
          <label htmlFor={`${uid}-order`}>{L.order}</label>
          <select id={`${uid}-order`} className="kth-select" value={order} onChange={(e) => setOrder(e.currentTarget.value as ReadingPlans.BuilderOrder)}>
            <option value="canonical">{L.orderCanonical}</option>
            <option value="as-listed">{L.orderAsListed}</option>
            <option value="chronological">{L.orderChronological}</option>
          </select>
        </div>
      </div>

      <fieldset className="kth-fieldset">
        <legend>{L.split}</legend>
        <div className="kth-rp-autofill__choices">
          <Radio name={`${uid}-split`} checked={split === 'chapter'} onChange={() => setSplit('chapter')} label={L.splitChapter} />
          <Radio name={`${uid}-split`} checked={split === 'verse'} onChange={() => setSplit('verse')} label={L.splitVerse} />
        </div>
      </fieldset>

      <section className="kth-rp-autofill__preview" aria-label={L.preview} aria-live="polite">
        {built.kind === 'ok' ? (
          <>
            <p className="kth-rp-autofill__summary">{L.previewSummary(built.days.length, built.avgMinutes)}</p>
            <ol className="kth-rp-autofill__days">
              {built.days.slice(0, 3).map((d, i) => (
                <li key={i}>{L.previewDay(i + 1, d.readings.map(fmt).join('; '))}</li>
              ))}
            </ol>
            {showSplitNote ? <p className="kth-rp-autofill__note">{L.noteSplit}</p> : null}
            {showFewer ? <p className="kth-rp-autofill__note">{L.noteFewerDays(built.days.length)}</p> : null}
          </>
        ) : (
          <p className="kth-rp-autofill__error">{errorText(built.code)}</p>
        )}
      </section>

      <div className="kth-rp-autofill__actions">
        {existingDays === 0 ? (
          <button type="button" className="kth-btn kth-btn--primary" disabled={!valid} onClick={() => apply('replace')}>{L.apply}</button>
        ) : (
          <>
            <button type="button" className="kth-btn kth-btn--primary" disabled={!valid} onClick={() => apply('append')}>{L.append(existingDays)}</button>
            <button type="button" className="kth-btn" disabled={!valid} onClick={() => apply('replace')}>{L.replace}</button>
          </>
        )}
        <button type="button" className="kth-btn" onClick={onCancel}>{L.cancel}</button>
      </div>
    </div>
  );
}
