/**
 * Codec resolution against real module databases (task 0027 F4).
 *
 * Built on the real v0.2 schemas (`sql/schemas/initial/Commentary.sql`, which
 * pulls in the shared `module_info` and `compression_dictionary` fragments),
 * not on a hand-written approximation of them - the point is to prove that
 * what `resolveModuleCodec` reads is what a published module actually
 * contains.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { ISql, SqlParameter, SqlResult } from '../../Core/ISql';
import { loadSchemaSql } from '../../Schema';
import { TestSqliteProvider } from '../../../__tests__/helpers/TestSqliteProvider';
import { CodecRegistry } from './CodecRegistry';
import { DeflateCodec } from './DeflateCodec';
import { NoneCodec } from './NoneCodec';
import { createNodeCodecRegistry } from './NodeCodecs';
import { resolveModuleCodec } from './resolveModuleCodec';
import { CompressionCodec } from '../../Format/ModuleFormat';
import {
  CODEC_CORPUS,
  OTHER_DICTIONARY,
  TEST_DICTIONARY,
} from '../../../__tests__/helpers/codecFixtures';

const COMMENTARY_SCHEMA = join(
  __dirname, '..', '..', '..', '..', 'sql', 'schemas', 'initial', 'Commentary.sql'
);

const open: TestSqliteProvider[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()!.close();
});

/**
 * An in-memory commentary module on the real schema.
 *
 * @param compression What to write into `module_info.compression`. Typed as a
 *        plain string, not {@link CompressionCodec}, because the column has no
 *        CHECK constraint and the interesting cases include values outside the
 *        union.
 * @param dictionary  A `compression_dictionary` row to insert, or none.
 */
function makeModule(compression: string, dictionary?: Uint8Array): TestSqliteProvider {
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
      `INSERT INTO compression_dictionary (codec, dict_id, dict_blob, trained_from)
       VALUES (?, ?, ?, ?)`,
      [compression, 1234, dictionary, '{"samples":2,"tool":"test"}']
    );
  }
  return sql;
}

/** Records every statement, so "no dictionary lookup happened" is checkable. */
class RecordingSql implements ISql {
  readonly statements: string[] = [];

  constructor(private readonly inner: ISql) {}

  queryOne<T>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T | undefined {
    this.statements.push(sql);
    return this.inner.queryOne<T>(sql, params);
  }
  queryAll<T>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T[] {
    this.statements.push(sql);
    return this.inner.queryAll<T>(sql, params);
  }
  execute(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): SqlResult {
    this.statements.push(sql);
    return this.inner.execute(sql, params);
  }
  transaction<T>(callback: () => T): T {
    return this.inner.transaction(callback);
  }
  close(): void {
    this.inner.close();
  }
  isOpen(): boolean {
    return this.inner.isOpen();
  }
  getDatabasePath(): string {
    return this.inner.getDatabasePath();
  }

  /** Statements mentioning `compression_dictionary` in any form. */
  dictionaryStatements(): string[] {
    return this.statements.filter(s => s.includes('compression_dictionary'));
  }
}

describe('resolveModuleCodec', () => {
  describe("compression = 'none'", () => {
    it('resolves to NoneCodec', () => {
      const resolved = resolveModuleCodec(makeModule('none'), createNodeCodecRegistry());

      expect(resolved.compression).toBe('none');
      expect(resolved.codec).toBeInstanceOf(NoneCodec);
      expect(resolved.supported).toBe(true);
      expect(resolved.dictionaryBound).toBe(false);
    });

    it('does not touch compression_dictionary at all', () => {
      // `compression = 'none'` means that table is empty by definition, so
      // querying it would be a guaranteed-empty read on every module open.
      const sql = new RecordingSql(makeModule('none'));
      resolveModuleCodec(sql, createNodeCodecRegistry());

      expect(sql.dictionaryStatements()).toEqual([]);
    });

    it('is what a module predating the compression column resolves to', () => {
      // Every module file shipped so far. `module_info` exists but has no
      // `compression` column - and resolution must not fail on it.
      const sql = new TestSqliteProvider(':memory:');
      open.push(sql);
      sql.exec(`CREATE TABLE module_info (info_id INTEGER PRIMARY KEY, abbreviation TEXT);
                INSERT INTO module_info VALUES (1, 'KJV');`);

      const resolved = resolveModuleCodec(sql, createNodeCodecRegistry());
      expect(resolved.compression).toBe('none');
      expect(resolved.codec).toBeInstanceOf(NoneCodec);
    });

    it('is what a database with no module_info table at all resolves to', () => {
      // In-memory fixtures throughout this suite have no module_info; opening
      // a repository over one must not throw.
      const sql = new TestSqliteProvider(':memory:');
      open.push(sql);
      sql.exec('CREATE TABLE topic (topic_id INTEGER PRIMARY KEY, name TEXT);');

      expect(() => resolveModuleCodec(sql, createNodeCodecRegistry())).not.toThrow();
      expect(resolveModuleCodec(sql, createNodeCodecRegistry()).compression).toBe('none');
    });
  });

  describe("compression = 'deflate'", () => {
    it('resolves to the deflate codec, unbound, when there is no dictionary row', () => {
      const resolved = resolveModuleCodec(makeModule('deflate'), createNodeCodecRegistry());

      expect(resolved.codec).toBeInstanceOf(DeflateCodec);
      expect(resolved.supported).toBe(true);
      expect(resolved.dictionaryBound).toBe(false);
      expect(resolved.codec!.needsDictionary).toBe(true);
    });

    it('binds the dictionary from the compression_dictionary row', () => {
      const resolved = resolveModuleCodec(
        makeModule('deflate', TEST_DICTIONARY),
        createNodeCodecRegistry()
      );

      expect(resolved.dictionaryBound).toBe(true);
      expect(resolved.codec!.needsDictionary).toBe(false);
    });

    it('binds THAT dictionary, not a default or a wrong one', () => {
      // The test that actually matters. A frame encoded with TEST_DICTIONARY
      // decodes correctly through the resolved codec only if the bytes that
      // came out of the database are the bytes being used.
      const frame = new DeflateCodec(TEST_DICTIONARY).encode(CODEC_CORPUS.prose);
      const resolved = resolveModuleCodec(
        makeModule('deflate', TEST_DICTIONARY),
        createNodeCodecRegistry()
      );

      expect(resolved.codec!.decode(frame)).toBe(CODEC_CORPUS.prose);

      // ... and a module carrying a DIFFERENT dictionary does not decode it.
      const wrong = resolveModuleCodec(
        makeModule('deflate', OTHER_DICTIONARY),
        createNodeCodecRegistry()
      );
      let decoded: string | undefined;
      try {
        decoded = wrong.codec!.decode(frame);
      } catch {
        decoded = undefined;
      }
      expect(decoded).not.toBe(CODEC_CORPUS.prose);
    });

    it('ignores a zero-length dict_blob', () => {
      const resolved = resolveModuleCodec(
        makeModule('deflate', new Uint8Array(0)),
        createNodeCodecRegistry()
      );

      expect(resolved.dictionaryBound).toBe(false);
      expect(resolved.codec!.needsDictionary).toBe(true);
    });

    it('ignores a dictionary row belonging to a different codec', () => {
      // The table is keyed by codec; a zstd dictionary in a deflate module is
      // not this module's dictionary.
      const sql = makeModule('deflate');
      sql.execute(
        `INSERT INTO compression_dictionary (codec, dict_id, dict_blob) VALUES ('zstd', 1, ?)`,
        [TEST_DICTIONARY]
      );

      expect(resolveModuleCodec(sql, createNodeCodecRegistry()).dictionaryBound).toBe(false);
    });

    it('survives a compressed module whose compression_dictionary table is missing', () => {
      const sql = new TestSqliteProvider(':memory:');
      open.push(sql);
      sql.exec(`CREATE TABLE module_info (info_id INTEGER PRIMARY KEY, compression TEXT);
                INSERT INTO module_info VALUES (1, 'deflate');`);

      const resolved = resolveModuleCodec(sql, createNodeCodecRegistry());
      expect(resolved.codec).toBeInstanceOf(DeflateCodec);
      expect(resolved.dictionaryBound).toBe(false);
    });
  });

  describe('a codec this reader has not got', () => {
    it('resolves to codec: null, supported: false - and does not throw', () => {
      const sql = makeModule('brotli', TEST_DICTIONARY);

      const resolved = resolveModuleCodec(sql, createNodeCodecRegistry());
      expect(resolved.compression).toBe('brotli' as CompressionCodec);
      expect(resolved.codec).toBeNull();
      expect(resolved.supported).toBe(false);
      expect(resolved.dictionaryBound).toBe(false);
    });

    it('does not look up a dictionary it has nothing to bind to', () => {
      const sql = new RecordingSql(makeModule('brotli', TEST_DICTIONARY));
      resolveModuleCodec(sql, createNodeCodecRegistry());

      expect(sql.dictionaryStatements()).toEqual([]);
    });

    it('is the same answer for a real codec a narrower runtime lacks', () => {
      // A browser-shaped registry (none + deflate) opening a zstd module.
      const browserish = new CodecRegistry([new NoneCodec(), new DeflateCodec()]);
      const resolved = resolveModuleCodec(makeModule('zstd', TEST_DICTIONARY), browserish);

      expect(resolved.compression).toBe('zstd');
      expect(resolved.supported).toBe(false);
      expect(resolved.codec).toBeNull();
    });
  });

  describe('degenerate compression values', () => {
    it.each([['', 'empty string'], [null as unknown as string, 'NULL']])(
      'treats %s (%s) as uncompressed',
      value => {
        const sql = new TestSqliteProvider(':memory:');
        open.push(sql);
        sql.exec(`CREATE TABLE module_info (info_id INTEGER PRIMARY KEY, compression TEXT);`);
        sql.execute('INSERT INTO module_info VALUES (1, ?)', [value]);

        const resolved = resolveModuleCodec(sql, createNodeCodecRegistry());
        expect(resolved.compression).toBe('none');
        expect(resolved.codec).toBeInstanceOf(NoneCodec);
      }
    );

    it('treats a module_info table with no row as uncompressed', () => {
      const sql = new TestSqliteProvider(':memory:');
      open.push(sql);
      sql.exec(`CREATE TABLE module_info (info_id INTEGER PRIMARY KEY, compression TEXT);`);

      expect(resolveModuleCodec(sql, createNodeCodecRegistry()).compression).toBe('none');
    });
  });
});
