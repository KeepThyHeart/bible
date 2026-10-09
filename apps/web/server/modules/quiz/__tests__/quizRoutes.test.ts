import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { loadSchemaSql } from '@bible/core';
import { DatabaseManager } from '../../../DatabaseManager';
import { SqliteProvider } from '../../../providers/SqliteProvider';
import { createQuizRoutes } from '../routes';

const SCHEMAS = resolve(__dirname, '../../../../../../packages/core/sql/schemas/initial');

interface QuizSpec {
  abbr: string;
  uuid: string;
  /** [question_id, key, passage start, passage end, kind] */
  questions: Array<[number, string, number, number, string]>;
}

/** A data dir holding a real (empty) main.db and any number of installed quiz modules. */
function buildDataDir(specs: QuizSpec[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-routes-'));
  mkdirSync(join(dir, 'modules'));

  const main = new SqliteProvider(join(dir, 'main.db'));
  main.exec(loadSchemaSql(join(SCHEMAS, 'MainDatabase.sql')));

  for (const spec of specs) {
    const file = `quiz_${spec.abbr}.db`;
    const q = new SqliteProvider(join(dir, 'modules', file));
    q.exec(loadSchemaSql(join(SCHEMAS, 'Quiz.sql')));
    q.exec(`INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name, format, license_spdx)
      VALUES (1, '${spec.uuid}', 'quiz', '${spec.abbr}', 'Quiz ${spec.abbr}', 'quiz-module', 'CC-BY-SA-4.0');`);
    for (const [id, key, start, end, kind] of spec.questions) {
      q.exec(`INSERT INTO quiz_question (question_id, question_key, kind, answer_mode, prompt, answer, sort_order)
        VALUES (${id}, '${key}', '${kind}', 'free_response', 'Prompt ${key}', 'A', ${id});
        INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end, link_type, sort_order)
        VALUES ('quiz_question', ${id}, ${start}, ${end}, 'primary_passage', 0);`);
    }
    q.close();
    main.execute(
      `INSERT INTO module_metadata (module_uuid, module_type, module_name, abbreviation, database_path) VALUES (?, 'quiz', ?, ?, ?)`,
      [spec.uuid, `Quiz ${spec.abbr}`, spec.abbr, `modules/${file}`],
    );
  }
  main.close();
  return dir;
}

const A: QuizSpec = {
  abbr: 'QA',
  uuid: '00000000-0000-4000-8000-0000000000a1',
  questions: [
    [1, 'a:1', 41001001, 41001001, 'recall'],
    [2, 'a:2', 41001010, 41001012, 'comprehension'],
    [3, 'a:3', 41004001, 41004001, 'recall'],
  ],
};
const B: QuizSpec = {
  abbr: 'QB',
  uuid: '00000000-0000-4000-8000-0000000000b2',
  questions: [
    [1, 'a:1', 41001001, 41001001, 'recall'], // duplicate key: the first module wins
    [2, 'b:2', 41001020, 41001020, 'recall'],
  ],
};

describe('Quiz routes', () => {
  const dirs: string[] = [];
  const managers: DatabaseManager[] = [];

  function appFor(specs: QuizSpec[]): express.Express {
    const dir = buildDataDir(specs);
    dirs.push(dir);
    const db = new DatabaseManager(dir, dir);
    managers.push(db);
    const app = express();
    app.use('/api/quiz', createQuizRoutes(db));
    return app;
  }

  afterAll(() => {
    for (const m of managers) m.closeAll();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('returns the catalog with cache headers and an ETag', async () => {
    const app = appFor([A]);
    const res = await request(app).get('/api/quiz');
    expect(res.status).toBe(200);
    expect(res.body.modules).toHaveLength(1);
    expect(res.body.modules[0]).toMatchObject({ uuid: A.uuid, abbreviation: 'QA' });
    expect(res.body.coverage).toEqual([{ book: 41, chapter: 1, count: 2 }, { book: 41, chapter: 4, count: 1 }]);
    expect(res.headers['cache-control']).toContain('max-age');
    const again = await request(app).get('/api/quiz').set('If-None-Match', res.headers.etag);
    expect(again.status).toBe(304);
  });

  it('returns the questions overlapping the ranges', async () => {
    const app = appFor([A]);
    const res = await request(app).get('/api/quiz/questions?range=41001011-41001999');
    expect(res.status).toBe(200);
    expect(res.body.questions.map((q: { key: string }) => q.key)).toEqual(['a:2']);
    expect(res.headers['cache-control']).toBe('private, max-age=3600');

    const two = await request(app).get('/api/quiz/questions?range=41001001-41001001&range=41004999-41004001');
    expect(two.body.questions.map((q: { key: string }) => q.key)).toEqual(['a:1', 'a:3']);

    const kind = await request(app).get('/api/quiz/questions?range=41001001-41001999&kind=comprehension');
    expect(kind.body.questions.map((q: { key: string }) => q.key)).toEqual(['a:2']);
  });

  it('merges two modules; the first wins a duplicate key', async () => {
    const app = appFor([A, B]);
    const cat = await request(app).get('/api/quiz');
    expect(cat.body.modules).toHaveLength(2);
    const res = await request(app).get('/api/quiz/questions?range=41001001-41001999');
    const keys = res.body.questions.map((q: { key: string }) => q.key).sort();
    expect(keys).toEqual(['a:1', 'a:2', 'b:2']);
  });

  it('rejects bad ranges with 400', async () => {
    const app = appFor([A]);
    for (const qs of ['', '?range=abc', '?range=1-', '?range=0-5', '?range=-3-4', '?range=1-2-3', '?range=41001001-42001001', '?range=67001001-67001002', '?range=41151001-41151002', '?range=41000001-41000002']) {
      const res = await request(app).get(`/api/quiz/questions${qs}`);
      expect(res.status, qs).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
    }
    const many = Array.from({ length: 51 }, (_, i) => `range=${41001001 + i}-${41001001 + i}`).join('&');
    expect((await request(app).get(`/api/quiz/questions?${many}`)).status).toBe(400);
    const fifty = Array.from({ length: 50 }, (_, i) => `range=${41001001 + i}-${41001001 + i}`).join('&');
    expect((await request(app).get(`/api/quiz/questions?${fifty}`)).status).toBe(200);
  });

  it('answers 404 with a JSON error when no quiz module is installed', async () => {
    const app = appFor([]);
    const cat = await request(app).get('/api/quiz');
    expect(cat.status).toBe(404);
    expect(cat.body.error.code).toBe('NOT_FOUND');
    expect((await request(app).get('/api/quiz/questions?range=41001001-41001999')).status).toBe(404);
  });
});
