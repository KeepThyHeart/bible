/**
 * Publisher exports contract (task 0027, "Module Format v2", revision 2,
 * subtask F9).
 *
 * `bible-scripts` - the out-of-repo C++ SWORD-to-module converter - is meant
 * to consume `packages/core`'s exports rather than hand-copy the format's
 * rules into its own codebase: design doc §6.1's own words are "the
 * converters produce v0.2 by consuming this, not by copying a spec". Several
 * bugs earlier subtasks in this series fixed were exactly that kind of drift
 * (a hand-copied rule that quietly fell out of step with the real one).
 *
 * This test is that contract's canary. It builds a conforming module using
 * ONLY symbols imported the way an external package consumer would import
 * them - the same barrel `import { X } from '@bible/core'` resolves to, via
 * `package.json`'s `"main"`/`"exports"` - and then runs it back through
 * {@link validateModuleFile}, proving the whole publish-then-validate loop is
 * achievable from nothing but the public surface.
 *
 * `'@bible/core'` itself resolves through `dist/`, which is not part of a
 * fresh, unbuilt checkout (see `contentDigest.test.ts`'s CLI suite, which
 * skips for exactly that reason rather than depending on it). No test
 * elsewhere in this package imports that literal specifier; every contract
 * test - `ExtensionsContract.test.ts` is the sibling this one is modelled on
 * - imports from `../index` instead, which is the same barrel. If a future
 * refactor drops one of the names below from a barrel along the way, this
 * file's own import line fails to resolve - that IS the "fails loudly if an
 * export is dropped" behaviour the design doc asks of this subtask; no
 * additional assertion is needed to prove a name is still exported, only to
 * prove it still works.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  CONTENT_MAP,
  CodecRegistry,
  DeflateCodec,
  FORMAT_VERSION,
  ModuleType,
  ZstdCodec,
  computeContentSha256,
  createNodeCodecRegistry,
  loadSchemaSql,
  resolveModuleCodec,
  validateModuleFile,
} from '../index';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';

const COMMENTARY_SCHEMA = join(__dirname, '..', '..', 'sql', 'schemas', 'initial', 'Commentary.sql');

const MODULE_TYPE: ModuleType = 'commentary';

// The shape CONTENT_MAP declares for commentary - read once, used to drive
// the fixture below, so this test breaks (loudly, at the CONTENT_MAP read)
// rather than silently mismatching the schema if the shape ever changes.
const SHAPE = CONTENT_MAP.commentary[0]!;

const registry: CodecRegistry = createNodeCodecRegistry();

const open: TestSqliteProvider[] = [];
afterEach(() => {
  while (open.length > 0) open.pop()!.close();
});

/** Two prose rows, encoded through `codec`, on a fresh in-memory commentary module. */
function buildModule(compression: 'deflate' | 'zstd', codec: DeflateCodec | ZstdCodec): TestSqliteProvider {
  const sql = new TestSqliteProvider(':memory:');
  open.push(sql);
  sql.exec(loadSchemaSql(COMMENTARY_SCHEMA));

  sql.execute(
    `INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name,
                              format, format_version, language_code, compression)
     VALUES (1, ?, ?, 'TEST', 'Test Commentary', 'commentary-module', ?, 'en', ?)`,
    [randomUUID(), MODULE_TYPE, FORMAT_VERSION, compression]
  );

  const rows = [
    { id: 1, content: 'In the beginning God created the heaven and the earth.' },
    { id: 2, content: 'And the earth was without form, and void.' },
  ];
  for (const row of rows) {
    sql.execute(
      `INSERT INTO ${SHAPE.table} (${SHAPE.rowid}, entry_level, ${SHAPE.prose[0]}) VALUES (?, 'verse', ?)`,
      [row.id, codec.encode(row.content)]
    );
  }

  return sql;
}

describe('publisher exports contract (F9)', () => {
  it('CONTENT_MAP describes commentary_entry the way the real schema does', () => {
    expect(SHAPE.table).toBe('commentary_entry');
    expect(SHAPE.rowid).toBe('entry_id');
    expect(SHAPE.prose).toEqual(['content']);
  });

  it(
    'publishes a conforming module with the deflate codec, computes its digest and ' +
      'validates clean - all through the package root export surface',
    () => {
      const codec = registry.get('deflate');
      expect(codec).not.toBeNull();
      const sql = buildModule('deflate', codec as DeflateCodec);

      const resolved = resolveModuleCodec(sql, registry);
      expect(resolved.compression).toBe('deflate');
      expect(resolved.supported).toBe(true);

      const digest = computeContentSha256(sql, MODULE_TYPE, resolved);
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      // Calling the exported function again, on the same inputs, must return
      // the exact same value - proof this is the real digest function
      // (deterministic, reachable, callable), not a stub that happens to
      // return a hex-shaped string once.
      expect(computeContentSha256(sql, MODULE_TYPE, resolved)).toBe(digest);

      sql.execute('UPDATE module_info SET content_sha256 = ? WHERE info_id = 1', [digest]);

      const result = validateModuleFile(sql, registry);
      expect(result.issues.filter(issue => issue.severity === 'error')).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.formatVersionKind).toBe('current');
    }
  );

  describe.skipIf(!registry.has('zstd'))('zstd (when this Node build has it)', () => {
    it('publishes and validates clean, with the same content digest as the deflate module', () => {
      const deflateCodec = registry.get('deflate') as DeflateCodec;
      const deflateSql = buildModule('deflate', deflateCodec);
      const deflateDigest = computeContentSha256(
        deflateSql, MODULE_TYPE, resolveModuleCodec(deflateSql, registry)
      );

      const zstdCodec = registry.get('zstd');
      expect(zstdCodec).not.toBeNull();
      const zstdSql = buildModule('zstd', zstdCodec as ZstdCodec);

      const resolved = resolveModuleCodec(zstdSql, registry);
      expect(resolved.compression).toBe('zstd');
      expect(resolved.supported).toBe(true);

      const digest = computeContentSha256(zstdSql, MODULE_TYPE, resolved);
      // Codec invariance: the digest is computed over DECODED content, so
      // deflate and zstd modules holding the same prose must agree exactly.
      expect(digest).toBe(deflateDigest);

      zstdSql.execute('UPDATE module_info SET content_sha256 = ? WHERE info_id = 1', [digest]);

      const result = validateModuleFile(zstdSql, registry);
      expect(result.ok).toBe(true);
    });
  });
});
