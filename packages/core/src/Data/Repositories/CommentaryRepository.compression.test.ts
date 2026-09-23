/**
 * `text()` end to end through a real repository (task 0027 F4).
 *
 * Everything else about the codecs is testable in isolation. This file is the
 * one that proves the pieces are actually joined up: a commentary module on
 * the real v0.2 schema, with `module_info.compression = 'deflate'`, a real
 * `compression_dictionary` row, and `commentary_entry.content` holding a
 * genuine dictionary-bound DEFLATE frame in a BLOB - read back through
 * `CommentaryRepository`'s ordinary methods, which know nothing about any of
 * it.
 *
 * The fixture is generated here rather than checked in: no compressed module
 * exists in the wild yet, and a committed blob would only ever prove that the
 * codec still agrees with whatever built the blob.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { CommentaryRepository } from './CommentaryRepository';
import { TestSqliteProvider } from '../../__tests__/helpers/TestSqliteProvider';
import { loadSchemaSql } from '../Schema';
import { CodecRegistry, DeflateCodec, NoneCodec } from '../Access/Codec';
import { ContentCodecUnavailableError } from '../Access/Codec';
import { CODEC_CORPUS, TEST_DICTIONARY } from '../../__tests__/helpers/codecFixtures';
import { VerseId } from '../Core/Types';

const COMMENTARY_SCHEMA = join(
  __dirname, '..', '..', '..', 'sql', 'schemas', 'initial', 'Commentary.sql'
);

/** John 3:16 in this project's verse-id scheme, as used throughout the suite. */
const JOHN_3_16 = 43003016 as VerseId;
const JOHN_3_17 = 43003017 as VerseId;
const JOHN_3_18 = 43003018 as VerseId;

const open: TestSqliteProvider[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()!.close();
});

interface FixtureOptions {
  compression: string;
  /** Written to `compression_dictionary` AND used to encode the blobs. */
  dictionary?: Uint8Array;
  /** Store entry content as a BLOB frame (true) or as plain TEXT (false). */
  compressed: boolean;
}

/**
 * A one-entry-per-verse commentary module built on the real schema.
 *
 * `commentary_entry.content` is declared `TEXT NOT NULL`, and a BLOB goes
 * into it unchanged: SQLite's TEXT affinity converts numbers, never blobs.
 * That is precisely the design's frame layout - the cell holds one bare codec
 * frame and nothing else, with no column type change and no side table.
 */
function makeModule(options: FixtureOptions): TestSqliteProvider {
  const sql = new TestSqliteProvider(':memory:');
  open.push(sql);
  sql.exec(loadSchemaSql(COMMENTARY_SCHEMA));
  sql.execute(
    `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name,
                              format, format_version, language_code, compression)
     VALUES (1, 'fixture-uuid', 'commentary', 'FIX', 'Fixture Commentary',
             'commentary-module', '0.2', 'en', ?)`,
    [options.compression]
  );
  if (options.dictionary) {
    sql.execute(
      `INSERT INTO compression_dictionary (codec, dict_id, dict_blob) VALUES (?, ?, ?)`,
      [options.compression, 1234, options.dictionary]
    );
  }

  const codec = new DeflateCodec(options.dictionary ?? null);
  const entries: Array<[VerseId, string]> = [
    [JOHN_3_16, CODEC_CORPUS.prose],
    [JOHN_3_17, CODEC_CORPUS.utf8],
    [JOHN_3_18, CODEC_CORPUS.repetitive],
  ];
  for (const [verseId, text] of entries) {
    sql.execute(
      `INSERT INTO commentary_entry (verse_id_start, verse_id_end, entry_level, content, word_count)
       VALUES (?, ?, 'verse', ?, ?)`,
      [verseId, verseId, options.compressed ? codec.encode(text) : text, text.split(' ').length]
    );
  }
  return sql;
}

describe('CommentaryRepository with compressed content', () => {
  describe("a deflate module with a dictionary - the shape F9 will publish", () => {
    const build = () =>
      makeModule({ compression: 'deflate', dictionary: TEST_DICTIONARY, compressed: true });

    it('stores the content column as a BLOB, not as text', () => {
      // If this ever stopped being true the rest of the file would pass for
      // the wrong reason - `text()` would be taking its string fast path.
      const raw = build().queryOne<{ content: unknown }>(
        'SELECT content FROM commentary_entry WHERE verse_id_start = ?', [JOHN_3_16]
      );
      expect(Buffer.isBuffer(raw!.content)).toBe(true);
    });

    it('decodes prose back to the original text', () => {
      const repo = new CommentaryRepository(build());
      const entries = repo.getEntriesForVerse(JOHN_3_16);

      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe(CODEC_CORPUS.prose);
    });

    it('decodes multi-byte UTF-8 without mangling it', () => {
      const repo = new CommentaryRepository(build());
      expect(repo.getEntriesForVerse(JOHN_3_17)[0].content).toBe(CODEC_CORPUS.utf8);
    });

    it('decodes through every read path, not just one', () => {
      // getEntry / getEntriesForVerse / getEntriesByLevel / getBestEntryForVerse
      // all funnel through mapRowToEntry; this pins that they really do.
      const repo = new CommentaryRepository(build());

      expect(repo.getEntry(1)!.content).toBe(CODEC_CORPUS.prose);
      expect(repo.getBestEntryForVerse(JOHN_3_16)!.content).toBe(CODEC_CORPUS.prose);
      expect(repo.getEntriesByLevel('verse').map(e => e.content)).toEqual([
        CODEC_CORPUS.prose,
        CODEC_CORPUS.utf8,
        CODEC_CORPUS.repetitive,
      ]);
    });

    it('still reads module_info and metadata as before', () => {
      const repo = new CommentaryRepository(build());
      const info = repo.getModuleInfo();

      expect(info!.abbreviation).toBe('FIX');
      expect(info!.formatVersion).toBe('0.2');
    });

    it('reports the module as readable through the capability accessor', () => {
      expect(new CommentaryRepository(build()).getCompressionCapability()).toEqual({
        codec: 'deflate',
        supported: true,
      });
    });

    it('resolves the codec once per repository, not once per row', () => {
      // The design's rule, and the reason the accessor is memoized on the
      // base class: `module_info` is read once no matter how much prose is
      // decoded afterwards.
      const sql = build();
      let moduleInfoReads = 0;
      const originalQueryOne = sql.queryOne.bind(sql);
      sql.queryOne = ((statement: string, params?: never) => {
        if (/FROM module_info/.test(statement)) moduleInfoReads += 1;
        return originalQueryOne(statement, params);
      }) as typeof sql.queryOne;

      const repo = new CommentaryRepository(sql);
      repo.getEntriesForVerse(JOHN_3_16);
      repo.getEntriesForVerse(JOHN_3_17);
      repo.getEntriesByLevel('verse');
      repo.getEntry(1);

      expect(moduleInfoReads).toBe(1);
    });

    it('is decoded with THIS module\'s dictionary', () => {
      // A reader that ignored the compression_dictionary row, or bound a
      // default, would fail here and nowhere else: the frames were encoded
      // against TEST_DICTIONARY and are not readable without it.
      const repo = new CommentaryRepository(build());
      const entry = repo.getEntriesForVerse(JOHN_3_18)[0];

      expect(entry.content).toBe(CODEC_CORPUS.repetitive);
      // Proof that the dictionary is load-bearing here rather than incidental:
      // the same bytes through an unbound codec do not give this text.
      const raw = build().queryOne<{ content: Uint8Array }>(
        'SELECT content FROM commentary_entry WHERE verse_id_start = ?', [JOHN_3_18]
      )!.content;
      let naive: string | undefined;
      try {
        naive = new DeflateCodec().decode(raw);
      } catch {
        naive = undefined;
      }
      expect(naive).not.toBe(CODEC_CORPUS.repetitive);
    });
  });

  describe('a deflate module with no dictionary', () => {
    it('decodes frames encoded without one', () => {
      const repo = new CommentaryRepository(
        makeModule({ compression: 'deflate', compressed: true })
      );
      expect(repo.getEntriesForVerse(JOHN_3_16)[0].content).toBe(CODEC_CORPUS.prose);
    });
  });

  describe('mixed cells in a compressed module', () => {
    it('returns a plain TEXT cell unchanged', () => {
      // The per-row "keep the blob only if it is smaller" build rule: a short
      // entry stays TEXT even where `compression = 'deflate'`. This must not
      // be an error, and must not be run through the decoder.
      const sql = makeModule({
        compression: 'deflate', dictionary: TEST_DICTIONARY, compressed: true,
      });
      sql.execute(
        `INSERT INTO commentary_entry (verse_id_start, verse_id_end, entry_level, content)
         VALUES (?, ?, 'verse', ?)`,
        [43003019, 43003019, CODEC_CORPUS.ascii]
      );

      const repo = new CommentaryRepository(sql);
      expect(repo.getEntriesForVerse(43003019 as VerseId)[0].content).toBe(CODEC_CORPUS.ascii);
      // ... while the compressed neighbours still decode.
      expect(repo.getEntriesForVerse(JOHN_3_16)[0].content).toBe(CODEC_CORPUS.prose);
    });
  });

  describe("an uncompressed module - every module shipped to date", () => {
    it('behaves exactly as before: content read straight out of the column', () => {
      const repo = new CommentaryRepository(
        makeModule({ compression: 'none', compressed: false })
      );

      expect(repo.getEntriesForVerse(JOHN_3_16)[0].content).toBe(CODEC_CORPUS.prose);
      expect(repo.getEntriesForVerse(JOHN_3_17)[0].content).toBe(CODEC_CORPUS.utf8);
      expect(repo.getCompressionCapability()).toEqual({ codec: 'none', supported: true });
    });

    it('resolves to NoneCodec and never queries compression_dictionary', () => {
      const sql = makeModule({ compression: 'none', compressed: false });
      const seen: string[] = [];
      const originalQueryOne = sql.queryOne.bind(sql);
      sql.queryOne = ((statement: string, params?: never) => {
        seen.push(statement);
        return originalQueryOne(statement, params);
      }) as typeof sql.queryOne;

      const repo = new CommentaryRepository(sql);
      repo.getEntriesForVerse(JOHN_3_16);

      expect(seen.filter(s => s.includes('compression_dictionary'))).toEqual([]);
    });
  });

  describe('a module whose codec this reader has not got', () => {
    /** A registry that is missing deflate, standing in for a narrower runtime. */
    const NONE_ONLY = new CodecRegistry([new NoneCodec()]);

    it('still opens, and still reads module_info', () => {
      const sql = makeModule({ compression: 'deflate', compressed: true });

      expect(() => new CommentaryRepository(sql, NONE_ONLY)).not.toThrow();
      expect(new CommentaryRepository(sql, NONE_ONLY).getModuleInfo()!.abbreviation).toBe('FIX');
    });

    it('answers the capability question instead of throwing', () => {
      const repo = new CommentaryRepository(
        makeModule({ compression: 'deflate', compressed: true }), NONE_ONLY
      );

      expect(repo.getCompressionCapability()).toEqual({ codec: 'deflate', supported: false });
    });

    it('throws a typed, named error if content is read anyway', () => {
      // No capability surface exists yet to stop a caller getting this far
      // (M7/F8/M9). Until one does, the answer is a clear typed error naming
      // the codec - never a silently empty entry, which is indistinguishable
      // from a genuinely empty one.
      const repo = new CommentaryRepository(
        makeModule({ compression: 'deflate', compressed: true }), NONE_ONLY
      );

      expect(() => repo.getEntriesForVerse(JOHN_3_16)).toThrow(ContentCodecUnavailableError);
      expect(() => repo.getEntriesForVerse(JOHN_3_16)).toThrow(/deflate/);
    });

    it('reads a plain TEXT cell of the same module without complaint', () => {
      // A missing codec breaks only what is actually compressed.
      const sql = makeModule({ compression: 'deflate', compressed: true });
      sql.execute(
        `INSERT INTO commentary_entry (verse_id_start, verse_id_end, entry_level, content)
         VALUES (?, ?, 'verse', ?)`,
        [43003019, 43003019, CODEC_CORPUS.ascii]
      );

      const repo = new CommentaryRepository(sql, NONE_ONLY);
      expect(repo.getEntriesForVerse(43003019 as VerseId)[0].content).toBe(CODEC_CORPUS.ascii);
    });
  });

  describe('a module naming a codec nobody has', () => {
    it('is the same clean answer as a merely-narrower runtime', () => {
      const repo = new CommentaryRepository(
        makeModule({ compression: 'brotli', compressed: false })
      );

      expect(repo.getCompressionCapability()).toEqual({ codec: 'brotli', supported: false });
      expect(repo.getModuleInfo()!.abbreviation).toBe('FIX');
      // Its cells here are TEXT, so they still read - the error is reserved
      // for content that genuinely needs a decoder.
      expect(repo.getEntriesForVerse(JOHN_3_16)[0].content).toBe(CODEC_CORPUS.prose);
    });
  });
});
