import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { runPackageCommand } from '../packageCommand';
import { createZip, crc32 } from '../createZip';
import type { SmokeCommandContext } from '../smokeCommand';

interface CapturedCtx extends SmokeCommandContext {
  out: string[];
  err: string[];
}

function makeCtx(cwd: string): CapturedCtx {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    out,
    err,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    writeFile: () => undefined,
  };
}

function writeExtension(root: string): void {
  const manifest = {
    id: 'ext.test.pack',
    name: { key: 'ext.test.pack' },
    version: '2.0.0',
    publisher: 'test',
    engines: { bibleApp: '^1.0.0' },
    main: 'dist/main.js',
  };
  writeFileSync(join(root, 'extension.json'), JSON.stringify(manifest), 'utf8');
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', 'main.js'), 'exports.activate = function(){};', 'utf8');
}

/**
 * Reads back the archive's central directory. Deliberately a separate parse
 * from the writer rather than a round-trip through it, so a symmetrical bug
 * in the writer cannot pass this test.
 */
function listZipEntries(archive: Buffer): { name: string; content: Buffer }[] {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = archive.length - 22; i >= 0; i--) {
    if (archive.readUInt32LE(i) === eocdSig) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');

  const count = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);
  const results: { name: string; content: Buffer }[] = [];

  for (let n = 0; n < count; n++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('bad central header');
    const method = archive.readUInt16LE(cursor + 10);
    const compSize = archive.readUInt32LE(cursor + 20);
    const nameLen = archive.readUInt16LE(cursor + 28);
    const extraLen = archive.readUInt16LE(cursor + 30);
    const commentLen = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLen);

    const localNameLen = archive.readUInt16LE(localOffset + 26);
    const localExtraLen = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = archive.subarray(dataStart, dataStart + compSize);
    results.push({ name, content: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });

    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return results;
}

describe('createZip', () => {
  it('produces an archive whose entries inflate back to the original bytes', () => {
    const archive = createZip([
      { path: 'extension.json', content: Buffer.from('{"id":"x"}', 'utf8') },
      { path: 'dist/main.js', content: Buffer.from('a'.repeat(5000), 'utf8') },
    ]);
    const entries = listZipEntries(archive);

    expect(entries.map((e) => e.name)).toEqual(['extension.json', 'dist/main.js']);
    expect(entries[0]!.content.toString('utf8')).toBe('{"id":"x"}');
    expect(entries[1]!.content.toString('utf8')).toBe('a'.repeat(5000));
  });

  it('actually compresses — a repetitive payload gets smaller, not merely stored', () => {
    const content = Buffer.from('the same sentence over and over. '.repeat(500), 'utf8');
    const archive = createZip([{ path: 'a.txt', content }]);

    expect(archive.length).toBeLessThan(content.length / 4);
  });

  it('computes CRC-32 against the known IEEE check value', () => {
    // The canonical check: CRC-32 of "123456789" is 0xCBF43926.
    expect(crc32(Buffer.from('123456789', 'utf8'))).toBe(0xcbf43926);
  });

  it('is byte-for-byte reproducible across runs', () => {
    const entries = [{ path: 'a.txt', content: Buffer.from('hello', 'utf8') }];
    expect(createZip(entries).equals(createZip(entries))).toBe(true);
  });

  it('writes an empty but well-formed archive for no entries', () => {
    const archive = createZip([]);
    expect(archive.length).toBe(22);
    expect(listZipEntries(archive)).toEqual([]);
  });
});

describe('runPackageCommand', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'package-cli-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('writes <id>-<version>.zip and reports its digest', () => {
    writeExtension(workDir);
    const ctx = makeCtx(workDir);

    expect(runPackageCommand([workDir], ctx)).toBe(0);
    const expected = join(workDir, 'build', 'ext.test.pack-2.0.0.zip');
    expect(existsSync(expected)).toBe(true);
    expect(ctx.out.join('')).toContain('sha256 ');
  });

  it('puts extension.json at the archive root, where the installer looks', () => {
    writeExtension(workDir);
    const ctx = makeCtx(workDir);
    runPackageCommand([workDir], ctx);

    const archive = readFileSync(join(workDir, 'build', 'ext.test.pack-2.0.0.zip'));
    const names = listZipEntries(archive).map((e) => e.name);
    expect(names).toContain('extension.json');
    expect(names).toContain('dist/main.js');
  });

  it('excludes node_modules and source maps without being asked', () => {
    writeExtension(workDir);
    mkdirSync(join(workDir, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(workDir, 'node_modules', 'left-pad', 'index.js'), 'x', 'utf8');
    writeFileSync(join(workDir, 'dist', 'main.js.map'), '{}', 'utf8');
    const ctx = makeCtx(workDir);
    runPackageCommand([workDir], ctx);

    const archive = readFileSync(join(workDir, 'build', 'ext.test.pack-2.0.0.zip'));
    const names = listZipEntries(archive).map((e) => e.name);
    expect(names.some((n) => n.startsWith('node_modules/'))).toBe(false);
    expect(names).not.toContain('dist/main.js.map');
  });

  it('honours .bibleignore patterns', () => {
    writeExtension(workDir);
    mkdirSync(join(workDir, 'test'), { recursive: true });
    writeFileSync(join(workDir, 'test', 'main.test.ts'), '', 'utf8');
    writeFileSync(join(workDir, 'notes.txt'), 'scratch', 'utf8');
    writeFileSync(join(workDir, '.bibleignore'), '# comment\ntest/\nnotes.txt\n', 'utf8');
    const ctx = makeCtx(workDir);
    runPackageCommand([workDir], ctx);

    const archive = readFileSync(join(workDir, 'build', 'ext.test.pack-2.0.0.zip'));
    const names = listZipEntries(archive).map((e) => e.name);
    expect(names.some((n) => n.startsWith('test/'))).toBe(false);
    expect(names).not.toContain('notes.txt');
    expect(names).not.toContain('.bibleignore');
  });

  it('does not archive its own previous output', () => {
    writeExtension(workDir);
    const ctx = makeCtx(workDir);
    runPackageCommand([workDir], ctx);
    runPackageCommand([workDir], makeCtx(workDir));

    const archive = readFileSync(join(workDir, 'build', 'ext.test.pack-2.0.0.zip'));
    const names = listZipEntries(archive).map((e) => e.name);
    expect(names.some((n) => n.startsWith('build/'))).toBe(false);
  });

  it('refuses to build an archive whose entry point is missing', () => {
    writeExtension(workDir);
    rmSync(join(workDir, 'dist'), { recursive: true, force: true });
    const ctx = makeCtx(workDir);

    expect(runPackageCommand([workDir], ctx)).toBe(1);
    expect(ctx.err.join('')).toContain('asset.missing');
    expect(existsSync(join(workDir, 'build'))).toBe(false);
  });

  it('builds anyway under --skip-validate', () => {
    writeExtension(workDir);
    rmSync(join(workDir, 'dist'), { recursive: true, force: true });
    const ctx = makeCtx(workDir);

    expect(runPackageCommand([workDir, '--skip-validate'], ctx)).toBe(0);
  });

  it('refuses when .bibleignore would exclude the manifest itself', () => {
    writeExtension(workDir);
    writeFileSync(join(workDir, '.bibleignore'), 'extension.json\n', 'utf8');
    const ctx = makeCtx(workDir);

    expect(runPackageCommand([workDir], ctx)).toBe(1);
    expect(ctx.err.join('')).toContain('package.manifest-excluded');
  });

  it('honours --out', () => {
    writeExtension(workDir);
    const ctx = makeCtx(workDir);

    expect(runPackageCommand([workDir, '--out=artifacts'], ctx)).toBe(0);
    expect(existsSync(join(workDir, 'artifacts', 'ext.test.pack-2.0.0.zip'))).toBe(true);
  });

  it('emits a JSON report under --json', () => {
    writeExtension(workDir);
    const ctx = makeCtx(workDir);

    expect(runPackageCommand([workDir, '--json'], ctx)).toBe(0);
    const parsed = JSON.parse(ctx.out.join('')) as { ok: boolean; sha256: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
