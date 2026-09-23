/**
 * The one module-file conformance rule table (task 0027, "Module Format v2",
 * revision 2, subtask F5), exercised directly against `ISql` fixtures rather
 * than real module files - `hasSqliteHeader()` is a pure byte comparison, so
 * a synthetic `Uint8Array` proves it exactly as well as a real file would.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TestSqliteProvider } from '../../__tests__/helpers/TestSqliteProvider';
import { CodecRegistry } from '../Access/Codec/CodecRegistry';
import { NoneCodec } from '../Access/Codec/NoneCodec';
import { DeflateCodec } from '../Access/Codec/DeflateCodec';
import { createNodeCodecRegistry } from '../Access/Codec/NodeCodecs';
import { hasSqliteHeader, validateModuleFile } from './validateModuleFile';

const REAL_HEADER = new Uint8Array([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]);
const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

const open: TestSqliteProvider[] = [];
afterEach(() => {
  while (open.length > 0) open.pop()!.close();
});

/**
 * An in-memory `module_info` table shaped however a test needs - narrower
 * than the real schema on purpose, so a fixture can omit `compression`
 * entirely to stand in for a module published before that column existed.
 */
function makeModuleInfo(opts: {
  moduleUuid?: string | null;
  formatVersion?: string | null;
  compression?: string | null;
  withCompressionColumn?: boolean;
  noRow?: boolean;
} = {}): TestSqliteProvider {
  const {
    moduleUuid = VALID_UUID,
    formatVersion = '0.2',
    compression = 'none',
    withCompressionColumn = true,
    noRow = false,
  } = opts;

  const sql = new TestSqliteProvider(':memory:');
  open.push(sql);

  const columns = ['info_id INTEGER PRIMARY KEY', 'module_uuid TEXT', 'format_version TEXT'];
  if (withCompressionColumn) columns.push('compression TEXT');
  sql.exec(`CREATE TABLE module_info (${columns.join(', ')});`);

  if (!noRow) {
    const fields = ['info_id', 'module_uuid', 'format_version'];
    const values: (string | number | null)[] = [1, moduleUuid, formatVersion];
    if (withCompressionColumn) {
      fields.push('compression');
      values.push(compression);
    }
    sql.execute(
      `INSERT INTO module_info (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      values
    );
  }

  return sql;
}

describe('hasSqliteHeader', () => {
  it('is true for the real 16-byte SQLite magic', () => {
    expect(hasSqliteHeader(REAL_HEADER)).toBe(true);
  });

  it('tolerates extra trailing bytes past the first 16', () => {
    const withPageContent = new Uint8Array([...REAL_HEADER, 0x01, 0x02, 0x03]);
    expect(hasSqliteHeader(withPageContent)).toBe(true);
  });

  it('is false for a truncated header', () => {
    expect(hasSqliteHeader(REAL_HEADER.slice(0, 10))).toBe(false);
  });

  it('is false for an empty buffer', () => {
    expect(hasSqliteHeader(new Uint8Array(0))).toBe(false);
  });

  it('is false for bytes that are not a SQLite header at all', () => {
    expect(hasSqliteHeader(new TextEncoder().encode('not a database at all!'))).toBe(false);
  });

  it('is false when only the last byte differs (not merely "starts with S")', () => {
    const corrupted = new Uint8Array(REAL_HEADER);
    corrupted[15] = 0x01; // real header's 16th byte is the NUL terminator
    expect(hasSqliteHeader(corrupted)).toBe(false);
  });
});

describe('validateModuleFile - header row (opts.header)', () => {
  it('passes a valid module through to the rest of the table when the header is good', () => {
    const result = validateModuleFile(makeModuleInfo(), createNodeCodecRegistry(), { header: REAL_HEADER });
    expect(result.issues.some(i => i.code === 'invalid-header')).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('short-circuits on a bad header without attempting module_info at all', () => {
    // A table that, if queried, would pass every other check - proving the
    // failure came from the header gate, not from module_info.
    const sql = makeModuleInfo();
    const result = validateModuleFile(sql, createNodeCodecRegistry(), { header: new Uint8Array(4) });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'invalid-header', severity: 'error' }),
    ]);
    expect(result.formatVersionKind).toBeUndefined();
  });

  it('runs the full table when opts.header is omitted entirely', () => {
    // Both real apps/desktop call sites gate on hasSqliteHeader() themselves
    // before ever opening a connection - see validateModuleFile.ts's top
    // comment - so omitting `header` must be a normal, fully-functional path.
    const result = validateModuleFile(makeModuleInfo(), createNodeCodecRegistry());
    expect(result.ok).toBe(true);
  });
});

describe('validateModuleFile - module_uuid', () => {
  it('passes a well-formed UUID', () => {
    const result = validateModuleFile(makeModuleInfo({ moduleUuid: VALID_UUID }), createNodeCodecRegistry());
    expect(result.issues.some(i => i.code === 'invalid-uuid')).toBe(false);
  });

  it('flags a missing module_uuid as an error', () => {
    const result = validateModuleFile(makeModuleInfo({ moduleUuid: null }), createNodeCodecRegistry());
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-uuid', severity: 'error' })
    );
  });

  it('flags a malformed module_uuid as an error', () => {
    const result = validateModuleFile(makeModuleInfo({ moduleUuid: 'not-a-uuid' }), createNodeCodecRegistry());
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-uuid', severity: 'error' })
    );
  });
});

describe('validateModuleFile - format_version', () => {
  it.each(['0.1', '0.2'])('accepts %s as current/readable, not an issue', version => {
    const result = validateModuleFile(makeModuleInfo({ formatVersion: version }), createNodeCodecRegistry());
    expect(result.issues.some(i => i.code === 'unsupported-format-version')).toBe(false);
    expect(result.formatVersionKind).toBe(version === '0.2' ? 'current' : 'readable');
  });

  it('accepts 2.0 as legacy, not an issue', () => {
    const result = validateModuleFile(makeModuleInfo({ formatVersion: '2.0' }), createNodeCodecRegistry());
    expect(result.issues.some(i => i.code === 'unsupported-format-version')).toBe(false);
    expect(result.formatVersionKind).toBe('legacy');
  });

  it.each(['0.3', '1.0', '', 'x'])('refuses %j as unsupported-format-version', version => {
    const result = validateModuleFile(makeModuleInfo({ formatVersion: version }), createNodeCodecRegistry());
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'unsupported-format-version', severity: 'error' })
    );
  });

  it('refuses a NULL format_version the same as an empty one', () => {
    const result = validateModuleFile(makeModuleInfo({ formatVersion: null }), createNodeCodecRegistry());
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'unsupported-format-version', severity: 'error' })
    );
  });
});

describe('validateModuleFile - compression / codec availability', () => {
  it('does not warn when the registry has the codec', () => {
    const result = validateModuleFile(makeModuleInfo({ compression: 'deflate' }), createNodeCodecRegistry());
    expect(result.issues.some(i => i.code === 'missing-codec')).toBe(false);
  });

  it('warns, but does not fail, when the registry lacks the codec', () => {
    // A registry deliberately narrower than the Node/Electron default - none
    // and deflate only, standing in for "this build has no zstd codec".
    const narrowRegistry = new CodecRegistry([new NoneCodec(), new DeflateCodec()]);
    const result = validateModuleFile(makeModuleInfo({ compression: 'zstd' }), narrowRegistry);

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'missing-codec', severity: 'warning' })
    );
    // A warning must not flip `ok` to false - see this file's top comment on
    // why a codec gap is not an install failure.
    expect(result.ok).toBe(true);
  });

  it('is silent about compression when the column does not exist at all (pre-F2 module)', () => {
    const result = validateModuleFile(
      makeModuleInfo({ withCompressionColumn: false }),
      new CodecRegistry([new NoneCodec()]) // deliberately missing 'deflate' and 'zstd'
    );
    expect(result.issues.some(i => i.code === 'missing-codec')).toBe(false);
  });

  it('treats a NULL compression value as none', () => {
    const result = validateModuleFile(makeModuleInfo({ compression: null }), createNodeCodecRegistry());
    expect(result.issues.some(i => i.code === 'missing-codec')).toBe(false);
  });
});

describe('validateModuleFile - missing or empty module_info', () => {
  it('does not throw, and reports missing-module-info, for a database with no module_info table at all', () => {
    const sql = new TestSqliteProvider(':memory:');
    open.push(sql);
    sql.exec('CREATE TABLE topic (topic_id INTEGER PRIMARY KEY, name TEXT);');

    expect(() => validateModuleFile(sql, createNodeCodecRegistry())).not.toThrow();

    const result = validateModuleFile(sql, createNodeCodecRegistry());
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'missing-module-info', severity: 'error' }),
    ]);
  });

  it('does not throw, and reports missing-module-info, for a module_info table with no info_id = 1 row', () => {
    const sql = makeModuleInfo({ noRow: true });

    expect(() => validateModuleFile(sql, createNodeCodecRegistry())).not.toThrow();

    const result = validateModuleFile(sql, createNodeCodecRegistry());
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'missing-module-info', severity: 'error' }),
    ]);
  });
});

describe('validateModuleFile - a fully valid module', () => {
  it('reports ok: true with no issues at all', () => {
    const result = validateModuleFile(
      makeModuleInfo({ moduleUuid: VALID_UUID, formatVersion: '0.2', compression: 'none' }),
      createNodeCodecRegistry(),
      { header: REAL_HEADER }
    );
    expect(result).toEqual({ ok: true, issues: [], formatVersionKind: 'current' });
  });
});
