import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { baseId, exportCorpus, formatRef } from './export-bibsearch-corpus.mjs';
import { classifyFacet, isSubFacetId, isSubFacetText } from '../../packages/core/src/Services/Search/FacetClassifier.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bibsearch-export-'));
const DIMS = 4;
const vec = (...n) => Buffer.from(new Float32Array(n).buffer);
const LONG = 'A long explanatory main facet that is certainly well over eighty characters in length, as an LLM would write.';

function makeFixture() {
  const dbPath = path.join(tmp, 'fixture.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE semantic_embeddings (id TEXT, level TEXT, start_verse_id INTEGER, end_verse_id INTEGER, text_content TEXT, title TEXT, embedding_blob BLOB);
    CREATE TABLE index_metadata (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE topic_entries (embedding_id TEXT, tag_name TEXT, tag_type TEXT, verse_count INTEGER, avg_strength REAL, nave_topic_id INTEGER, torrey_topic_id INTEGER);
  `);
  const ins = db.prepare('INSERT INTO semantic_embeddings VALUES (?,?,?,?,?,?,?)');
  ins.run('v1', 'verse', 43003016, 43003016, LONG, null, vec(1, 0, 0, 0));
  ins.run('v1_s1', 'verse', 43003016, 43003016, 'God loves the world', null, vec(0, 1, 0, 0));
  ins.run('txt|v1', 'verse', 43003016, 43003016, 'For God so loved the world, that he gave his only begotten Son, and then some more words to pass the length test.', null, vec(0, 0, 1, 0));
  ins.run('p1', 'paragraph', 43003016, 43003021, LONG, 'Nicodemus', vec(0, 0, 0, 1));
  ins.run('p2', 'paragraph', 1001001, 1002003, LONG, null, vec(1, 1, 0, 0));
  ins.run('c1', 'chapter', 19023001, 19023006, LONG, 'The Shepherd Psalm', vec(1, 0, 1, 0));
  ins.run('empty', 'verse', 43003017, 43003017, '   ', null, vec(1, 0, 0, 1));
  ins.run('t1', 'topic', 0, 0, 'Grace: unmerited favour', 'Grace', vec(0, 1, 1, 0));
  const im = db.prepare('INSERT INTO index_metadata VALUES (?,?)');
  im.run('embedding_model', 'nomic-ai/nomic-embed-text-v1.5');
  im.run('embedding_dim', String(DIMS));
  im.run('min_similarity', '0.42');
  const te = db.prepare('INSERT INTO topic_entries VALUES (?,?,?,?,?,?,?)');
  te.run('t1', 'Grace', 'nave', 10, 0.8, 1, null);
  te.run('t1', 'Favour', 'torrey', 4, 0.5, null, 2);
  db.close();
  return dbPath;
}

const dbPath = makeFixture();
const outPath = path.join(tmp, 'out', 'corpus.jsonl');
const vecDir = path.join(tmp, 'vec');
const { manifest, vectorsManifest } = exportCorpus({ db: dbPath, out: outPath, vectors: vecDir });
const lines = fs.readFileSync(outPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byId = Object.fromEntries(lines.map((l) => [l.id, l]));

test('facet inference', () => {
  assert.equal(classifyFacet({ id: 'v1', level: 'verse', text: LONG }), 'main');
  assert.equal(classifyFacet({ id: 'v1_s2', level: 'verse', text: LONG }), 'sub');
  assert.equal(classifyFacet({ id: 'v1_s12', level: 'verse', text: LONG }), 'sub');
  assert.equal(classifyFacet({ id: 'x', level: 'verse', text: 'short phrase' }), 'sub');
  assert.equal(classifyFacet({ id: 'txt|x', level: 'verse', text: 'short' }), 'text');
  assert.equal(classifyFacet({ id: 't1', level: 'topic', text: 'short' }), 'topic');
  assert.ok(isSubFacetId('a_s3') && !isSubFacetId('a_x3') && isSubFacetText('x'.repeat(79)) && !isSubFacetText('x'.repeat(80)));
});

test('web scoring code uses the shared helper', () => {
  const src = fs.readFileSync(path.join(HERE, '../../packages/core/src/Services/Search/ScoringUtils.ts'), 'utf8');
  assert.match(src, /from '\.\/FacetClassifier'/);
  assert.match(src, /isSubFacetText\(r\.text\)/);
  assert.match(src, /isSubFacetId\(r\.id\)/);
  assert.doesNotMatch(src, /SUB_FACET_MAX_LENGTH\s*=|\.length\s*<\s*\d|\/_s\\d\$\/\.test/);
});

test('ids and refs', () => {
  assert.equal(baseId(43003016, 43003016), 'KJV.JHN.3.16');
  assert.equal(baseId(43003016, 43003021), 'KJV.JHN.3.16-21');
  assert.equal(baseId(1001001, 1002003), 'KJV.GEN.1.1-2.3');
  assert.equal(formatRef(43003016, 43003021), 'John 3:16-21');
  assert.equal(formatRef(1001001, 1002003), 'Genesis 1:1-2:3');
  assert.equal(formatRef(19023001, 19023001), 'Psalms 23:1');
  assert.deepEqual(Object.keys(byId).sort(), [
    'KJV.GEN.1.1-2.3#0', 'KJV.JHN.3.16#0', 'KJV.JHN.3.16#1', 'KJV.JHN.3.16#2',
    'KJV.JHN.3.16-21#0', 'KJV.PSA.23.1-6#0', 'topic.t1#0',
  ].sort());
});

test('record fields', () => {
  const p = byId['KJV.JHN.3.16-21#0'];
  assert.deepEqual(
    { passage: p.passage, level: p.level, facet: p.facet, start: p.start, end: p.end, ref: p.ref, title: p.title, book: p.book, testament: p.testament, translation: p.translation, lang: p.lang },
    { passage: 'paragraph:43003016-43003021', level: 'paragraph', facet: 'main', start: 43003016, end: 43003021, ref: 'John 3:16-21', title: 'Nicodemus', book: 'JHN', testament: 'NT', translation: 'KJV', lang: 'en' },
  );
  assert.equal(byId['KJV.GEN.1.1-2.3#0'].testament, 'OT');
  assert.deepEqual(lines.filter((l) => l.level === 'verse').map((l) => l.facet), ['main', 'sub', 'text']);
  const t = byId['topic.t1#0'];
  assert.deepEqual([t.facet, t.start, t.end, t.passage, t.tags, t.ref, t.book], ['topic', 0, 0, 'topic:0-0', ['Grace', 'Favour'], undefined, undefined]);
});

test('JSONL validity', () => {
  const raw = fs.readFileSync(outPath, 'utf8');
  assert.ok(raw.endsWith('\n'));
  assert.equal(new Set(lines.map((l) => l.id)).size, lines.length);
  for (const l of lines) {
    assert.ok(l.text.length > 0);
    assert.ok(Buffer.byteLength(JSON.stringify(l)) < 1024 * 1024);
    for (const f of ['id', 'text', 'passage', 'level', 'facet', 'start', 'end', 'title', 'tags', 'translation', 'lang']) assert.ok(f in l, f);
  }
  assert.equal(lines.length, 7); // empty-text row skipped
});

test('manifest and vectors', () => {
  assert.equal(manifest.rows, 7);
  assert.equal(manifest.skipped_empty_text, 1);
  assert.equal(manifest.min_similarity, 0.42);
  assert.equal(manifest.dims, DIMS);
  assert.equal(manifest.counts_by_level.verse, 3);
  assert.equal(manifest.counts_by_level_facet['verse/sub'], 1);
  assert.match(manifest.source_db_sha256, /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(path.join(tmp, 'out', 'corpus.manifest.json')));
  const f32 = (() => { const b = fs.readFileSync(path.join(vecDir, 'vectors.f32')); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); })();
  assert.equal(f32.length, 7 * DIMS);
  assert.deepEqual([...f32.slice(DIMS, 2 * DIMS)], [0, 1, 0, 0]); // second line = v1_s1
  assert.equal(vectorsManifest.dims, DIMS);
  assert.equal(vectorsManifest.query_prefix, 'search_query: ');
  assert.match(vectorsManifest.query_prefix_source, /assumed/);
});

test('levels filter and enrichment titles', () => {
  const edbPath = path.join(tmp, 'enr.db');
  const edb = new DatabaseSync(edbPath);
  edb.exec('CREATE TABLE enrichment_units (title TEXT, level TEXT, start_verse_id INTEGER, end_verse_id INTEGER)');
  edb.prepare('INSERT INTO enrichment_units VALUES (?,?,?,?)').run('Creation', 'paragraph', 1001001, 1002003);
  edb.close();
  const out2 = path.join(tmp, 'o2.jsonl');
  exportCorpus({ db: dbPath, out: out2, levels: 'paragraph', enrichments: edbPath });
  const l2 = fs.readFileSync(out2, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(l2.length, 2);
  assert.equal(l2.find((l) => l.start === 1001001).title, 'Creation');
  assert.throws(() => exportCorpus({ db: dbPath, out: out2 }), /exists/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
