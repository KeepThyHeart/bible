// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { serverModules } from './serverModules';
import { gamesManifest } from './games/manifest';
import { validateBuiltinManifest } from '../core';
import { clearRouteRegistry } from '../routes/routeRegistry';

// Importing the module graph is slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const flags = { isEnabled: () => true };

beforeEach(() => {
  clearRouteRegistry();
  vi.resetModules();
});

async function freshLoad(overrides: Record<string, boolean>) {
  const loader = await import('./loadServerModules');
  const registry = await import('../routes/routeRegistry');
  registry.clearRouteRegistry();
  const handle = await loader.loadServerModules({ flags, overrides: () => overrides });
  return { loader, registry, handle };
}

/** Just enough of DatabaseManager for the catalog: one Bible with four verses. */
function stubDb() {
  const rows = [
    { verseId: 43003016, text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', wordCount: 30 },
    { verseId: 43003017, text: 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.', wordCount: 22 },
    { verseId: 19023001, text: 'The LORD is my shepherd; I shall not want.', wordCount: 9 },
    { verseId: 1001001, text: 'In the beginning God created the heaven and the earth.', wordCount: 10 },
  ];
  const repo = {
    getModuleInfo: () => ({ abbreviation: 'KJV', fullName: 'King James Version', languageCode: 'en', licenseSpdx: 'PD' }),
    getVerseCount: () => rows.length,
    getVerseRange: (a: number, b: number) => rows.filter((r) => r.verseId >= a && r.verseId <= b),
  };
  return {
    getModuleMetadataRepo: () => ({ getByType: () => [{ abbreviation: 'KJV', getAbbreviation: () => 'KJV' }] }),
    getBibleRepo: (abbr: string) => (abbr.toUpperCase() === 'KJV' ? repo : null),
  } as never;
}

describe('games server module', () => {
  it('manifest validates and the table has games', () => {
    expect(validateBuiltinManifest(gamesManifest)).toEqual([]);
    expect(serverModules.map((m) => m.manifest.id)).toContain('games');
    expect(gamesManifest.contributes.serverRoutes?.map((r) => r.path)).toEqual(['/api/games', '/games']);
  });

  it('enabled: the API and the page register under moduleId games', async () => {
    const { registry } = await freshLoad({});
    expect(registry.listRoutes('games').map((r) => r.path).sort()).toEqual(['/api/games', '/games']);
  });

  it('disabled: no games file is imported and nothing is registered', async () => {
    const imported = vi.fn();
    vi.doMock('./games/gamesRoutes', () => { imported('routes'); return {}; });
    vi.doMock('./games/gamesPages', () => { imported('pages'); return {}; });
    const { registry, loader } = await freshLoad({ games: false });
    expect(imported).not.toHaveBeenCalled();
    expect(registry.listRoutes('games')).toEqual([]);
    expect(loader.listServerModules().find((m) => m.id === 'games')).toMatchObject({ enabled: false });
    vi.doUnmock('./games/gamesRoutes');
    vi.doUnmock('./games/gamesPages');
  });

  it('disabled: declared paths answer FEATURE_UNAVAILABLE', async () => {
    await freshLoad({ games: false });
    const unavailable = await import('./unavailableRoutes');
    const app = express();
    app.use(unavailable.createUnavailableRoutes());
    const api = await request(app).get('/api/games/catalog').set('Accept', 'application/json');
    expect(api.status).toBe(404);
    expect(api.body.error).toMatchObject({ code: 'FEATURE_UNAVAILABLE', feature: 'games' });
    const page = await request(app).get('/games/play').set('Accept', 'text/html');
    expect(page.status).toBe(404);
    expect(page.text).toContain('This feature is not available on this server.');
  });

  describe('enabled, mounted', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'games-module-'));
      mkdirSync(join(dir, 'client', 'games'), { recursive: true });
      writeFileSync(join(dir, 'client', 'games', 'play.html'), '<p>play</p>');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    async function mounted() {
      const { registry } = await freshLoad({});
      const app = express();
      app.use(express.json());
      const deps = { db: stubDb(), siteSettings: null, extra: { appStateDir: join(dir, 'state'), clientDir: join(dir, 'client') } };
      for (const reg of registry.listRoutes('games')) app.use(reg.path, reg.createRoutes(deps));
      return app;
    }

    it('serves the phone page no-store at /games/play and below it', async () => {
      const app = await mounted();
      for (const url of ['/games/play', '/games/play/', '/games/play?room=ABCD2345', '/games/screen?room=ABCD2345&t=x', '/games/solo']) {
        const res = await request(app).get(url);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.text).toBe('<p>play</p>');
      }
    });

    it('answers the catalog from the host Bible and the built content database', async () => {
      const app = await mounted();
      const res = await request(app).get('/api/games/catalog');
      expect(res.status).toBe(200);
      expect(res.body.translations).toEqual(['KJV']);
      expect(res.body.games.length).toBeGreaterThanOrEqual(9);
      const { existsSync } = await import('fs');
      expect(existsSync(join(dir, 'state', 'games', 'content.db'))).toBe(true);
    });

    it('syncs the clock and creates a room under /api/games', async () => {
      const app = await mounted();
      const time = await request(app).post('/api/games/time').send({ t0: 5 });
      expect(time.body).toMatchObject({ t0: 5 });
      expect(typeof time.body.tServer).toBe('number');
      const created = await request(app).post('/api/games/rooms').send({ settings: {} });
      expect(created.status).toBe(201);
      expect(created.body.code).toMatch(/^[A-Z0-9]+$/);
      expect(created.body.ownerToken).toBeTruthy();
      // The old, unprefixed paths are gone.
      expect((await request(app).post('/api/rooms').send({})).status).toBe(404);
    });
  });
});
