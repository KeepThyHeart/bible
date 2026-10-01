import type { ISql } from '../Core/ISql';
import type {
  QuizChapterCoverage,
  QuizChoice,
  QuizDataSource,
  QuizDifficulty,
  QuizFilter,
  QuizModuleInfo,
  QuizPassage,
  QuizQuestion,
  QuizQuestionPassage,
} from '../../Quiz/types';
import type { IQuizRepository } from './IQuizRepository';

interface QuestionRow {
  question_id: number;
  question_key: string;
  kind: string;
  answer_mode: string;
  difficulty: number | null;
  prompt: string;
  answer: string | null;
  choices: string | null;
  accepted: string | null;
  explanation: string | null;
  tags: string | null;
  source_id: string | null;
  review_status: string | null;
  sort_order: number;
  metadata: string | null;
}
interface LinkRow { source_id: number; verse_id_start: number; verse_id_end: number; link_type: string }
interface InfoRow {
  module_uuid: string; full_name: string; abbreviation: string | null; content_version: string | null;
  license_spdx: string | null; license_url: string | null; description: string | null; language_code: string | null;
  metadata: string | null;
}
interface SourceRow { id: string; name: string; licence: string; url: string | null; attribution: string | null }

const SOURCE_TYPE = 'quiz_question';
const QUESTION_COLUMNS = `question_id, question_key, kind, answer_mode, difficulty, prompt, answer, choices,
  accepted, explanation, tags, source_id, review_status, sort_order, metadata`;
/** SQLite's default bound-parameter limit is 999 (older builds); stay well below. */
const CHUNK = 400;

function parseJson(raw: string | null): unknown {
  if (raw === null || raw === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function stringArray(raw: string | null): string[] | undefined {
  const v = parseJson(raw);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}

function choiceArray(raw: string | null): QuizChoice[] | undefined {
  const v = parseJson(raw);
  if (!Array.isArray(v)) return undefined;
  const out: QuizChoice[] = [];
  for (const c of v) {
    if (c && typeof c === 'object' && typeof (c as QuizChoice).text === 'string') {
      out.push({ text: (c as QuizChoice).text, correct: (c as QuizChoice).correct === true });
    }
  }
  return out.length > 0 ? out : undefined;
}

function objectOf(raw: string | null): Record<string, unknown> | undefined {
  const v = parseJson(raw);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class QuizRepository implements IQuizRepository {
  private uuid: string | null = null;

  constructor(private readonly sql: ISql) {}

  getInfo(): QuizModuleInfo {
    const info = this.sql.queryOne<InfoRow>(
      `SELECT module_uuid, full_name, abbreviation, content_version, license_spdx, license_url, description,
              language_code, metadata
         FROM module_info WHERE info_id = 1`
    );
    let sources: QuizDataSource[] = [];
    try {
      sources = this.sql
        .queryAll<SourceRow>('SELECT id, name, licence, url, attribution FROM data_source ORDER BY id')
        .map((r) => ({
          id: r.id,
          name: r.name,
          licence: r.licence,
          ...(r.url ? { url: r.url } : {}),
          ...(r.attribution ? { attribution: r.attribution } : {}),
        }));
    } catch { /* a module without data_source: no attribution rows */ }
    const meta = objectOf(info?.metadata ?? null);
    const out: QuizModuleInfo = {
      uuid: info?.module_uuid ?? '',
      name: info?.full_name ?? 'Quiz',
      sources,
    };
    if (info?.abbreviation) out.abbreviation = info.abbreviation;
    if (info?.content_version) out.version = info.content_version;
    if (info?.license_spdx) out.license = info.license_spdx;
    if (info?.license_url) out.licenseUrl = info.license_url;
    if (info?.description) out.description = info.description;
    if (info?.language_code) out.languageCode = info.language_code;
    if (typeof meta?.textBasis === 'string') out.textBasis = meta.textBasis;
    this.uuid = out.uuid;
    return out;
  }

  getCoverage(): QuizChapterCoverage[] {
    // A question's chapter is that of its primary passage (or its first link).
    const rows = this.sql.queryAll<{ chapter_key: number; n: number }>(
      `WITH ranked AS (
         SELECT source_id, verse_id_start,
                ROW_NUMBER() OVER (PARTITION BY source_id
                                   ORDER BY (link_type = 'primary_passage') DESC, sort_order, link_id) AS rn
           FROM verse_link WHERE source_type = ?
       )
       SELECT verse_id_start / 1000 AS chapter_key, COUNT(*) AS n
         FROM ranked WHERE rn = 1 GROUP BY chapter_key ORDER BY chapter_key`,
      [SOURCE_TYPE]
    );
    return rows.map((r) => ({ book: Math.floor(r.chapter_key / 1000), chapter: r.chapter_key % 1000, count: r.n }));
  }

  getQuestions(passages: QuizPassage[], filter?: QuizFilter): QuizQuestion[] {
    if (filter?.moduleUuids?.length && !filter.moduleUuids.includes(this.moduleUuid())) return [];
    if (passages.length === 0) return [];
    const ids = new Set<number>();
    for (const p of passages) {
      for (const r of this.sql.queryAll<{ source_id: number }>(
        `SELECT DISTINCT source_id FROM verse_link
          WHERE source_type = ? AND verse_id_start <= ? AND verse_id_end >= ?`,
        [SOURCE_TYPE, Math.max(p.start, p.end), Math.min(p.start, p.end)]
      )) ids.add(r.source_id);
    }
    let questions = this.loadByIds([...ids]);
    if (filter?.kinds?.length) questions = questions.filter((q) => filter.kinds!.includes(q.kind));
    if (filter?.modes?.length) questions = questions.filter((q) => filter.modes!.includes(q.mode));
    return questions;
  }

  getQuestionsByKeys(keys: string[]): QuizQuestion[] {
    const ids: number[] = [];
    for (const part of chunks([...new Set(keys)], CHUNK)) {
      const rows = this.sql.queryAll<{ question_id: number }>(
        `SELECT question_id FROM quiz_question WHERE question_key IN (${part.map(() => '?').join(',')})`,
        part
      );
      ids.push(...rows.map((r) => r.question_id));
    }
    return this.loadByIds(ids);
  }

  private moduleUuid(): string {
    if (this.uuid === null) {
      this.uuid = this.sql.queryOne<{ module_uuid: string }>('SELECT module_uuid FROM module_info WHERE info_id = 1')?.module_uuid ?? '';
    }
    return this.uuid;
  }

  /** Questions with their passages, ordered by primary passage then sort_order. */
  private loadByIds(ids: number[]): QuizQuestion[] {
    if (ids.length === 0) return [];
    const origin = this.moduleUuid();
    const rows: QuestionRow[] = [];
    const links = new Map<number, QuizQuestionPassage[]>();
    for (const part of chunks(ids, CHUNK)) {
      const marks = part.map(() => '?').join(',');
      rows.push(...this.sql.queryAll<QuestionRow>(
        `SELECT ${QUESTION_COLUMNS} FROM quiz_question WHERE question_id IN (${marks})`, part
      ));
      for (const l of this.sql.queryAll<LinkRow>(
        `SELECT source_id, verse_id_start, verse_id_end, link_type FROM verse_link
          WHERE source_type = ? AND source_id IN (${marks})
          ORDER BY source_id, (link_type = 'primary_passage') DESC, sort_order, link_id`,
        [SOURCE_TYPE, ...part]
      )) {
        if (!links.has(l.source_id)) links.set(l.source_id, []);
        links.get(l.source_id)!.push({ start: l.verse_id_start, end: l.verse_id_end, primary: l.link_type === 'primary_passage' });
      }
    }
    const out: { q: QuizQuestion; id: number; order: number }[] = [];
    for (const r of rows) {
      const passages = links.get(r.question_id) ?? [];
      if (passages.length === 0) continue; // a question must be anchored to the text
      if (!passages.some((p) => p.primary)) passages[0] = { ...passages[0], primary: true };
      const q: QuizQuestion = {
        key: r.question_key,
        origin,
        passages,
        kind: r.kind,
        mode: r.answer_mode,
        prompt: r.prompt,
      };
      if (r.difficulty === 1 || r.difficulty === 2 || r.difficulty === 3) q.difficulty = r.difficulty as QuizDifficulty;
      if (r.answer !== null && r.answer !== '') q.answer = r.answer;
      const choices = choiceArray(r.choices);
      if (choices) q.choices = choices;
      const accepted = stringArray(r.accepted);
      if (accepted?.length) q.accepted = accepted;
      if (r.explanation) q.explanation = r.explanation;
      const tags = stringArray(r.tags);
      if (tags?.length) q.tags = tags;
      if (r.source_id) q.sourceId = r.source_id;
      if (r.review_status) q.reviewStatus = r.review_status;
      const metadata = objectOf(r.metadata);
      if (metadata) q.metadata = metadata;
      out.push({ q, id: r.question_id, order: r.sort_order });
    }
    return out
      .sort((a, b) => (a.q.passages[0].start - b.q.passages[0].start) || (a.order - b.order) || (a.id - b.id))
      .map((o) => o.q);
  }
}
