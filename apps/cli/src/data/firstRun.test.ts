/**
 * The trimmed KJV, and first-run extraction.
 *
 * The extraction logic runs against a fake host. The module itself is checked
 * against the real artifact produced by `node scripts/build-cli-kjv.js`, which
 * is the only way to know the trim did not remove something the app needs — in
 * particular the empty tables `buildBookIndex()` writes into, whose
 * absence would silently downgrade proximity search.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BibleRepository } from '@bible/core';

import { BunSql } from './BunSql';
import { ensureBookIndex, isBookIndexed } from './bookIndex';
import {
  type FirstRunHost,
  ensureBundledKjv,
  moduleIdentity,
} from './firstRun';
import type { DiscoveredModule, ModuleRoot } from './modules';

const ASSET = join(import.meta.dir, '..', 'assets', 'bible_kjv.db');
const hasAsset = existsSync(ASSET);

const scratch = mkdtempSync(join(tmpdir(), 'firstrun-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// --- extraction decisions ------------------------------------------------

const ROOT: ModuleRoot = { path: '/desktop', kind: 'desktop-user', immutable: false };

function discovered(sha: string): DiscoveredModule {
  return {
    path: '/desktop/bible_kjv.db',
    root: ROOT,
    type: 'bible',
    abbreviation: 'KJV',
    fullName: 'King James Version',
    language: 'en',
    contentSha256: sha,
    schemaVersion: '2.0.0',
    textDirection: 'ltr',
    unsupported: undefined,
  };
}

interface FakeHost extends FirstRunHost {
  written: Map<string, Uint8Array>;
}

/**
 * The fake host needs `moduleIdentity` to succeed on its bytes, so it serves
 * the real trimmed module when one has been built and skips otherwise.
 */
function fakeHost(bundled: Uint8Array | undefined, existing?: Uint8Array): FakeHost {
  const written = new Map<string, Uint8Array>();
  const files = new Map<string, Uint8Array>();
  if (existing) files.set(join('/home/modules', 'bible_kjv.db'), existing);

  return {
    modulesDir: '/home/modules',
    written,
    readBundled: async () => bundled,
    exists: (path) => files.has(path),
    read: (path) => files.get(path) ?? new Uint8Array(),
    write: (path, bytes) => {
      written.set(path, bytes);
      files.set(path, bytes);
    },
  };
}

const assetBytes = (): Uint8Array => new Uint8Array(readFileSync(ASSET));

describe('extraction decisions', () => {
  test('a build with no embedded module says so rather than failing', async () => {
    const result = await ensureBundledKjv({ host: fakeHost(undefined) });
    expect(result.action).toBe('no-bundled-module');
    expect(result.path).toBeUndefined();
  });

  test('an embedded asset that is not a module is recognised as a placeholder', async () => {
    const result = await ensureBundledKjv({
      host: fakeHost(new Uint8Array([1, 2, 3, 4])),
    });
    expect(result.action).toBe('no-bundled-module');
    expect(result.detail).toContain('placeholder');
  });

  test.skipIf(!hasAsset)('extracts on a clean machine', async () => {
    const host = fakeHost(assetBytes());
    const result = await ensureBundledKjv({ host });

    expect(result.action).toBe('extracted');
    expect(result.path).toBe(join('/home/modules', 'bible_kjv.db'));
    expect(host.written.size).toBe(1);
  });

  test.skipIf(!hasAsset)('skips when the same content is already discoverable', async () => {
    const bytes = assetBytes();
    const sha = moduleIdentity(bytes)!.contentSha256;
    const host = fakeHost(bytes);

    const result = await ensureBundledKjv({ host, discovered: [discovered(sha)] });

    // The desktop's copy has the interlinear this build dropped; shadowing it
    // with a lesser copy would be a downgrade.
    expect(result.action).toBe('already-discoverable');
    expect(host.written.size).toBe(0);
  });

  test.skipIf(!hasAsset)('a different KJV does not count as the same content', async () => {
    const host = fakeHost(assetBytes());
    const result = await ensureBundledKjv({ host, discovered: [discovered('a-different-sha')] });
    expect(result.action).toBe('extracted');
  });

  test.skipIf(!hasAsset)('extraction happens once, not on every launch', async () => {
    const bytes = assetBytes();
    const host = fakeHost(bytes);

    expect((await ensureBundledKjv({ host })).action).toBe('extracted');
    host.written.clear();

    expect((await ensureBundledKjv({ host })).action).toBe('already-extracted');
    expect(host.written.size).toBe(0);
  });

  test.skipIf(!hasAsset)('a truncated earlier extraction is replaced, not trusted', async () => {
    // Existence is not enough: a half-written file would otherwise look installed.
    const host = fakeHost(assetBytes(), new Uint8Array([0, 0, 0]));
    expect((await ensureBundledKjv({ host })).action).toBe('extracted');
  });
});

// --- the trimmed module itself -------------------------------------------

describe('the trimmed KJV', () => {
  test.skipIf(!hasAsset)('is a complete Bible', () => {
    const sql = new BunSql(ASSET, { readonly: true });
    expect(sql.queryOne<{ n: number }>('SELECT count(*) AS n FROM bible_verse')?.n).toBe(31102);
    sql.close();
  });

  test.skipIf(!hasAsset)('answers the phrase query from the acceptance criteria', () => {
    const sql = new BunSql(ASSET, { readonly: true });
    const hits = sql.queryOne<{ n: number }>(
      `SELECT count(*) AS n FROM bible_verse_fts WHERE bible_verse_fts MATCH '"everlasting life"'`,
    );
    expect(hits?.n).toBe(11);
    sql.close();
  });

  test.skipIf(!hasAsset)('has no interlinear — the 39 MB that was removed', () => {
    const sql = new BunSql(ASSET, { readonly: true });
    const table = sql.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'interlinear_word'",
    );
    expect(table).toBeUndefined();
    sql.close();
  });

  test.skipIf(!hasAsset)('keeps the search-cache tables, empty', () => {
    // They must exist for buildBookIndex() to fill in; shipping their
    // contents would be shipping a cache.
    const sql = new BunSql(ASSET, { readonly: true });
    for (const table of ['book_search_index', 'book_search_metadata', 'verse_positions']) {
      const exists = sql.queryOne<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      expect(exists).toBeDefined();
      expect(sql.queryOne<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)?.n).toBe(0);
    }
    sql.close();
  });

  test.skipIf(!hasAsset)('reads through core, and reports its own identity', () => {
    const sql = new BunSql(ASSET, { readonly: true });
    const repo = new BibleRepository(sql);

    expect(repo.getVerse(43003016)?.text).toMatch(/everlasting life/i);
    expect(repo.getModuleInfo()?.abbreviation).toBe('KJV');
    sql.close();
  });

  test.skipIf(!hasAsset)('a NEAR query builds the book index and succeeds', () => {
    // The acceptance criterion, and the reason the empty tables are kept. It
    // needs a *writable* copy, which is exactly what the extracted module is.
    const writable = join(scratch, 'bible_kjv.db');
    copyFileSync(ASSET, writable);

    const sql = new BunSql(writable, { create: true });
    const repo = new BibleRepository(sql);

    // The trap this guards against: proximity search does NOT build its own
    // index, and returns an empty array rather than an error when it is missing.
    expect(repo.searchProximityInBook(43, ['everlasting', 'life'], 5)).toEqual([]);
    expect(isBookIndexed(sql, 43)).toBe(false);

    expect(ensureBookIndex(sql, repo, 43).state).toBe('built');
    expect(repo.searchProximityInBook(43, ['everlasting', 'life'], 5).length).toBeGreaterThan(0);

    // The empty tables the trim keeps are what made that possible.
    expect(
      sql.queryOne<{ n: number }>('SELECT count(*) AS n FROM verse_positions')?.n,
    ).toBeGreaterThan(0);

    // Building is a one-off per book.
    expect(ensureBookIndex(sql, repo, 43).state).toBe('ready');
    sql.close();
  });

  test.skipIf(!hasAsset)('proximity search reports unavailable on a read-only module', () => {
    // The desktop's trees are read-only, so this is the normal case there.
    // `buildBookIndex` throws a bare SQLITE_READONLY; `ensureBookIndex` turns
    // that into something a screen can show.
    const sql = new BunSql(ASSET, { readonly: true });
    const repo = new BibleRepository(sql);

    const result = ensureBookIndex(sql, repo, 43);
    expect(result.state).toBe('unavailable');
    expect(result.detail).toContain('read-only');

    // The search itself still does not throw — it just finds nothing.
    expect(() => repo.searchProximityInBook(43, ['everlasting', 'life'], 5)).not.toThrow();
    sql.close();
  });
});
