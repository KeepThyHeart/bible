/**
 * Which questions make a quiz, and in what order. Pure and deterministic for a
 * given (candidates, history, request, seed, now).
 *
 * Rules (docs/features/quiz.md, "Selection"):
 *  1. Candidates overlap the scope and pass the kind/mode filters; a fixed
 *     difficulty keeps only that level (unrated counts as 2).
 *  2. Priority tiers: missed in the last 30 days, then never seen, then seen
 *     (oldest first). Questions answered correctly in the last 14 days come
 *     last and are used only when too few others remain. Ties: seeded random.
 *  3. Spread: round-robin over the scope's chapters, so a three-chapter
 *     reading does not give five questions from the first chapter.
 *  4. 'mixed' difficulty aims for 2:2:1 easy:medium:hard; a level that runs
 *     out is filled from the next easier level, then from any.
 *  5. At most one reflection (ungraded) question, last, when count >= 3.
 *  6. The graded questions are shown in the text's order.
 */
import type { QuizChoice, QuizDifficulty, QuizItemStat, QuizPassage, QuizQuestion, QuizRequest } from './types';
import { effectiveAnswerMode } from './grading';

export const DEFAULT_QUIZ_COUNT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
export const RECENT_MISS_DAYS = 30;
export const RECENT_CORRECT_DAYS = 14;

/** mulberry32: small, fast, good enough for shuffling. Returns [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy. */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function quizPrimaryPassage(q: QuizQuestion): QuizPassage {
  return q.passages.find((p) => p.primary) ?? q.passages[0] ?? { start: 0, end: 0 };
}

/** Chapter key (book*1000 + chapter) of a verse id. */
export function quizChapterOf(verseId: number): number {
  return Math.floor(verseId / 1000);
}

export function passagesOverlap(a: QuizPassage, b: QuizPassage): boolean {
  return a.start <= b.end && a.end >= b.start;
}

export function quizLevelOf(q: QuizQuestion): QuizDifficulty {
  return q.difficulty ?? 2;
}

/** Lower is asked sooner. */
export function priorityTier(stat: QuizItemStat | undefined, now: Date): number {
  if (!stat || stat.seen === 0) return 1;
  const ago = (iso: string | undefined) => (iso ? (now.getTime() - Date.parse(iso)) / DAY_MS : Infinity);
  if ((stat.lastResult === 'incorrect' || stat.lastResult === 'partly') && ago(stat.lastSeen) <= RECENT_MISS_DAYS) return 0;
  if (stat.lastResult === 'correct' && ago(stat.lastCorrect ?? stat.lastSeen) <= RECENT_CORRECT_DAYS) return 3;
  return 2;
}

interface Ranked {
  q: QuizQuestion;
  tier: number;
  /** Secondary order within the tier. */
  order: number;
  chapter: number;
}

/** Mixed-difficulty quotas for `n` graded questions, in the ratio 2:2:1. */
export function mixedQuotas(n: number): Record<QuizDifficulty, number> {
  const hard = Math.floor(n / 5);
  const rest = n - hard;
  const easy = Math.ceil(rest / 2);
  return { 1: easy, 2: rest - easy, 3: hard };
}

/** The fill order when a level runs out: the next easier level first, then any. */
const FALLBACK: Record<QuizDifficulty, QuizDifficulty[]> = { 1: [2, 3], 2: [1, 3], 3: [2, 1] };

export interface SelectionInput {
  candidates: QuizQuestion[];
  stats: Map<string, QuizItemStat>;
  request: QuizRequest;
  rand: () => number;
  now: Date;
}

/**
 * Picks the questions of a quiz, in display order. Does not shuffle choices
 * (see {@link shuffleChoices}).
 */
export function selectQuestions({ candidates, stats, request, rand, now }: SelectionInput): QuizQuestion[] {
  const count = Math.max(1, Math.floor(request.count ?? DEFAULT_QUIZ_COUNT));
  const only = request.onlyKeys ? new Set(request.onlyKeys) : null;
  const scope = request.passages;

  // Rule 1: candidates. De-duplicate by key (several sources may return one question).
  const byKey = new Map<string, QuizQuestion>();
  for (const q of candidates) {
    if (byKey.has(q.key)) continue;
    if (only && !only.has(q.key)) continue;
    if (scope.length > 0 && !q.passages.some((p) => scope.some((s) => passagesOverlap(p, s)))) continue;
    if (request.kinds?.length && !request.kinds.includes(q.kind)) continue;
    if (request.modes?.length && !request.modes.includes(q.mode)) continue;
    byKey.set(q.key, q);
  }
  const all = [...byKey.values()];
  const reflections = all.filter((q) => effectiveAnswerMode(q) === 'reflection');
  let graded = all.filter((q) => effectiveAnswerMode(q) !== 'reflection');
  const fixed = request.difficulty !== undefined && request.difficulty !== 'mixed' ? request.difficulty : null;
  if (fixed !== null) graded = graded.filter((q) => quizLevelOf(q) === fixed);

  // Rule 2: rank. Random tie-break order is drawn once per question in key
  // order, so the result does not depend on the order the sources returned.
  const sortedKeys = graded.map((q) => q.key).sort();
  const tieBreak = new Map(sortedKeys.map((k) => [k, rand()]));
  const ranked: Ranked[] = graded.map((q) => {
    const stat = stats.get(q.key);
    const tier = priorityTier(stat, now);
    // Tier 2 is oldest-seen first; a missing or bad date counts as oldest. Other tiers: random.
    const seenAt = stat?.lastSeen ? Date.parse(stat.lastSeen) : NaN;
    const order = tier === 2 ? (Number.isFinite(seenAt) ? seenAt : -Infinity) : tieBreak.get(q.key)!;
    return { q, tier, order, chapter: quizChapterOf(quizPrimaryPassage(q).start) };
  });
  ranked.sort((a, b) => a.tier - b.tier || a.order - b.order || (a.q.key < b.q.key ? -1 : 1));

  // Rule 5: reserve the last slot for one reflection.
  const wantReflection = (request.includeReflection ?? true) && count >= 3 && reflections.length > 0;
  const gradedCount = Math.min(wantReflection ? count - 1 : count, ranked.length);

  // Rule 3: one queue per chapter, chapters in scope order (then any others).
  const chapterOrder: number[] = [];
  const seen = new Set<number>();
  for (const s of scope) {
    for (let c = quizChapterOf(s.start); c <= quizChapterOf(s.end); c++) {
      if (!seen.has(c)) { seen.add(c); chapterOrder.push(c); }
    }
  }
  const queues = new Map<number, Ranked[]>();
  for (const r of ranked) {
    if (!queues.has(r.chapter)) {
      queues.set(r.chapter, []);
      if (!seen.has(r.chapter)) { seen.add(r.chapter); chapterOrder.push(r.chapter); }
    }
    queues.get(r.chapter)!.push(r);
  }
  // Recently-correct questions (tier 3) only after every chapter's better ones.
  const fresh = new Map<number, Ranked[]>();
  const stale = new Map<number, Ranked[]>();
  for (const [c, list] of queues) {
    fresh.set(c, list.filter((r) => r.tier < 3));
    stale.set(c, list.filter((r) => r.tier >= 3));
  }

  // Rule 4: quotas.
  const quotas: Record<QuizDifficulty, number> | null = fixed === null ? mixedQuotas(gradedCount) : null;
  const picked: Ranked[] = [];
  /** One round: at most one question per chapter, in chapter order. */
  const take = (pool: Map<number, Ranked[]>, fits: (r: Ranked) => boolean, onPick?: (r: Ranked) => void): boolean => {
    let progress = false;
    for (const c of chapterOrder) {
      if (picked.length >= gradedCount) break;
      const list = pool.get(c);
      if (!list) continue;
      const i = list.findIndex(fits);
      if (i < 0) continue;
      const [r] = list.splice(i, 1);
      picked.push(r);
      onPick?.(r);
      progress = true;
    }
    return progress;
  };
  const roundRobin = (pool: Map<number, Ranked[]>) => {
    if (quotas) {
      // Each level up to its quota.
      while (picked.length < gradedCount
        && take(pool, (r) => quotas[quizLevelOf(r.q)] > 0, (r) => { quotas[quizLevelOf(r.q)]--; })) { /* fill */ }
      // A level that ran out: its remaining slots go to the fallback levels, in order.
      for (const level of [3, 2, 1] as QuizDifficulty[]) {
        for (const alt of FALLBACK[level]) {
          while (picked.length < gradedCount && quotas[level] > 0
            && take(pool, (r) => quotas[level] > 0 && quizLevelOf(r.q) === alt, () => { quotas[level]--; })) { /* fill */ }
        }
      }
    }
    while (picked.length < gradedCount && take(pool, () => true)) { /* fill */ }
  };
  roundRobin(fresh);
  roundRobin(stale);

  // Rule 6: text order, reflection last.
  const result = picked
    .map((r) => r.q)
    .sort((a, b) => quizPrimaryPassage(a).start - quizPrimaryPassage(b).start || (a.key < b.key ? -1 : 1));
  if (wantReflection) {
    const rankedReflections = reflections
      .map((q) => ({ q, tier: priorityTier(stats.get(q.key), now), r: rand() }))
      .sort((a, b) => a.tier - b.tier || a.r - b.r);
    result.push(rankedReflections[0].q);
  }
  return result;
}

/** A shuffled copy of a question's choices (the correct one is tracked by its flag). */
export function shuffleChoices(q: QuizQuestion, rand: () => number): QuizChoice[] | undefined {
  return q.choices ? shuffled(q.choices, rand) : undefined;
}
