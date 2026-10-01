import { describe, it, expect } from 'vitest';
import {
  QuizEngine,
  MemoryQuizProgressStore,
  UserDataQuizProgressStore,
  QUIZ_OWNER,
  QUIZ_STATS_COLLECTION,
  MAX_QUIZ_SESSIONS,
  applyAttempt,
  chapterPassage,
  chaptersPassage,
  editDistance,
  effectiveAnswerMode,
  gradeResponse,
  matchShortAnswer,
  mergeCatalogs,
  mixedQuotas,
  normalizeAnswer,
  priorityTier,
  seededRandom,
  selectQuestions,
  summarizeQuiz,
  booksWithQuestions,
  chaptersWithQuestions,
  NO_READING_PLAN,
} from './index';
import type { IQuizAdjudicator, IQuizQuestionSource } from './ports';
import type { QuizItemStat, QuizQuestion } from './types';
import { MemoryUserDb } from '../UserData/MemoryUserDb';

const MARK = 41;
const v = (c: number, verse: number) => MARK * 1_000_000 + c * 1_000 + verse;

function q(key: string, chapter: number, verse: number, extra: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    key,
    passages: [{ start: v(chapter, verse), end: v(chapter, verse), primary: true }],
    kind: 'recall',
    mode: 'free_response',
    prompt: `Question ${key}?`,
    answer: `Answer ${key}`,
    ...extra,
  };
}

const mc = (key: string, c: number, verse: number, difficulty?: 1 | 2 | 3): QuizQuestion =>
  q(key, c, verse, {
    mode: 'multiple_choice',
    difficulty,
    answer: 'Right',
    choices: [{ text: 'Right', correct: true }, { text: 'Wrong 1', correct: false }, { text: 'Wrong 2', correct: false }, { text: 'Wrong 3', correct: false }],
  });

const reflection = (key: string, c: number, verse: number): QuizQuestion =>
  q(key, c, verse, { kind: 'application', mode: 'reflection', answer: undefined });

function source(questions: QuizQuestion[]): IQuizQuestionSource & { calls: number } {
  return {
    calls: 0,
    async getQuestions(passages) {
      this.calls++;
      return questions.filter((x) => x.passages.some((p) => passages.some((s) => p.start <= s.end && p.end >= s.start)));
    },
  };
}

const NOW = new Date('2026-10-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('grading', () => {
  it('normalises answers', () => {
    expect(normalizeAnswer('  The  Jordan! ')).toBe('jordan');
    expect(normalizeAnswer('Élie')).toBe('elie');
    expect(normalizeAnswer('an Hundred-fold')).toBe('hundred fold');
  });

  it('computes edit distance with transpositions', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('capernaum', 'capernuam')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('matches short answers exactly, by number word, or one typo for longer answers', () => {
    expect(matchShortAnswer('simon peter', ['Simon', 'Simon Peter'])).toBe('Simon Peter');
    expect(matchShortAnswer('Capernuam', ['Capernaum'])).toBe('Capernaum');
    expect(matchShortAnswer('Jamse', ['James'])).toBeUndefined(); // 5 letters: exact only
    expect(matchShortAnswer('twelve', ['12'])).toBe('12');
    expect(matchShortAnswer('12', ['twelve'])).toBe('twelve');
    expect(matchShortAnswer('', ['x'])).toBeUndefined();
  });

  it('degrades unknown or incomplete modes', () => {
    expect(effectiveAnswerMode(q('a', 1, 1, { mode: 'missing_word' }))).toBe('free_response');
    expect(effectiveAnswerMode(q('a', 1, 1, { mode: 'missing_word', answer: undefined }))).toBe('reflection');
    expect(effectiveAnswerMode(q('a', 1, 1, { mode: 'multiple_choice', choices: [] }))).toBe('free_response');
    expect(effectiveAnswerMode(q('a', 1, 1, { mode: 'short_answer', accepted: ['x'] }))).toBe('short_answer');
    expect(effectiveAnswerMode(mc('a', 1, 1))).toBe('multiple_choice');
  });

  it('grades each response type', () => {
    const m = mc('m', 1, 1);
    const shown = [m.choices![2], m.choices![0], m.choices![1], m.choices![3]];
    expect(gradeResponse(m, { type: 'choice', index: 1 }, shown)).toMatchObject({ result: 'correct', score: 1, expected: 'Right' });
    expect(gradeResponse(m, { type: 'choice', index: 0 }, shown)).toMatchObject({ result: 'incorrect', score: 0 });
    const s = q('s', 1, 1, { mode: 'short_answer', answer: 'Capernaum', accepted: ['Capernaum'] });
    expect(gradeResponse(s, { type: 'text', text: 'capernaum.' })).toMatchObject({ result: 'correct', matched: 'Capernaum' });
    expect(gradeResponse(s, { type: 'text', text: 'Bethsaida' })).toMatchObject({ result: 'incorrect', expected: 'Capernaum' });
    const f = q('f', 1, 1);
    expect(gradeResponse(f, { type: 'text', text: 'whatever' })).toMatchObject({ result: 'ungraded', needsSelfGrade: true });
    expect(gradeResponse(f, { type: 'self', result: 'partly' })).toMatchObject({ result: 'partly', score: 0.5 });
    expect(gradeResponse(reflection('r', 1, 1), { type: 'reflection', text: 'hm' })).toMatchObject({ result: 'ungraded', score: 0 });
    expect(gradeResponse(f, { type: 'skip' })).toMatchObject({ result: 'skipped' });
  });
});

describe('selection', () => {
  it('splits mixed difficulty 2:2:1', () => {
    expect(mixedQuotas(5)).toEqual({ 1: 2, 2: 2, 3: 1 });
    expect(mixedQuotas(4)).toEqual({ 1: 2, 2: 2, 3: 0 });
    expect(mixedQuotas(10)).toEqual({ 1: 4, 2: 4, 3: 2 });
  });

  it('ranks missed, then unseen, then seen, then recently correct', () => {
    const stat = (extra: Partial<QuizItemStat>): QuizItemStat => ({ key: 'k', seen: 1, correct: 0, partly: 0, missed: 0, ...extra });
    expect(priorityTier(stat({ lastResult: 'incorrect', lastSeen: daysAgo(3) }), NOW)).toBe(0);
    expect(priorityTier(undefined, NOW)).toBe(1);
    expect(priorityTier(stat({ lastResult: 'incorrect', lastSeen: daysAgo(40) }), NOW)).toBe(2);
    expect(priorityTier(stat({ lastResult: 'correct', lastSeen: daysAgo(20), lastCorrect: daysAgo(20) }), NOW)).toBe(2);
    expect(priorityTier(stat({ lastResult: 'correct', lastSeen: daysAgo(2), lastCorrect: daysAgo(2) }), NOW)).toBe(3);
  });

  it('is deterministic for a seed and independent of source order', () => {
    const qs = Array.from({ length: 30 }, (_, i) => mc(`k${i}`, 1 + (i % 3), i + 1, ((i % 3) + 1) as 1 | 2 | 3));
    const request = { passages: [chaptersPassage(MARK, 1, 3)], count: 6 };
    const a = selectQuestions({ candidates: qs, stats: new Map(), request, rand: seededRandom(7), now: NOW });
    const b = selectQuestions({ candidates: [...qs].reverse(), stats: new Map(), request, rand: seededRandom(7), now: NOW });
    expect(a.map((x) => x.key)).toEqual(b.map((x) => x.key));
    const c = selectQuestions({ candidates: qs, stats: new Map(), request, rand: seededRandom(8), now: NOW });
    expect(c.map((x) => x.key)).not.toEqual(a.map((x) => x.key));
  });

  it('spreads questions round-robin over the chapters and keeps text order', () => {
    const qs = [
      ...Array.from({ length: 10 }, (_, i) => mc(`a${i}`, 1, i + 1, 1)),
      mc('b0', 2, 1, 1), mc('b1', 2, 2, 1),
      mc('c0', 3, 1, 1),
    ];
    const got = selectQuestions({
      candidates: qs, stats: new Map(), rand: seededRandom(1), now: NOW,
      request: { passages: [chaptersPassage(MARK, 1, 3)], count: 5, difficulty: 1 },
    });
    const chapters = got.map((x) => Math.floor(x.passages[0].start / 1000) % 1000);
    expect(chapters.filter((c) => c === 2)).toHaveLength(2);
    expect(chapters.filter((c) => c === 3)).toHaveLength(1);
    expect(chapters.filter((c) => c === 1)).toHaveLength(2);
    expect([...chapters]).toEqual([...chapters].sort((x, y) => x - y));
  });

  it('honours mixed quotas and falls back to the next easier level', () => {
    const qs = [
      ...Array.from({ length: 6 }, (_, i) => mc(`e${i}`, 1, i + 1, 1)),
      ...Array.from({ length: 6 }, (_, i) => mc(`m${i}`, 1, i + 11, 2)),
      // no hard questions at all
    ];
    const got = selectQuestions({
      candidates: qs, stats: new Map(), rand: seededRandom(3), now: NOW,
      request: { passages: [chapterPassage(MARK, 1)], count: 5 },
    });
    expect(got).toHaveLength(5);
    const levels = got.map((x) => x.difficulty);
    expect(levels.filter((l) => l === 1)).toHaveLength(2);
    expect(levels.filter((l) => l === 2)).toHaveLength(3); // hard slot filled from medium
  });

  it('treats unrated questions as medium', () => {
    const qs = [q('u1', 1, 1), q('u2', 1, 2), mc('e', 1, 3, 1), mc('h', 1, 4, 3)];
    const got = selectQuestions({
      candidates: qs, stats: new Map(), rand: seededRandom(1), now: NOW,
      request: { passages: [chapterPassage(MARK, 1)], count: 2, difficulty: 2 },
    });
    expect(got.map((x) => x.key).sort()).toEqual(['u1', 'u2']);
  });

  it('puts one reflection last, only for quizzes of three or more', () => {
    const qs = [mc('a', 1, 1, 1), mc('b', 1, 2, 2), mc('c', 1, 3, 1), reflection('r1', 1, 4), reflection('r2', 1, 5)];
    const got = selectQuestions({
      candidates: qs, stats: new Map(), rand: seededRandom(1), now: NOW,
      request: { passages: [chapterPassage(MARK, 1)], count: 4 },
    });
    expect(got).toHaveLength(4);
    expect(got[3].mode).toBe('reflection');
    expect(got.filter((x) => x.mode === 'reflection')).toHaveLength(1);
    const two = selectQuestions({
      candidates: qs, stats: new Map(), rand: seededRandom(1), now: NOW,
      request: { passages: [chapterPassage(MARK, 1)], count: 2 },
    });
    expect(two.some((x) => x.mode === 'reflection')).toBe(false);
    const none = selectQuestions({
      candidates: qs, stats: new Map(), rand: seededRandom(1), now: NOW,
      request: { passages: [chapterPassage(MARK, 1)], count: 4, includeReflection: false },
    });
    expect(none.some((x) => x.mode === 'reflection')).toBe(false);
  });

  it('asks recently missed first and recently correct last', () => {
    const qs = [mc('a', 1, 1, 1), mc('b', 1, 2, 1), mc('c', 1, 3, 1), mc('d', 1, 4, 1)];
    const stats = new Map<string, QuizItemStat>([
      ['a', { key: 'a', seen: 1, correct: 1, partly: 0, missed: 0, lastResult: 'correct', lastSeen: daysAgo(1), lastCorrect: daysAgo(1) }],
      ['b', { key: 'b', seen: 1, correct: 1, partly: 0, missed: 0, lastResult: 'correct', lastSeen: daysAgo(1), lastCorrect: daysAgo(1) }],
      ['c', { key: 'c', seen: 1, correct: 0, partly: 0, missed: 1, lastResult: 'incorrect', lastSeen: daysAgo(1) }],
    ]);
    const got = selectQuestions({
      candidates: qs, stats, rand: seededRandom(1), now: NOW,
      request: { passages: [chapterPassage(MARK, 1)], count: 2, difficulty: 1 },
    });
    expect(got.map((x) => x.key)).toEqual(['c', 'd']);
    // Too few others: recently correct ones fill in.
    const more = selectQuestions({
      candidates: qs, stats, rand: seededRandom(1), now: NOW,
      request: { passages: [chapterPassage(MARK, 1)], count: 4, difficulty: 1, includeReflection: false },
    });
    expect(more).toHaveLength(4);
  });

  it('filters by scope, kind, mode and onlyKeys, and de-duplicates keys', () => {
    const qs = [mc('a', 1, 1, 1), mc('a', 1, 1, 1), q('b', 2, 1, { kind: 'comprehension' }), mc('c', 5, 1, 1)];
    const base = { stats: new Map(), rand: seededRandom(1), now: NOW };
    const scope = [chaptersPassage(MARK, 1, 2)];
    expect(selectQuestions({ ...base, candidates: qs, request: { passages: scope, count: 10 } }).map((x) => x.key)).toEqual(['a', 'b']);
    expect(selectQuestions({ ...base, candidates: qs, request: { passages: scope, kinds: ['comprehension'] } }).map((x) => x.key)).toEqual(['b']);
    expect(selectQuestions({ ...base, candidates: qs, request: { passages: scope, modes: ['multiple_choice'] } }).map((x) => x.key)).toEqual(['a']);
    expect(selectQuestions({ ...base, candidates: qs, request: { passages: scope, onlyKeys: ['b'] } }).map((x) => x.key)).toEqual(['b']);
  });
});

describe('QuizEngine', () => {
  const questions = [
    mc('m1', 1, 1, 1), mc('m2', 1, 5, 2), mc('m3', 2, 1, 1), mc('m4', 2, 9, 2), mc('m5', 3, 2, 3),
    q('f1', 3, 4, { difficulty: 1 }), reflection('r1', 3, 9),
  ];

  it('builds a deterministic quiz with shuffled choice copies', async () => {
    const engine = new QuizEngine(source(questions), new MemoryQuizProgressStore(), { now: () => NOW });
    const quiz = await engine.buildQuiz({ passages: [chaptersPassage(MARK, 1, 3)], label: 'Mark 1-3', count: 5, seed: 42 });
    const again = await engine.buildQuiz({ passages: [chaptersPassage(MARK, 1, 3)], label: 'Mark 1-3', count: 5, seed: 42 });
    expect(quiz.items.map((i) => i.question.key)).toEqual(again.items.map((i) => i.question.key));
    expect(quiz.items).toHaveLength(5);
    expect(quiz.items[4].question.key).toBe('r1');
    expect(quiz).toMatchObject({ label: 'Mark 1-3', seed: 42, createdAt: NOW.toISOString() });
    const withChoices = quiz.items.filter((i) => i.choices);
    expect(withChoices.length).toBeGreaterThan(0);
    for (const it of withChoices) {
      expect(it.choices).toHaveLength(4);
      expect(it.choices!.filter((c) => c.correct)).toHaveLength(1);
      expect(it.choices).not.toBe(it.question.choices);
    }
    expect(quiz.items.find((i) => i.question.key === 'f1')?.choices).toBeUndefined();
  });

  it('merges several sources, first source winning a key', async () => {
    const a = source([mc('x', 1, 1, 1)]);
    const b = source([{ ...mc('x', 1, 1, 1), prompt: 'other' }, mc('y', 1, 2, 1)]);
    const engine = new QuizEngine([a, b], new MemoryQuizProgressStore(), { now: () => NOW });
    const c = await engine.candidates({ passages: [chapterPassage(MARK, 1)] });
    expect(c.map((x) => x.key)).toEqual(['x', 'y']);
    expect(c[0].prompt).toBe('Question x?');
  });

  it('records graded answers and sessions, then rotates', async () => {
    const store = new MemoryQuizProgressStore();
    const engine = new QuizEngine(source(questions), store, { now: () => NOW });
    const quiz = await engine.buildQuiz({ passages: [chaptersPassage(MARK, 1, 3)], count: 3, seed: 1, includeReflection: false });
    const grades = quiz.items.map((it, i) =>
      engine.grade(it.question, i === 0 ? { type: 'self', result: 'incorrect' } : { type: 'self', result: 'correct' }));
    for (const g of grades) await engine.recordGrade(g, quiz.id);
    await engine.recordGrade({ key: 'r1', result: 'ungraded', score: 0 });
    const summary = await engine.finish(quiz, grades);
    expect(summary).toMatchObject({ total: 3, graded: 3, correct: 2, partly: 0, missedKeys: [quiz.items[0].question.key] });
    expect(summary.score).toBeCloseTo(2 / 3);
    expect((await store.listSessions()).map((s) => s.id)).toEqual([quiz.id]);
    const stats = await store.getStats(['r1', quiz.items[0].question.key]);
    expect(stats.has('r1')).toBe(false);
    expect(stats.get(quiz.items[0].question.key)).toMatchObject({ seen: 1, missed: 1, lastResult: 'incorrect' });

    // The missed one comes back first; the two correct ones are held back.
    const next = await engine.buildQuiz({ passages: [chaptersPassage(MARK, 1, 3)], count: 2, seed: 9, includeReflection: false });
    const keys = next.items.map((i) => i.question.key);
    expect(keys).toContain(quiz.items[0].question.key);
    for (const g of grades.slice(1)) expect(keys).not.toContain(g.key);
  });

  it('retries a subset with re-shuffled choices', async () => {
    const engine = new QuizEngine(source(questions), new MemoryQuizProgressStore(), { now: () => NOW });
    const quiz = await engine.buildQuiz({ passages: [chaptersPassage(MARK, 1, 3)], count: 5, seed: 5 });
    const retry = engine.retry(quiz, [quiz.items[0].question.key]);
    expect(retry.items.map((i) => i.question.key)).toEqual([quiz.items[0].question.key]);
    expect(retry.id).not.toBe(quiz.id);
  });

  it('offers adjudication only when an adjudicator is configured', async () => {
    const plain = new QuizEngine(source(questions), new MemoryQuizProgressStore());
    expect(plain.canAdjudicate(questions[5])).toBe(false);
    await expect(plain.adjudicate(questions[5], 'x')).rejects.toThrow('No quiz adjudicator');
    const seen: unknown[] = [];
    const judge: IQuizAdjudicator = {
      id: 'test',
      adjudicate: async (req) => { seen.push(req); return { result: 'partly', score: 0.6, adjudicator: 'test' }; },
    };
    const engine = new QuizEngine(source(questions), new MemoryQuizProgressStore(), { adjudicator: judge });
    expect(engine.canAdjudicate(questions[5])).toBe(true);
    expect(engine.canAdjudicate(questions[0])).toBe(false); // multiple choice
    expect(engine.canAdjudicate(questions[6])).toBe(false); // reflection
    await expect(engine.adjudicate(questions[5], 'my words', { reference: 'Mark 3:4' })).resolves.toMatchObject({ score: 0.6 });
    expect(seen[0]).toMatchObject({ response: 'my words', expected: 'Answer f1', context: { reference: 'Mark 3:4' } });
  });

  it('summarises an empty or partly answered quiz', () => {
    const quiz = { id: 'q', passages: [], createdAt: '', seed: 1, items: [{ question: questions[0] }, { question: questions[1] }] };
    expect(summarizeQuiz(quiz, [], NOW)).toMatchObject({ total: 2, graded: 0, score: 0, missedKeys: [] });
  });
});

describe('progress stores', () => {
  it('applies attempts to stats', () => {
    let s = applyAttempt(undefined, { key: 'k', result: 'correct', at: daysAgo(2) });
    s = applyAttempt(s, { key: 'k', result: 'partly', at: daysAgo(1) });
    expect(s).toEqual({ key: 'k', seen: 2, correct: 1, partly: 1, missed: 0, lastSeen: daysAgo(1), lastResult: 'partly', lastCorrect: daysAgo(2) });
  });

  it('keeps stats and capped sessions in user_data_item', async () => {
    const db = new MemoryUserDb();
    const store = new UserDataQuizProgressStore(db.items);
    await store.recordAttempt({ key: 'kth:MRK:1:01', result: 'incorrect', at: daysAgo(1) });
    await store.recordAttempt({ key: 'kth:MRK:1:01', result: 'correct', at: daysAgo(0) });
    const stats = await store.getStats(['kth:MRK:1:01', 'other']);
    expect(stats.get('kth:MRK:1:01')).toMatchObject({ seen: 2, correct: 1, missed: 1, lastResult: 'correct' });
    expect(stats.has('other')).toBe(false);
    const raw = db.items.get(QUIZ_OWNER, QUIZ_STATS_COLLECTION, 'kth:MRK:1:01');
    expect(JSON.parse(raw!.value!)).not.toHaveProperty('key');

    // Many keys: the collection-scan path.
    const many = Array.from({ length: 30 }, (_, i) => `k${i}`).concat('kth:MRK:1:01');
    expect((await store.getStats(many)).size).toBe(1);

    for (let i = 0; i < MAX_QUIZ_SESSIONS + 3; i++) {
      await store.recordSession({
        id: `s${i}`, date: new Date(NOW.getTime() + i * 1000).toISOString(), passages: [], total: 1, graded: 1,
        correct: 1, partly: 0, score: 1, missedKeys: [],
      });
    }
    const sessions = await store.listSessions(MAX_QUIZ_SESSIONS + 10);
    expect(sessions).toHaveLength(MAX_QUIZ_SESSIONS);
    expect(sessions[0].id).toBe(`s${MAX_QUIZ_SESSIONS + 2}`);
    expect((await store.listSessions(2)).map((s) => s.id)).toEqual([`s${MAX_QUIZ_SESSIONS + 2}`, `s${MAX_QUIZ_SESSIONS + 1}`]);
  });

  it('skips corrupt rows', async () => {
    const db = new MemoryUserDb();
    const store = new UserDataQuizProgressStore(db.items);
    await store.recordAttempt({ key: 'a', result: 'correct', at: daysAgo(0) });
    const item = db.items.get(QUIZ_OWNER, QUIZ_STATS_COLLECTION, 'a')!;
    item.value = '{not json';
    db.items.put(item);
    expect((await store.getStats(['a'])).size).toBe(0);
  });
});

describe('scope helpers', () => {
  it('builds chapter passages and reads catalogs', async () => {
    expect(chapterPassage(41, 4)).toEqual({ start: 41004001, end: 41004999 });
    expect(chaptersPassage(41, 3, 1)).toEqual({ start: 41001001, end: 41003999 });
    const merged = mergeCatalogs([
      { modules: [{ uuid: 'a', name: 'A', sources: [] }], coverage: [{ book: 41, chapter: 2, count: 1 }, { book: 40, chapter: 1, count: 2 }] },
      { modules: [{ uuid: 'a', name: 'A', sources: [] }, { uuid: 'b', name: 'B', sources: [] }], coverage: [{ book: 41, chapter: 2, count: 3 }] },
    ]);
    expect(merged.modules.map((m) => m.uuid)).toEqual(['a', 'b']);
    expect(merged.coverage).toEqual([{ book: 40, chapter: 1, count: 2 }, { book: 41, chapter: 2, count: 4 }]);
    expect(booksWithQuestions(merged)).toEqual([40, 41]);
    expect(chaptersWithQuestions(merged, 41)).toEqual([2]);
    expect(await NO_READING_PLAN.getTodaysReading('2026-10-01')).toBeNull();
  });
});
