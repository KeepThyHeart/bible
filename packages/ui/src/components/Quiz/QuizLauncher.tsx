/** Choose what to quiz (today's reading, this chapter, or a passage), how many questions and how hard. */
import { useState } from 'react';
import {
  booksWithQuestions,
  chapterPassage,
  chaptersPassage,
  chaptersWithQuestions,
  getBookName,
} from '@bible/core/browser';
import type { QuizCatalog, QuizPassage, QuizRequest, QuizScope, QuizSessionSummary } from '@bible/core/browser';
import { cx, defaultQuizReference, fillLabel, mergeQuizLabels } from './labels';
import { QuizSources } from './QuizSources';
import type { QuizLabels } from './types';

export interface QuizLauncherProps {
  catalog: QuizCatalog;
  onStart: (request: QuizRequest) => void;
  currentChapter?: { book: number; chapter: number } | null;
  todaysReading?: QuizScope | null;
  bookName?: (book: number) => string;
  formatReference?: (start: number, end?: number) => string;
  history?: QuizSessionSummary[];
  /** Question counts offered. Default [5, 10, 20]. */
  counts?: number[];
  /** Disables Start while a quiz is being built. */
  busy?: boolean;
  /** A message under the options, e.g. "No questions for Mark 4 yet." */
  notice?: string | null;
  labels?: Partial<QuizLabels>;
  className?: string;
}

type ScopeKind = 'today' | 'chapter' | 'passage';
type Difficulty = NonNullable<QuizRequest['difficulty']>;

/** Questions in the catalog whose chapter overlaps any of the passages. */
function countFor(catalog: QuizCatalog, passages: QuizPassage[]): number {
  let n = 0;
  for (const c of catalog.coverage) {
    const lo = c.book * 1_000_000 + c.chapter * 1_000 + 1;
    const hi = lo + 998;
    if (passages.some((p) => p.start <= hi && p.end >= lo)) n += c.count;
  }
  return n;
}

export function QuizLauncher({
  catalog,
  onStart,
  currentChapter,
  todaysReading,
  bookName,
  formatReference,
  history,
  counts = [5, 10, 20],
  busy,
  notice,
  labels,
  className,
}: QuizLauncherProps) {
  const l = mergeQuizLabels(labels);
  const name = bookName ?? getBookName;
  const fmt = formatReference ?? defaultQuizReference(bookName);

  const books = booksWithQuestions(catalog);
  const chapterHasQuestions = currentChapter
    ? chaptersWithQuestions(catalog, currentChapter.book).includes(currentChapter.chapter)
    : false;
  const chapterScope: QuizScope | null =
    currentChapter && chapterHasQuestions
      ? {
          label: fmt(chapterPassage(currentChapter.book, currentChapter.chapter).start, chapterPassage(currentChapter.book, currentChapter.chapter).end),
          passages: [chapterPassage(currentChapter.book, currentChapter.chapter)],
        }
      : null;
  const missingChapterLabel =
    currentChapter && !chapterHasQuestions
      ? fmt(chapterPassage(currentChapter.book, currentChapter.chapter).start, chapterPassage(currentChapter.book, currentChapter.chapter).end)
      : null;

  const [scopeChoice, setScopeChoice] = useState<ScopeKind | null>(null);
  const [bookChoice, setBookChoice] = useState<number | null>(null);
  const [fromChoice, setFromChoice] = useState<number | null>(null);
  const [toChoice, setToChoice] = useState<number | null>(null);
  const [count, setCount] = useState<number>(counts.includes(10) ? 10 : (counts[0] ?? 5));
  const [difficulty, setDifficulty] = useState<Difficulty>('mixed');

  const available: ScopeKind[] = [];
  if (todaysReading) available.push('today');
  if (chapterScope) available.push('chapter');
  available.push('passage');
  const scope: ScopeKind = scopeChoice && available.includes(scopeChoice) ? scopeChoice : available[0];

  const book = bookChoice !== null && books.includes(bookChoice) ? bookChoice : (books[0] ?? 0);
  const chapters = chaptersWithQuestions(catalog, book);
  const from = fromChoice !== null && chapters.includes(fromChoice) ? fromChoice : (chapters[0] ?? 1);
  const to = toChoice !== null && chapters.includes(toChoice) ? toChoice : from;

  let passages: QuizPassage[];
  let label: string;
  if (scope === 'today' && todaysReading) {
    passages = todaysReading.passages;
    label = todaysReading.label;
  } else if (scope === 'chapter' && chapterScope) {
    passages = chapterScope.passages;
    label = chapterScope.label;
  } else {
    const p = chaptersPassage(book, from, to);
    passages = [p];
    label = fmt(p.start, p.end);
  }
  const available_count = countFor(catalog, passages);

  const start = () => {
    onStart({ passages, label, count, difficulty });
  };

  const scopeOption = (kind: ScopeKind, text: string) => (
    <label className="kth-quiz__option">
      <input type="radio" name="kth-quiz-scope" checked={scope === kind} onChange={() => setScopeChoice(kind)} />
      <span>{text}</span>
    </label>
  );

  const difficulties: Array<[Difficulty, string]> = [
    ['mixed', l.difficultyMixed],
    [1, l.difficultyEasy],
    [2, l.difficultyMedium],
    [3, l.difficultyHard],
  ];

  return (
    <div className={cx('kth-quiz__launcher', className)}>
      <h2 className="kth-quiz__title">{l.title}</h2>
      <p className="kth-quiz__intro">{l.intro}</p>

      <fieldset className="kth-fieldset kth-quiz__fieldset">
        <legend>{l.scopeHeading}</legend>
        {todaysReading ? scopeOption('today', fillLabel(l.scopeToday, { label: todaysReading.label })) : null}
        {chapterScope ? scopeOption('chapter', fillLabel(l.scopeChapter, { label: chapterScope.label })) : null}
        {scopeOption('passage', l.scopePassage)}
        {missingChapterLabel ? (
          <p className="kth-quiz__small">{fillLabel(l.noQuestionsHere, { label: missingChapterLabel })}</p>
        ) : null}

        {scope === 'passage' ? (
          <div className="kth-quiz__passage">
            <label className="kth-field">
              <span>{l.book}</span>
              <select
                className="kth-select"
                value={book}
                onChange={(e) => {
                  setBookChoice(Number(e.currentTarget.value));
                  setFromChoice(null);
                  setToChoice(null);
                }}
              >
                {books.map((b) => (
                  <option key={b} value={b}>
                    {name(b)}
                  </option>
                ))}
              </select>
            </label>
            <label className="kth-field">
              <span>{l.fromChapter}</span>
              <select
                className="kth-select"
                value={from}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  setFromChoice(v);
                  if (to < v) setToChoice(v);
                }}
              >
                {chapters.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="kth-field">
              <span>{l.toChapter}</span>
              <select
                className="kth-select"
                value={to}
                onChange={(e) => setToChoice(Number(e.currentTarget.value))}
              >
                {chapters
                  .filter((c) => c >= from)
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ) : null}
        <p className="kth-quiz__small kth-quiz__available">{fillLabel(l.questionsAvailable, { count: available_count })}</p>
      </fieldset>

      <fieldset className="kth-fieldset kth-quiz__fieldset">
        <legend>{l.countHeading}</legend>
        <div className="kth-quiz__segments">
          {counts.map((n) => (
            <label key={n} className={cx('kth-quiz__segment', count === n && 'kth-quiz__segment--on')}>
              <input type="radio" name="kth-quiz-count" className="kth-quiz__segment-input" checked={count === n} onChange={() => setCount(n)} />
              <span>{n}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="kth-field">
        <span>{l.difficultyHeading}</span>
        <select
          className="kth-select"
          value={String(difficulty)}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setDifficulty(v === 'mixed' ? 'mixed' : (Number(v) as 1 | 2 | 3));
          }}
        >
          {difficulties.map(([v, text]) => (
            <option key={String(v)} value={String(v)}>
              {text}
            </option>
          ))}
        </select>
      </label>

      {notice ? <p className="kth-quiz__notice" role="alert">{notice}</p> : null}

      <div className="kth-quiz__actions">
        <button type="button" className="kth-btn kth-btn--primary" disabled={busy || available_count === 0} onClick={start}>
          {l.start}
        </button>
      </div>

      {history && history.length > 0 ? (
        <section className="kth-quiz__history" aria-label={l.historyHeading}>
          <h3 className="kth-quiz__subtitle">{l.historyHeading}</h3>
          <ul className="kth-quiz__history-list">
            {history.slice(0, 5).map((h) => (
              <li key={h.id + h.date}>
                {fillLabel(l.historyEntry, {
                  label: h.label ?? (h.passages[0] ? fmt(h.passages[0].start, h.passages[0].end) : ''),
                  correct: h.correct,
                  graded: h.graded,
                  date: new Date(h.date).toLocaleDateString(),
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <QuizSources modules={catalog.modules} labels={labels} />
    </div>
  );
}
