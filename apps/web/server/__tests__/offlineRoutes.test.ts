import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import BetterSqlite3 from 'better-sqlite3-web';
import { createOfflineRoutes } from '../routes/offlineRoutes';
import { createModuleRoutes } from '../routes/moduleRoutes';
import { createCompression } from '../middleware/compression';
import { ensureOfflineFile } from '../offline/offlineFiles';
import { parseAssetIndex } from '../../../../packages/core/src/assets/manifest';
import type { SiteSettings } from '../siteSettings';

// Fixture data dir: two tiny modules plus one hidden Bible. No real data needed.
let root: string;
let fakeDb: any;
const hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function mod(moduleType: string, abbreviation: string, name: string, file: string) {
  return { moduleType, abbreviation, moduleName: name, languageCode: 'en', databasePath: file, getAbbreviation: () => abbreviation };
}

function makeDb(file: string, moduleType: 'bible' | 'dictionary', rows: number): void {
  const d = new BetterSqlite3(join(root, 'modules', file));
  d.exec('CREATE TABLE module_info (module_name TEXT); CREATE TABLE schema_version (v INTEGER);');
  d.exec("INSERT INTO module_info VALUES ('x'); INSERT INTO schema_version VALUES (1);");
  if (moduleType === 'bible') {
    d.exec('CREATE TABLE bible_verse (verse_id INTEGER PRIMARY KEY, text TEXT)');
    const ins = d.prepare('INSERT INTO bible_verse (text) VALUES (?)');
    for (let i = 0; i < rows; i++) ins.run(`In the beginning verse number ${i} of the fixture text`);
  } else {
    d.exec('CREATE TABLE dictionary_entry (entry_id INTEGER PRIMARY KEY, word TEXT, definition TEXT, usage_notes TEXT)');
    const ins = d.prepare('INSERT INTO dictionary_entry (word, definition) VALUES (?, ?)');
    for (let i = 0; i < rows; i++) ins.run(`word${i}`, `definition text ${i}`);
  }
  d.close();
}

const settings: SiteSettings = {
  bibles: {
    modules: {
      KJV: { active: true, shortName: 'King James', title: 'King James Version' },
      HID: { active: false },
    },
    sections: [],
  },
  commentaries: { modules: {}, sections: [] },
  dictionaries: { modules: { WEB: { active: true } }, sections: [] },
};

function appFor(enabled: boolean, s: SiteSettings | null = settings) {
  const app = express();
  app.use(createCompression());
  app.use('/api/offline', createOfflineRoutes(fakeDb, s, () => enabled));
  app.use('/api', createModuleRoutes(fakeDb, s));
  return app;
}

const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'offline-routes-'));
  mkdirSync(join(root, 'modules'), { recursive: true });
  makeDb('kjv.db', 'bible', 300);
  makeDb('hid.db', 'bible', 10);
  makeDb('web.db', 'dictionary', 100);
  const mods = [
    mod('bible', 'KJV', 'King James Version (raw)', 'kjv.db'),
    mod('bible', 'HID', 'Hidden', 'hid.db'),
    mod('dictionary', 'WEB', 'Webster', 'web.db'),
  ];
  fakeDb = {
    dataDir: root,
    getModuleMetadataRepo: () => ({ getAll: () => mods }),
    resolveModulePath: (p: string) => join(root, 'modules', p),
  };
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('offline manifest', () => {
  it('404s when the offline features are off', async () => {
    const app = appFor(false);
    expect((await request(app).get('/api/offline/manifest')).status).toBe(404);
    expect((await request(app).get('/api/offline/files/module.kjv/sabc/x.db.gz')).status).toBe(404);
  });

  it('lists only settings-visible modules and parses as an AssetIndex', async () => {
    const res = await request(appFor(true)).get('/api/offline/manifest');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body.schema).toBe('kth-asset-index/1');
    const ids = res.body.assets.map((a: any) => a.id).sort();
    expect(ids).toEqual(['module.kjv', 'module.web']);

    const parsed = parseAssetIndex(res.body, 'https://example.test/api/offline/manifest');
    expect(parsed.rejected).toEqual([]);
    expect(parsed.assets).toHaveLength(2);
    const kjv = parsed.assets.find((a) => a.id === 'module.kjv')!;
    expect(kjv.files[0].url).toMatch(/^https:\/\/example\.test\/api\/offline\/files\/module\.kjv\/s[0-9a-f]{16}\//);
    expect(kjv.kind).toBe('module');
    expect(kjv.license).toBe('unspecified');
  });

  it('names the file by the shortName that /api/modules returns, not the db abbreviation', async () => {
    const app = appFor(true);
    const mods = (await request(app).get('/api/modules')).body as any[];
    const listed = mods.find((m) => m.name === 'King James Version')!;
    expect(listed.abbreviation).toBe('King James');

    const a = (await request(app).get('/api/offline/manifest')).body.assets.find((x: any) => x.id === 'module.kjv');
    expect(a.meta.abbreviation).toBe(listed.abbreviation);
    expect(a.files[0].path).toBe('King James.db.gz');
    expect(a.title).toBe('King James Version');
    expect(a.meta).toMatchObject({ moduleType: 'bible', languageCode: 'en', encoding: 'gzip' });
    expect(a.meta.storedSize).toBeGreaterThan(a.size);
    expect(a.version).toBe(`s${a.files[0].sha256.slice(0, 16)}`);
    // The file is addressable by the db abbreviation id with the client-named file.
    const ok = await request(app).get(`/api/offline/${a.files[0].url}`);
    expect(ok.status).toBe(200);
  });

  it('is empty without settings (fail-safe, as /api/modules)', async () => {
    const res = await request(appFor(true, null)).get('/api/offline/manifest');
    expect(res.body.assets).toEqual([]);
  });
});

describe('offline files', () => {
  async function entry(id: string) {
    const res = await request(appFor(true)).get('/api/offline/manifest');
    const a = res.body.assets.find((x: any) => x.id === id);
    return { a, url: `/api/offline/${a.files[0].url}` };
  }

  it('serves the exact gz bytes: sha matches, no Content-Encoding, immutable', async () => {
    const { a, url } = await entry('module.web');
    const res = await request(appFor(true)).get(url).set('Accept-Encoding', 'gzip').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-type']).toContain('application/gzip');
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable, no-transform');
    expect(res.headers.etag).toBeTruthy();
    const body = res.body as Buffer;
    expect(body.length).toBe(a.files[0].size);
    expect(hex(body)).toBe(a.files[0].sha256);
    expect(gunzipSync(body).length).toBe(a.meta.storedSize);
  });

  it('answers Range with 206 over the gz bytes', async () => {
    const { a, url } = await entry('module.kjv');
    const full = readFileSync(join(root, 'lite-cache', 'offline', 'kjv.db.gz'));
    const res = await request(appFor(true)).get(url).set('Range', 'bytes=10-29').set('Accept-Encoding', 'gzip').buffer(true).parse(binary);
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 10-29/${a.files[0].size}`);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect((res.body as Buffer).equals(full.subarray(10, 30))).toBe(true);
  });

  it('404s for a stale version, a wrong name, a hidden or unknown module', async () => {
    const app = appFor(true);
    const { url } = await entry('module.web');
    const parts = url.split('/');
    const stale = [...parts]; stale[stale.length - 2] = 'sdeadbeefdeadbeef';
    expect((await request(app).get(stale.join('/'))).status).toBe(404);
    const wrong = [...parts]; wrong[wrong.length - 1] = 'other.db.gz';
    expect((await request(app).get(wrong.join('/'))).status).toBe(404);
    expect((await request(app).get('/api/offline/files/module.hid/sabc/HID.db.gz')).status).toBe(404);
    expect((await request(app).get('/api/offline/files/module.nope/sabc/x.db.gz')).status).toBe(404);
  });

  it('regenerates when the source is newer, and shares one in-flight build', async () => {
    const paths = { dbPath: join(root, 'modules', 'web.db'), liteCacheDir: join(root, 'lite-cache') };
    const ref = { moduleType: 'dictionary', abbreviation: 'WEB' };
    const [x, y] = await Promise.all([ensureOfflineFile(ref, paths), ensureOfflineFile(ref, paths)]);
    expect(x).toEqual(y);
    expect(readFileSync(`${x.file}.sha256`, 'utf8').startsWith(x.sha256)).toBe(true);
    const future = new Date(Date.now() + 60_000);
    utimesSync(paths.dbPath, future, future);
    const again = await ensureOfflineFile(ref, paths);
    expect(again.sha256).toBe(x.sha256); // same content; regenerated, not stale-served
    expect(readFileSync(again.file).length).toBe(again.size);
  });
});

describe('module downloads honour the settings filter', () => {
  it('404s download and download-lite for a hidden module', async () => {
    const app = appFor(true);
    expect((await request(app).get('/api/modules/HID/download')).status).toBe(404);
    expect((await request(app).get('/api/modules/HID/download-lite')).status).toBe(404);
    expect((await request(app).get('/api/modules/KJV/download')).status).toBe(200);
  });
});
