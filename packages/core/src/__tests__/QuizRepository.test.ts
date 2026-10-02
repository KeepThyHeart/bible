import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { QuizRepository } from '../Data/Repositories/QuizRepository';
import { SqliteModuleRepositoryFactory } from '../Data/Access/SqliteModuleRepositoryFactory';
import { moduleRepositoryTypeFor } from '../Data/Access/ModuleRepositoryFactory';
import { loadSchemaSql } from '../Data/Schema/loadSchemaSql';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';

const SCHEMA = join(__dirname, '..', '..', 'sql', 'schemas', 'initial', 'Quiz.sql');
const UUID = '00000000-0000-4000-8000-0000000000a1';

function buildModule(): TestSqliteProvider {
  const provider = new TestSqliteProvider(':memory:');
  provider.exec(loadSchemaSql(SCHEMA));
  provider.exec(`
    INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name, format, license_spdx, metadata)
      VALUES (1, '${UUID}', 'quiz', 'QZ', 'Test Quiz', 'quiz-module', 'CC-BY-SA-4.0', '{"textBasis":"KJV"}');
    INSERT INTO data_source (id, name, licence, url, attribution) VALUES
      ('kth', 'KTH questions', 'CC BY-SA 4.0', NULL, 'KTH'),
      ('uw-tq', 'unfoldingWord Translation Questions', 'CC BY-SA 4.0', 'https://example.org', 'unfoldingWord');
    INSERT INTO quiz_question (question_id, question_key, kind, answer_mode, difficulty, prompt, answer, choices, accepted, explanation, tags, source_id, review_status, sort_order, metadata) VALUES
      (1, 'kth:MRK:1:01', 'recall', 'multiple_choice', 1, 'What did John eat?', 'Locusts and wild honey',
         '[{"text":"Locusts and wild honey","correct":true},{"text":"Bread","correct":false}]', NULL, 'Mark 1:6', '["john"]', 'kth', 'unreviewed', 2, '{"note":"x"}'),
      (2, 'tq:MRK:g2v6', 'recall', 'free_response', NULL, 'What did John preach?', 'Repentance', NULL, NULL, NULL, NULL, 'uw-tq', NULL, 1, NULL),
      (3, 'kth:MRK:4:01', 'recall', 'short_answer', 2, 'Where did Jesus sit?', 'In a ship', NULL, '["ship","a ship"]', NULL, NULL, 'kth', NULL, 3, 'not json'),
      (4, 'kth:MRK:4:99', 'application', 'reflection', NULL, 'Which soil are you?', NULL, NULL, NULL, NULL, NULL, 'kth', NULL, 4, NULL),
      (5, 'orphan', 'recall', 'free_response', NULL, 'No passage', 'x', NULL, NULL, NULL, NULL, NULL, NULL, 5, NULL);
    INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end, link_type, sort_order) VALUES
      ('quiz_question', 1, 41001006, 41001006, 'primary_passage', 0),
      ('quiz_question', 1, 40003004, 40003004, 'reference', 1),
      ('quiz_question', 2, 41001004, 41001004, 'primary_passage', 0),
      ('quiz_question', 3, 41004001, 41004001, 'reference', 0),
      ('quiz_question', 4, 41004003, 41004020, 'primary_passage', 0),
      ('timeline_item', 1, 41004001, 41004001, 'primary_passage', 0);
  `);
  return provider;
}

describe('QuizRepository', () => {
  it('reads module info with its data sources and text basis', () => {
    const p = buildModule();
    const info = new QuizRepository(p).getInfo();
    expect(info).toMatchObject({ uuid: UUID, name: 'Test Quiz', abbreviation: 'QZ', license: 'CC-BY-SA-4.0', textBasis: 'KJV' });
    expect(info.sources.map((s) => s.id)).toEqual(['kth', 'uw-tq']);
    expect(info.sources[1]).toMatchObject({ url: 'https://example.org', attribution: 'unfoldingWord' });
    p.close();
  });

  it('counts questions per chapter by primary passage (falling back to the first link)', () => {
    const p = buildModule();
    expect(new QuizRepository(p).getCoverage()).toEqual([
      { book: 41, chapter: 1, count: 2 },
      { book: 41, chapter: 4, count: 2 },
    ]);
    p.close();
  });

  it('finds questions overlapping a passage, in text order, with parsed JSON columns', () => {
    const p = buildModule();
    const repo = new QuizRepository(p);
    const ch1 = repo.getQuestions([{ start: 41001001, end: 41001999 }]);
    expect(ch1.map((q) => q.key)).toEqual(['tq:MRK:g2v6', 'kth:MRK:1:01']);
    const mc = ch1[1];
    expect(mc).toMatchObject({
      origin: UUID, kind: 'recall', mode: 'multiple_choice', difficulty: 1, answer: 'Locusts and wild honey',
      explanation: 'Mark 1:6', tags: ['john'], sourceId: 'kth', reviewStatus: 'unreviewed', metadata: { note: 'x' },
    });
    expect(mc.choices).toEqual([{ text: 'Locusts and wild honey', correct: true }, { text: 'Bread', correct: false }]);
    expect(mc.passages).toEqual([{ start: 41001006, end: 41001006, primary: true }, { start: 40003004, end: 40003004, primary: false }]);
    expect(ch1[0].difficulty).toBeUndefined();

    // A secondary link counts for overlap too (Matthew 3:4).
    expect(repo.getQuestions([{ start: 40003001, end: 40003017 }]).map((q) => q.key)).toEqual(['kth:MRK:1:01']);

    // No primary link: the first one is promoted; bad metadata JSON is dropped.
    const sa = repo.getQuestions([{ start: 41004001, end: 41004001 }]);
    expect(sa.map((q) => q.key)).toEqual(['kth:MRK:4:01']);
    expect(sa[0]).toMatchObject({ accepted: ['ship', 'a ship'], passages: [{ start: 41004001, end: 41004001, primary: true }] });
    expect(sa[0].metadata).toBeUndefined();
    p.close();
  });

  it('filters by kind, mode and module', () => {
    const p = buildModule();
    const repo = new QuizRepository(p);
    const mark = [{ start: 41000000, end: 41999999 }];
    expect(repo.getQuestions(mark, { modes: ['reflection'] }).map((q) => q.key)).toEqual(['kth:MRK:4:99']);
    expect(repo.getQuestions(mark, { kinds: ['application'] })).toHaveLength(1);
    expect(repo.getQuestions(mark, { moduleUuids: ['other'] })).toEqual([]);
    expect(repo.getQuestions(mark, { moduleUuids: [UUID] })).toHaveLength(4);
    expect(repo.getQuestions([])).toEqual([]);
    p.close();
  });

  it('looks questions up by key', () => {
    const p = buildModule();
    const got = new QuizRepository(p).getQuestionsByKeys(['kth:MRK:4:99', 'missing', 'kth:MRK:1:01']);
    expect(got.map((q) => q.key)).toEqual(['kth:MRK:1:01', 'kth:MRK:4:99']);
    p.close();
  });

  it('is constructed by the SQLite repository factory for the quiz module type', () => {
    expect(moduleRepositoryTypeFor('quiz')).toBe('quiz');
    const p = buildModule();
    const repo = new SqliteModuleRepositoryFactory().create({ sql: p } as never, 'quiz', undefined as never);
    expect(repo).toBeInstanceOf(QuizRepository);
    p.close();
  });
});
