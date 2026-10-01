/**
 * ReadingPlanBuilderForm: build a custom plan (task 0073). One scrolling form: name, what to read (books and
 * passages), order, pace, split, reading days, schedule, and a live preview from `ReadingPlans.previewPlan`.
 * It keeps its own form state and calls `onCreate(spec, start)` when valid.
 */
import { useId, useMemo, useState } from 'react';
import { ReadingPlans, getBookName } from '@bible/core/browser';
import { ReferencePicker } from '../ReferencePicker';
import type { ReferenceValue } from '../ReferencePicker';
import { WeekdayPicker } from './WeekdayPicker';

type Weekday = ReadingPlans.Weekday;
type PaceKind = 'days' | 'endDate' | 'chaptersPerDay' | 'versesPerDay';

export interface ReadingPlanBuilderStart {
  startDate: string;
  pacing: 'flexible' | 'fixed';
  readingDays: Weekday[];
}

export interface ReadingPlanBuilderFormLabels {
  name: string;
  namePlaceholder: string;
  whatToRead: string;
  wholeBible: string;
  oldTestament: string;
  newTestament: string;
  gospels: string;
  clear: string;
  books: string;
  addPassage: string;
  removePassage: (label: string) => string;
  passages: string;
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
  readingDays: string;
  schedule: string;
  flexible: string;
  flexibleHint: string;
  fixed: string;
  fixedHint: string;
  startDate: string;
  preview: string;
  chooseSomething: string;
  /** "365 days · about 12 min a day". */
  previewSummary: (days: number, minutes: number) => string;
  previewDay: (day: number, readings: string) => string;
  create: string;
  cancel: string;
}

export const DEFAULT_READING_PLAN_BUILDER_FORM_LABELS: ReadingPlanBuilderFormLabels = {
  name: 'Plan name',
  namePlaceholder: 'My reading plan',
  whatToRead: 'What to read',
  wholeBible: 'Whole Bible',
  oldTestament: 'Old Testament',
  newTestament: 'New Testament',
  gospels: 'Gospels',
  clear: 'Clear',
  books: 'Books',
  addPassage: 'Add passage',
  removePassage: (l) => `Remove ${l}`,
  passages: 'Passages',
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
  readingDays: 'Reading days',
  schedule: 'Schedule',
  flexible: 'Flexible',
  flexibleHint: 'No due dates; pick up where you left off',
  fixed: 'Fixed',
  fixedHint: 'Keep to the calendar; shows when you fall behind',
  startDate: 'Start date',
  preview: 'Preview',
  chooseSomething: 'Choose something to read',
  previewSummary: (d, m) => `${d} ${d === 1 ? 'day' : 'days'} · about ${m} min a day`,
  previewDay: (d, r) => `Day ${d}: ${r}`,
  create: 'Create plan',
  cancel: 'Cancel',
};

export interface ReadingPlanBuilderFormProps {
  onCreate: (spec: ReadingPlans.BuilderSpec, start: ReadingPlanBuilderStart) => void;
  onCancel?: () => void;
  bookName?: (book: number) => string;
  /** Today, `YYYY-MM-DD`: the default start date. */
  today: string;
  locale?: string;
  weekdayNames?: string[];
  firstDay?: 0 | 1;
  labels?: Partial<ReadingPlanBuilderFormLabels>;
  dir?: 'ltr' | 'rtl';
}

const OT = Array.from({ length: 39 }, (_, i) => i + 1);
const NT = Array.from({ length: 27 }, (_, i) => i + 40);
const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const defaultBookName = (b: number) => getBookName(b);

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
    return { start: v.verseId, end: ReadingPlans.vid(book, chapter, ReadingPlans.versesInChapter(book, chapter)) };
  }
  return { start: v.verseId, end: v.endVerseId ?? v.verseId };
}

export function ReadingPlanBuilderForm({
  onCreate, onCancel, bookName = defaultBookName, today, locale, weekdayNames, firstDay, labels, dir,
}: ReadingPlanBuilderFormProps) {
  const L = { ...DEFAULT_READING_PLAN_BUILDER_FORM_LABELS, ...labels };
  const uid = useId();
  const [name, setName] = useState('');
  const [books, setBooks] = useState<ReadonlySet<number>>(new Set());
  const [passages, setPassages] = useState<ReadingPlans.ScopeRange[]>([]);
  const [passageText, setPassageText] = useState('');
  const [order, setOrder] = useState<ReadingPlans.BuilderOrder>('canonical');
  const [paceKind, setPaceKind] = useState<PaceKind>('days');
  const [daysN, setDaysN] = useState(365);
  const [endDate, setEndDate] = useState('');
  const [chapters, setChapters] = useState(1);
  const [verses, setVerses] = useState(20);
  const [split, setSplit] = useState<ReadingPlans.BuilderSplit>('chapter');
  const [readingDays, setReadingDays] = useState<Weekday[]>(ALL_DAYS);
  const [pacing, setPacing] = useState<'flexible' | 'fixed'>('flexible');
  const [startDate, setStartDate] = useState(today);

  const spec = useMemo<ReadingPlans.BuilderSpec>(() => {
    let pace: ReadingPlans.BuilderPace;
    switch (paceKind) {
      case 'days': pace = { by: 'days', days: daysN }; break;
      case 'endDate': pace = { by: 'endDate', startDate, endDate }; break;
      case 'chaptersPerDay': pace = { by: 'chaptersPerDay', chapters }; break;
      default: pace = { by: 'versesPerDay', verses };
    }
    return {
      name: name.trim() || L.namePlaceholder,
      scope: [...booksToRanges(books), ...passages],
      order, pace, split, readingDays,
    };
  }, [name, books, passages, order, paceKind, daysN, startDate, endDate, chapters, verses, split, readingDays, L.namePlaceholder]);

  const preview = useMemo(() => {
    if (spec.scope.length === 0) return { kind: 'error', error: L.chooseSomething } as const;
    try {
      return { kind: 'ok', ok: ReadingPlans.previewPlan(spec) } as const;
    } catch (e) {
      return { kind: 'error', error: e instanceof ReadingPlans.PlanBuildError ? e.message : L.chooseSomething } as const;
    }
  }, [spec, L.chooseSomething]);

  const setBookSet = (list: number[]) => setBooks(new Set(list));
  const toggleBook = (b: number) => {
    const next = new Set(books);
    if (next.has(b)) next.delete(b); else next.add(b);
    setBooks(next);
  };
  const fmt = (r: ReadingPlans.Reading) => ReadingPlans.formatReading(r, bookName);
  const radio = (group: string) => `${uid}-${group}`;
  const dateInvalid = pacing === 'fixed' && startDate === '';
  const valid = preview.kind === 'ok' && !dateInvalid && startDate !== '';

  const bookCheck = (b: number) => (
    <label key={b} className="kth-rp-builder__book">
      <input type="checkbox" checked={books.has(b)} onChange={() => toggleBook(b)} />
      <span>{bookName(b)}</span>
    </label>
  );

  return (
    <form
      className="kth-rp-builder"
      dir={dir}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onCreate(spec, { startDate, pacing, readingDays });
      }}
    >
      <div className="kth-field">
        <label htmlFor={`${uid}-name`}>{L.name}</label>
        <input id={`${uid}-name`} className="kth-input" type="text" value={name} placeholder={L.namePlaceholder}
          onChange={(e) => setName(e.target.value)} />
      </div>

      <fieldset className="kth-fieldset">
        <legend>{L.whatToRead}</legend>
        <div className="kth-rp-builder__row">
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => setBookSet([...OT, ...NT])}>{L.wholeBible}</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => setBookSet(OT)}>{L.oldTestament}</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => setBookSet(NT)}>{L.newTestament}</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => setBookSet([40, 41, 42, 43])}>{L.gospels}</button>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => { setBookSet([]); setPassages([]); }}>{L.clear}</button>
        </div>
        <div className="kth-rp-builder__books" role="group" aria-label={`${L.books}: ${L.oldTestament}`}>{OT.map(bookCheck)}</div>
        <div className="kth-rp-builder__books" role="group" aria-label={`${L.books}: ${L.newTestament}`}>{NT.map(bookCheck)}</div>
        <div className="kth-rp-builder__passage">
          <ReferencePicker
            id={`${uid}-ref`}
            locale={locale}
            value={passageText}
            onInputChange={setPassageText}
            labels={{ label: L.addPassage }}
            showLabel
            onChange={(v) => {
              setPassages((p) => [...p, passageRange(v)]);
              setPassageText('');
            }}
          />
        </div>
        {passages.length > 0 ? (
          <ul className="kth-rp-builder__chips" aria-label={L.passages}>
            {passages.map((p, i) => (
              <li key={`${p.start}-${p.end}-${i}`} className="kth-rp-builder__chip">
                {fmt(p)}
                <button type="button" className="kth-rp-builder__chip-remove" aria-label={L.removePassage(fmt(p))}
                  onClick={() => setPassages((all) => all.filter((_, j) => j !== i))}>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>

      <fieldset className="kth-fieldset">
        <legend>{L.order}</legend>
        {([['canonical', L.orderCanonical], ['as-listed', L.orderAsListed], ['chronological', L.orderChronological]] as const).map(([v, text]) => (
          <label key={v} className="kth-rp-builder__option">
            <input type="radio" name={radio('order')} checked={order === v} onChange={() => setOrder(v)} />
            <span>{text}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="kth-fieldset">
        <legend>{L.pace}</legend>
        <div className="kth-rp-builder__option">
          <label className="kth-rp-builder__choice">
            <input type="radio" name={radio('pace')} checked={paceKind === 'days'} onChange={() => setPaceKind('days')} />
            <span>{L.paceDays}</span>
          </label>
          <input type="number" min={1} className="kth-input kth-rp-builder__number" aria-label={L.paceDays} value={daysN}
            disabled={paceKind !== 'days'} onChange={(e) => setDaysN(Number(e.target.value))} />
        </div>
        <div className="kth-rp-builder__option">
          <label className="kth-rp-builder__choice">
            <input type="radio" name={radio('pace')} checked={paceKind === 'endDate'} onChange={() => setPaceKind('endDate')} />
            <span>{L.paceEndDate}</span>
          </label>
          <input type="date" className="kth-input kth-rp-builder__date" aria-label={L.paceEndDate} value={endDate}
            disabled={paceKind !== 'endDate'} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="kth-rp-builder__option">
          <label className="kth-rp-builder__choice">
            <input type="radio" name={radio('pace')} checked={paceKind === 'chaptersPerDay'} onChange={() => setPaceKind('chaptersPerDay')} />
            <span>{L.paceChapters}</span>
          </label>
          <input type="number" min={1} className="kth-input kth-rp-builder__number" aria-label={L.paceChapters} value={chapters}
            disabled={paceKind !== 'chaptersPerDay'} onChange={(e) => setChapters(Number(e.target.value))} />
        </div>
        <div className="kth-rp-builder__option">
          <label className="kth-rp-builder__choice">
            <input type="radio" name={radio('pace')} checked={paceKind === 'versesPerDay'} onChange={() => setPaceKind('versesPerDay')} />
            <span>{L.paceVerses}</span>
          </label>
          <input type="number" min={1} className="kth-input kth-rp-builder__number" aria-label={L.paceVerses} value={verses}
            disabled={paceKind !== 'versesPerDay'} onChange={(e) => setVerses(Number(e.target.value))} />
        </div>
      </fieldset>

      <fieldset className="kth-fieldset">
        <legend>{L.split}</legend>
        <label className="kth-rp-builder__option">
          <input type="radio" name={radio('split')} checked={split === 'chapter'} onChange={() => setSplit('chapter')} />
          <span>{L.splitChapter}</span>
        </label>
        <label className="kth-rp-builder__option">
          <input type="radio" name={radio('split')} checked={split === 'verse'} onChange={() => setSplit('verse')} />
          <span>{L.splitVerse}</span>
        </label>
      </fieldset>

      <fieldset className="kth-fieldset">
        <legend>{L.readingDays}</legend>
        <WeekdayPicker value={readingDays} onChange={setReadingDays} weekdayNames={weekdayNames} firstDay={firstDay}
          labels={{ group: L.readingDays }} />
      </fieldset>

      <fieldset className="kth-fieldset">
        <legend>{L.schedule}</legend>
        <label className="kth-rp-builder__option">
          <input type="radio" name={radio('pacing')} checked={pacing === 'flexible'} onChange={() => setPacing('flexible')} />
          <span>{L.flexible}<span className="kth-field__hint"> {L.flexibleHint}</span></span>
        </label>
        <label className="kth-rp-builder__option">
          <input type="radio" name={radio('pacing')} checked={pacing === 'fixed'} onChange={() => setPacing('fixed')} />
          <span>{L.fixed}<span className="kth-field__hint"> {L.fixedHint}</span></span>
        </label>
        <div className="kth-field">
          <label htmlFor={`${uid}-start`}>{L.startDate}</label>
          <input id={`${uid}-start`} className="kth-input kth-rp-builder__date" type="date" value={startDate}
            onChange={(e) => setStartDate(e.target.value)} />
        </div>
      </fieldset>

      <section className="kth-rp-builder__preview" aria-label={L.preview} aria-live="polite">
        {preview.kind === 'ok' ? (
          <>
            <p className="kth-rp-builder__summary">{L.previewSummary(preview.ok.days, preview.ok.avgMinutes)}</p>
            <ol className="kth-rp-builder__days">
              {preview.ok.firstDays.slice(0, 3).map((d, i) => (
                <li key={i}>{L.previewDay(i + 1, d.readings.map(fmt).join('; '))}</li>
              ))}
            </ol>
          </>
        ) : (
          <p className="kth-rp-builder__error">{preview.error}</p>
        )}
      </section>

      <div className="kth-rp-builder__actions">
        <button type="submit" className="kth-btn kth-btn--primary" disabled={!valid}>{L.create}</button>
        {onCancel ? <button type="button" className="kth-btn" onClick={onCancel}>{L.cancel}</button> : null}
      </div>
    </form>
  );
}
