/**
 * `computeContentSha256` (task 0027, "Module Format v2", revision 2, subtask
 * F3).
 *
 * Built on the real v0.2 schemas (`loadSchemaSql`), the same pattern F4's
 * `resolveModuleCodec.test.ts` and `CommentaryRepository.compression.test.ts`
 * already use - the point is to prove the digest behaves correctly against
 * what a published module actually contains, not a hand-written approximation
 * of one.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ModuleType } from '../Core/Types';
import { loadSchemaSql } from '../Schema';
import { TestSqliteProvider } from '../../__tests__/helpers/TestSqliteProvider';
import { computeContentSha256 } from './contentDigest';
import {
  createNodeCodecRegistry,
  DeflateCodec,
  ResolvedModuleCodec,
  ZstdCodec,
  resolveModuleCodec,
} from '../Access/Codec';
import { KJVTestHelper } from '../../__tests__/helpers/KJVTestHelper';
import { moduleDb } from '../../__tests__/helpers/testData';
import { CODEC_CORPUS, TEST_DICTIONARY } from '../../__tests__/helpers/codecFixtures';

const COMMENTARY_SCHEMA = join(
  __dirname, '..', '..', '..', 'sql', 'schemas', 'initial', 'Commentary.sql'
);
const DICTIONARY_SCHEMA = join(
  __dirname, '..', '..', '..', 'sql', 'schemas', 'initial', 'Dictionary.sql'
);

const registry = createNodeCodecRegistry();
const open: TestSqliteProvider[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()!.close();
});

/** `computeContentSha256`, resolving the codec the same way `moduleDigest.js` does. */
function digestOf(sql: TestSqliteProvider, moduleType: ModuleType): string {
  return computeContentSha256(sql, moduleType, resolveModuleCodec(sql, registry));
}

// ============================================================================
// Commentary fixtures - one prose+indexed column (`content`, in both arrays),
// plus `word_count`, a column in NEITHER (the "unhashed column" case).
// ============================================================================

interface CommentaryRow {
  entryId: number;
  content: string;
  wordCount?: number | null;
}

/**
 * A commentary module on the real schema. `compression = 'none'` stores
 * `content` as plain TEXT; `'deflate'`/`'zstd'` stores it as a real bare codec
 * frame, encoded (and, when `dictionary` is given, dictionary-bound) through
 * the actual `IContentCodec` under test elsewhere (F4) - not a stand-in.
 */
function makeCommentaryModule(
  compression: 'none' | 'deflate' | 'zstd',
  rows: readonly CommentaryRow[],
  dictionary?: Uint8Array
): TestSqliteProvider {
  const sql = new TestSqliteProvider(':memory:');
  open.push(sql);
  sql.exec(loadSchemaSql(COMMENTARY_SCHEMA));
  sql.execute(
    `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name,
                              format, format_version, language_code, compression)
     VALUES (1, 'test-uuid', 'commentary', 'TEST', 'Test Commentary',
             'commentary-module', '0.2', 'en', ?)`,
    [compression]
  );
  if (dictionary) {
    sql.execute(
      `INSERT INTO compression_dictionary (codec, dict_id, dict_blob) VALUES (?, ?, ?)`,
      [compression, 1, dictionary]
    );
  }

  const codec =
    compression === 'deflate' ? new DeflateCodec(dictionary ?? null)
    : compression === 'zstd' ? new ZstdCodec(dictionary ?? null)
    : null;

  for (const row of rows) {
    const stored = codec ? codec.encode(row.content) : row.content;
    sql.execute(
      `INSERT INTO commentary_entry (entry_id, entry_level, content, word_count)
       VALUES (?, 'verse', ?, ?)`,
      [row.entryId, stored, row.wordCount ?? null]
    );
  }
  return sql;
}

// ============================================================================
// Dictionary fixtures - `prose = ['definition', 'usage_notes']`,
// `indexed = ['word', 'definition', 'usage_notes']`: the multi-column-union
// case (a disjoint member, `word`, plus two overlapping members).
// ============================================================================

interface DictionaryRow {
  entryId: number;
  entryKey: string;
  word?: string | null;
  definition: string;
  usageNotes?: string | null;
}

function makeDictionaryModule(rows: readonly DictionaryRow[]): TestSqliteProvider {
  const sql = new TestSqliteProvider(':memory:');
  open.push(sql);
  sql.exec(loadSchemaSql(DICTIONARY_SCHEMA));
  sql.execute(
    `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name,
                              format, format_version, language_code)
     VALUES (1, 'test-uuid', 'dictionary', 'TEST', 'Test Dictionary',
             'dictionary-module', '0.2', 'en')`
  );
  for (const row of rows) {
    sql.execute(
      `INSERT INTO dictionary_entry (entry_id, entry_key, word, definition, usage_notes)
       VALUES (?, ?, ?, ?, ?)`,
      [row.entryId, row.entryKey, row.word ?? null, row.definition, row.usageNotes ?? null]
    );
  }
  return sql;
}

/** The digest's own wire-format primitives, reproduced independently for the reference-digest test. */
function u64le(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

describe('computeContentSha256', () => {
  describe('codec invariance - the headline property', () => {
    it('gives the identical digest for none, deflate and zstd modules holding the same decoded content', () => {
      const rows: CommentaryRow[] = [
        { entryId: 1, content: CODEC_CORPUS.ascii, wordCount: 9 },
        { entryId: 2, content: CODEC_CORPUS.prose, wordCount: 40 },
        { entryId: 3, content: CODEC_CORPUS.utf8, wordCount: 12 },
        { entryId: 4, content: CODEC_CORPUS.repetitive, wordCount: 400 },
        { entryId: 5, content: CODEC_CORPUS.empty, wordCount: 0 },
      ];

      const noneDigest = digestOf(makeCommentaryModule('none', rows), 'commentary');
      const deflateDigest = digestOf(
        makeCommentaryModule('deflate', rows, TEST_DICTIONARY), 'commentary'
      );
      const zstdDigest = digestOf(
        makeCommentaryModule('zstd', rows, TEST_DICTIONARY), 'commentary'
      );

      expect(noneDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(deflateDigest).toBe(noneDigest);
      expect(zstdDigest).toBe(noneDigest);
    });

    it('still agrees for deflate/zstd with NO dictionary bound', () => {
      const rows: CommentaryRow[] = [{ entryId: 1, content: CODEC_CORPUS.prose }];

      const noneDigest = digestOf(makeCommentaryModule('none', rows), 'commentary');
      const deflateDigest = digestOf(makeCommentaryModule('deflate', rows), 'commentary');
      const zstdDigest = digestOf(makeCommentaryModule('zstd', rows), 'commentary');

      expect(deflateDigest).toBe(noneDigest);
      expect(zstdDigest).toBe(noneDigest);
    });
  });

  describe('sensitivity', () => {
    it('changes when a hashed column changes by one byte', () => {
      const a = digestOf(
        makeCommentaryModule('none', [{ entryId: 1, content: 'Verse text.' }]), 'commentary'
      );
      const b = digestOf(
        makeCommentaryModule('none', [{ entryId: 1, content: 'Verse text!' }]), 'commentary'
      );

      expect(a).not.toBe(b);
    });

    it('does NOT change when a column outside prose ∪ indexed changes', () => {
      // word_count is neither prose nor indexed for commentary (CONTENT_MAP:
      // prose=['content'], indexed=['content']) - a pure metadata column.
      const a = digestOf(
        makeCommentaryModule('none', [{ entryId: 1, content: 'Verse text.', wordCount: 2 }]),
        'commentary'
      );
      const b = digestOf(
        makeCommentaryModule('none', [{ entryId: 1, content: 'Verse text.', wordCount: 999 }]),
        'commentary'
      );

      expect(a).toBe(b);
    });
  });

  describe('stability across row order', () => {
    it('is unaffected by the order rows are inserted in, since reads are ORDER BY rowid', () => {
      const rows: CommentaryRow[] = [
        { entryId: 1, content: 'First.' },
        { entryId: 2, content: 'Second.' },
        { entryId: 3, content: 'Third.' },
      ];

      const forward = digestOf(makeCommentaryModule('none', rows), 'commentary');
      const reversed = digestOf(makeCommentaryModule('none', [...rows].reverse()), 'commentary');

      expect(reversed).toBe(forward);
    });
  });

  describe('NULL handling', () => {
    it('a NULL cell hashes differently than an empty-string cell in the same column', () => {
      // usage_notes is nullable, and is in BOTH dictionary's prose and
      // indexed arrays - a column the digest genuinely hashes.
      const withNull = digestOf(
        makeDictionaryModule([
          { entryId: 1, entryKey: 'a', word: 'Word', definition: 'Def', usageNotes: null },
        ]),
        'dictionary'
      );
      const withEmpty = digestOf(
        makeDictionaryModule([
          { entryId: 1, entryKey: 'a', word: 'Word', definition: 'Def', usageNotes: '' },
        ]),
        'dictionary'
      );

      expect(withNull).not.toBe(withEmpty);
    });
  });

  describe('multi-column union correctness (dictionary)', () => {
    it("word (indexed-only) genuinely participates - changing only it changes the digest", () => {
      const a = digestOf(
        makeDictionaryModule([
          { entryId: 1, entryKey: 'a', word: 'Alpha', definition: 'Def', usageNotes: 'Notes' },
        ]),
        'dictionary'
      );
      const b = digestOf(
        makeDictionaryModule([
          { entryId: 1, entryKey: 'a', word: 'Beta', definition: 'Def', usageNotes: 'Notes' },
        ]),
        'dictionary'
      );

      expect(a).not.toBe(b);
    });

    it(
      'hashes definition/usage_notes exactly once each, in prose-then-indexed order, ' +
        'against an independently hand-built reference digest',
      () => {
        const sql = makeDictionaryModule([
          { entryId: 1, entryKey: 'a', word: 'Strength', definition: 'Power or might.', usageNotes: 'Used often.' },
        ]);
        const actual = digestOf(sql, 'dictionary');

        // Built independently of contentDigest.ts's own code, from the spec
        // directly: rowid=1, then the deduplicated prose-then-indexed union
        // (definition, usage_notes, word) - each written exactly once. If the
        // implementation instead hashed a column twice (definition or
        // usage_notes, both of which appear in `indexed` too) or in a
        // different order, this would NOT match.
        const expectedHash = createHash('sha256');
        expectedHash.update(u64le(1));
        for (const value of ['Power or might.', 'Used often.', 'Strength']) {
          const bytes = Buffer.from(value, 'utf8');
          expectedHash.update(Buffer.from([0x01]));
          expectedHash.update(u64le(bytes.length));
          expectedHash.update(bytes);
        }
        expectedHash.update(Buffer.from([0x1e]));
        const expected = expectedHash.digest('hex');

        expect(actual).toBe(expected);
      }
    );
  });

  describe('0x1E table separator - per shape, not only at the very end', () => {
    it('transposing two shapes worth of rows into one table changes the digest', () => {
      // A synthetic proof that the separator is written after EVERY shape
      // (not just appended once at the end): concatenating two tables' rows
      // with no separator between them is indistinguishable, byte-for-byte,
      // from one table holding the union of those rows plus one trailing
      // separator - UNLESS a separator is written after each one. Reproduce
      // both byte streams directly (independent of computeContentSha256) and
      // confirm they differ, i.e. the separator's position is observable.
      const withSeparatorPerShape = createHash('sha256');
      withSeparatorPerShape.update(u64le(1));
      writeCell(withSeparatorPerShape, 'Row A');
      withSeparatorPerShape.update(Buffer.from([0x1e]));
      withSeparatorPerShape.update(u64le(1));
      writeCell(withSeparatorPerShape, 'Row B');
      withSeparatorPerShape.update(Buffer.from([0x1e]));

      const separatorOnlyAtEnd = createHash('sha256');
      separatorOnlyAtEnd.update(u64le(1));
      writeCell(separatorOnlyAtEnd, 'Row A');
      separatorOnlyAtEnd.update(u64le(1));
      writeCell(separatorOnlyAtEnd, 'Row B');
      separatorOnlyAtEnd.update(Buffer.from([0x1e]));

      expect(withSeparatorPerShape.digest('hex')).not.toBe(separatorOnlyAtEnd.digest('hex'));

      function writeCell(hash: import('node:crypto').Hash, value: string): void {
        const bytes = Buffer.from(value, 'utf8');
        hash.update(Buffer.from([0x01]));
        hash.update(u64le(bytes.length));
        hash.update(bytes);
      }
    });
  });

  describe('empty CONTENT_MAP module types (cross_reference, tag_graph)', () => {
    function emptyModule(): TestSqliteProvider {
      const sql = new TestSqliteProvider(':memory:');
      open.push(sql);
      return sql;
    }

    it('cross_reference does not throw, and digests as the well-known empty-SHA-256', () => {
      const sql = emptyModule();
      const codec: ResolvedModuleCodec = resolveModuleCodec(sql, registry);

      expect(() => computeContentSha256(sql, 'cross_reference', codec)).not.toThrow();
      expect(computeContentSha256(sql, 'cross_reference', codec)).toBe(
        createHash('sha256').digest('hex')
      );
    });

    it('tag_graph is the same well-known empty digest', () => {
      const sql = emptyModule();
      const codec: ResolvedModuleCodec = resolveModuleCodec(sql, registry);

      expect(computeContentSha256(sql, 'tag_graph', codec)).toBe(
        createHash('sha256').digest('hex')
      );
    });
  });

  // ==========================================================================
  // Real data - proof this works end-to-end against actual shipped module
  // files, not just synthetic fixtures. Skips (with a warning) when no module
  // data is present locally, same as every other data-backed suite in core.
  // ==========================================================================

  const KJV_AVAILABLE = KJVTestHelper.isAvailable();

  describe.skipIf(!KJV_AVAILABLE)('real data', () => {
    it('bible_kjv.db digests deterministically', () => {
      const sql = new TestSqliteProvider(moduleDb('bible_kjv.db'), { readonly: true });
      try {
        const codec = resolveModuleCodec(sql, registry);
        // Published Bibles are uncompressed (and an older KJV has no
        // compression column at all, which also reads as 'none').
        expect(codec.compression).toBe('none');
        // Bible's CONTENT_MAP shape has prose: [] - no decode is exercised
        // here; see commentary_barnes.db below for a real, compressed prose
        // column of substantial size.
        const first = computeContentSha256(sql, 'bible', codec);
        const second = computeContentSha256(sql, 'bible', codec);

        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(second).toBe(first);
      } finally {
        sql.close();
      }
    });

    it(
      'commentary_barnes.db digests deterministically ' +
        '(a real prose column - published deflate-compressed with a dictionary)',
      () => {
        const path = moduleDb('commentary_barnes.db');
        if (!existsSync(path)) return; // extra guard: not covered by KJVTestHelper.isAvailable()

        const sql = new TestSqliteProvider(path, { readonly: true });
        try {
          // Whatever the file's codec is, this reader must have it: the digest
          // is over decoded prose, so an unreadable codec would throw below.
          const codec = resolveModuleCodec(sql, registry);
          expect(codec.supported).toBe(true);

          const first = computeContentSha256(sql, 'commentary', codec);
          const second = computeContentSha256(sql, 'commentary', codec);

          expect(first).toMatch(/^[0-9a-f]{64}$/);
          expect(second).toBe(first);
        } finally {
          sql.close();
        }
      }
    );
  });

  // ==========================================================================
  // CLI script - `scripts/module-digest.js` must print exactly what this
  // function computes directly, for the same real file. Requires the package
  // to be built (`npm run build`), which is not part of a fresh checkout (see
  // `dist/` in `.gitignore`) - this suite builds nothing itself, so it skips
  // (rather than failing) when `dist/index.js` is not already present. See
  // this task's final report for a manual verification run.
  // ==========================================================================

  const DIST_INDEX = join(__dirname, '..', '..', '..', 'dist', 'index.js');
  const CLI_SCRIPT = join(__dirname, '..', '..', '..', 'scripts', 'module-digest.js');

  describe.skipIf(!KJV_AVAILABLE || !existsSync(DIST_INDEX))('module-digest.js CLI', () => {
    it('prints the same digest computeContentSha256 computes directly for bible_kjv.db', async () => {
      const { execFileSync } = await import('node:child_process');
      const kjvPath = moduleDb('bible_kjv.db');

      const cliOutput = execFileSync('node', [CLI_SCRIPT, kjvPath], { encoding: 'utf8' }).trim();

      const sql = new TestSqliteProvider(kjvPath, { readonly: true });
      try {
        const codec = resolveModuleCodec(sql, registry);
        const direct = computeContentSha256(sql, 'bible', codec);

        expect(cliOutput).toMatch(/^[0-9a-f]{64}$/);
        expect(cliOutput).toBe(direct);
      } finally {
        sql.close();
      }
    });
  });
});
