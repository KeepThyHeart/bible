/**
 * ReadingPlanDayEditor: a plan as an editable list of days. Each day shows its passages as removable chips and an
 * add-passage control; days can be moved or deleted. Controlled: every change goes out through `onChange` as a new
 * array. Only one day at a time shows the real reference input (the others show a small "+ Add passage" link), which
 * keeps a 365-day list light.
 */
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ReadingPlans, getBookName } from '@bible/core/browser';
import { ReferencePicker } from '../ReferencePicker';
import type { ReferenceValue } from '../ReferencePicker';

export interface ReadingPlanDayEditorLabels {
  list: string;
  day: (day: number) => string;
  addPassage: (day: number) => string;
  addPassageButton: string;
  addPassagePlaceholder: string;
  addPassageSuggestions: string;
  addPassageInvalid: string;
  addPassageCount: string;
  removePassage: (passage: string, day: number) => string;
  moveUp: (day: number) => string;
  moveDown: (day: number) => string;
  removeDay: (day: number) => string;
  addDay: string;
  emptyDay: string;
  empty: string;
}

export const DEFAULT_READING_PLAN_DAY_EDITOR_LABELS: ReadingPlanDayEditorLabels = {
  list: 'Days of the plan',
  day: (d) => `Day ${d}`,
  addPassage: (d) => `Add a passage to day ${d}`,
  addPassageButton: 'Add passage',
  addPassagePlaceholder: 'Add passage, e.g. John 1-3',
  addPassageSuggestions: 'Suggestions',
  addPassageInvalid: 'That is not a passage. Try John 3, John 1-3 or John 3:16-18.',
  addPassageCount: '{count} suggestions',
  removePassage: (p, d) => `Remove ${p} from day ${d}`,
  moveUp: (d) => `Move day ${d} up`,
  moveDown: (d) => `Move day ${d} down`,
  removeDay: (d) => `Delete day ${d}`,
  addDay: 'Add day',
  emptyDay: 'No passages yet',
  empty: 'No days yet. Add a day, or fill the plan automatically.',
};

export interface ReadingPlanDayEditorProps {
  days: ReadingPlans.PlanDay[];
  onChange: (days: ReadingPlans.PlanDay[]) => void;
  locale?: string;
  bookName?: (book: number) => string;
  labels?: Partial<ReadingPlanDayEditorLabels>;
  dir?: 'ltr' | 'rtl';
}

const defaultBookName = (b: number) => getBookName(b);

function toReading(v: ReferenceValue): ReadingPlans.Reading {
  if (v.wholeChapter) {
    const { book, chapter } = ReadingPlans.splitVid(v.verseId);
    return { start: ReadingPlans.vid(book, chapter, 1), end: ReadingPlans.vid(book, chapter, ReadingPlans.versesInChapter(book, chapter)) };
  }
  return { start: v.verseId, end: v.endVerseId ?? v.verseId };
}

export function ReadingPlanDayEditor({ days, onChange, locale, bookName = defaultBookName, labels, dir }: ReadingPlanDayEditorProps) {
  const L = { ...DEFAULT_READING_PLAN_DAY_EDITOR_LABELS, ...labels };
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(() => {
    const i = days.findIndex((d) => d.readings.length === 0);
    return i === -1 ? null : i;
  });
  const [text, setText] = useState('');
  const [focusTick, setFocusTick] = useState(0);
  const pickerId = (i: number) => `${uid}-d${i}`;

  useLayoutEffect(() => {
    if (focusTick === 0 || active === null) return;
    const el = rootRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]');
    el?.focus();
  }, [focusTick, active]);

  const activate = (i: number) => {
    setActive(i);
    setText('');
    setFocusTick((n) => n + 1);
  };
  const fmt = (r: ReadingPlans.Reading) => ReadingPlans.formatReading(r, bookName);

  const addPassage = (i: number, v: ReferenceValue) => {
    onChange(days.map((d, j) => (j === i ? { ...d, readings: [...d.readings, toReading(v)] } : d)));
    setText('');
  };
  const removePassage = (i: number, k: number) => {
    onChange(days.map((d, j) => (j === i ? { ...d, readings: d.readings.filter((_, m) => m !== k) } : d)));
  };
  const move = (i: number, by: -1 | 1) => {
    const to = i + by;
    if (to < 0 || to >= days.length) return;
    const next = [...days];
    [next[i], next[to]] = [next[to], next[i]];
    onChange(next);
    if (active === i) setActive(to);
    else if (active === to) setActive(i);
  };
  const removeDay = (i: number) => {
    onChange(days.filter((_, j) => j !== i));
    setActive(null);
  };
  const addDay = () => {
    onChange([...days, { readings: [] }]);
    activate(days.length);
  };

  return (
    <div className="kth-rp-days-wrap" dir={dir} ref={rootRef}>
      {days.length === 0 ? <p className="kth-rp-days__empty">{L.empty}</p> : (
        <ol className="kth-rp-days" aria-label={L.list}>
          {days.map((d, i) => {
            const n = i + 1;
            return (
              <li key={i} className="kth-rp-days__day">
                <span className="kth-rp-days__label">{L.day(n)}</span>
                <div className="kth-rp-days__passages">
                  {d.readings.length === 0 ? <span className="kth-rp-days__empty">{L.emptyDay}</span> : null}
                  {d.readings.map((r, k) => {
                    const name = fmt(r);
                    return (
                      <span key={k} className="kth-rp-days__chip">
                        {name}
                        <button type="button" className="kth-rp-days__chip-remove" aria-label={L.removePassage(name, n)} title={L.removePassage(name, n)}
                          onClick={() => removePassage(i, k)}>
                          <span aria-hidden="true">×</span>
                        </button>
                      </span>
                    );
                  })}
                  <div className="kth-rp-days__add">
                    {active === i ? (
                      <ReferencePicker
                        key={i}
                        id={pickerId(i)}
                        locale={locale}
                        dir={dir}
                        value={text}
                        onInputChange={setText}
                        showLabel={false}
                        showInvalidMessage
                        labels={{
                          label: L.addPassage(n), placeholder: L.addPassagePlaceholder, suggestions: L.addPassageSuggestions,
                          invalid: L.addPassageInvalid, count: L.addPassageCount,
                        }}
                        onChange={(v) => addPassage(i, v)}
                      />
                    ) : (
                      <button type="button" className="kth-link" aria-label={L.addPassage(n)} onClick={() => activate(i)}>
                        {`+ ${L.addPassageButton}`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="kth-rp-days__tools">
                  <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" aria-label={L.moveUp(n)} title={L.moveUp(n)}
                    disabled={i === 0} onClick={() => move(i, -1)}><span aria-hidden="true">↑</span></button>
                  <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" aria-label={L.moveDown(n)} title={L.moveDown(n)}
                    disabled={i === days.length - 1} onClick={() => move(i, 1)}><span aria-hidden="true">↓</span></button>
                  <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" aria-label={L.removeDay(n)} title={L.removeDay(n)}
                    onClick={() => removeDay(i)}><span aria-hidden="true">×</span></button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="kth-rp-days__footer">
        <button type="button" className="kth-btn" onClick={addDay}>{`+ ${L.addDay}`}</button>
      </div>
    </div>
  );
}
