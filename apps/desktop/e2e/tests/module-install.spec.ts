/**
 * Module Manager: background installs with inline progress.
 *
 * Runs against a throwaway data directory (`BIBLE_DESKTOP_DATA_DIR`) and profile,
 * with a local HTTP catalog serving small generated commentary modules plus one
 * large, slow one - so installing never touches the developer's own `data/`.
 *
 *  - several installs in a row, including a large one, finish without crashing
 *    and the window stays responsive while they run;
 *  - progress shows as a small ring in the module's own row (click: stage,
 *    percent, bytes, Cancel) - there is no separate downloads panel;
 *  - a failed install shows its error in the row with a Retry that works;
 *  - the combined commentary summary is marked Recommended;
 *  - the console stays clean (the fixture's console guard).
 *
 * Set `DEMO_DIR` to also write screenshots there; `E2E_MAIN_JS` to run a build
 * from another folder; `DEMO_SLOW=1` to slow the large download for video.
 */
import { test as base, _electron as electron, expect, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { createConsoleGuard } from '../fixtures/consoleGuard';
import { dismissFirstRunDialog } from '../fixtures/electron.fixture';

const MAIN_JS = process.env.E2E_MAIN_JS ?? path.resolve(__dirname, '../../out/main/index.js');
const DEMO_DIR = process.env.DEMO_DIR;
const SLOW = process.env.DEMO_SLOW === '1';

interface Fixture {
  id: string;
  abbreviation: string;
  name: string;
  recommended?: boolean;
  padMb: number;
  gz: Buffer;
  sha256: string;
  size: number;
}

const MODULES: Array<Pick<Fixture, 'id' | 'abbreviation' | 'name' | 'padMb'> & { recommended?: boolean }> = [
  { id: 'synthesis', abbreviation: 'SYNTHESIS', name: 'Combined Summary', padMb: 1 },
  { id: 'tiny-a', abbreviation: 'TINYA', name: 'Alpha Notes', padMb: 1 },
  { id: 'tiny-b', abbreviation: 'TINYB', name: 'Beta Notes', padMb: 1 },
  { id: 'large', abbreviation: 'LARGE', name: 'Large Study Commentary', padMb: SLOW ? 60 : 24 },
  { id: 'broken', abbreviation: 'BROKEN', name: 'Broken Download', padMb: 1 },
];

function buildModule(dir: string, m: { id: string; abbreviation: string; name: string; padMb: number }): string {
  const file = path.join(dir, `commentary_${m.id}.db`);
  const py = `
import sqlite3, sys, uuid, os
path, pad_mb = sys.argv[1], int(sys.argv[2])
c = sqlite3.connect(path)
c.executescript("""
CREATE TABLE module_info (info_id INTEGER PRIMARY KEY, module_uuid TEXT, canon TEXT, versification TEXT, format_version TEXT, compression TEXT);
CREATE TABLE verse_link (link_id INTEGER PRIMARY KEY);
CREATE TABLE schema_version (version TEXT);
CREATE TABLE pad (id INTEGER PRIMARY KEY, data BLOB);
""")
c.execute("INSERT INTO module_info VALUES (1, ?, 'protestant-66', 'kjv-english', '0.2', 'none')", (str(uuid.uuid4()),))
for i in range(pad_mb):
    c.execute("INSERT INTO pad (data) VALUES (?)", (os.urandom(1024 * 1024),))
c.commit(); c.close()
`;
  execFileSync('python3', ['-c', py, file, String(m.padMb)]);
  return file;
}

function makeFixtures(dir: string): Fixture[] {
  return MODULES.map((m) => {
    const raw = fs.readFileSync(buildModule(dir, m));
    const gz = gzipSync(raw, { level: 1 });
    // "Broken Download" publishes a checksum that does not match, so its install fails verification.
    const sha256 = m.id === 'broken' ? 'ab'.repeat(32) : createHash('sha256').update(raw).digest('hex');
    return { ...m, gz, sha256, size: raw.length };
  });
}

function catalogJson(fixtures: Fixture[], base: string): string {
  return JSON.stringify({
    repository: {
      name: 'Local test catalog', abbreviation: 'TST', version: '1', url: `${base}/catalog.json`,
      last_updated: '2026-10-28', description: 'Generated modules for the install e2e', language: 'en',
    },
    modules: fixtures.map((f) => ({
      module_id: f.id, module_type: 'commentary', name: f.name, abbreviation: f.abbreviation,
      language_code: 'en', version: '1.0', description: `${f.name} (generated test module)`, license: 'Public Domain',
      download_url: `${base}/${f.id}.db.gz`, download_size_bytes: f.gz.length, installed_size_bytes: f.size,
      checksum: `sha256:${f.sha256}`, features: [], tags: [], recommended: false,
      created_date: '2026-10-28', updated_date: '2026-10-28',
    })),
  });
}

/** Serve the catalog and module files; the large one is throttled so its progress is observable. */
function startServer(fixtures: Fixture[]): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = (req.url ?? '').split('?')[0]!;
      const address = server.address() as { port: number };
      if (url === '/catalog.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(catalogJson(fixtures, `http://127.0.0.1:${address.port}`));
        return;
      }
      const f = fixtures.find((x) => url === `/${x.id}.db.gz`);
      if (!f) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': String(f.gz.length) });
      const throttled = f.id === 'large';
      const chunk = 256 * 1024;
      const perTick = SLOW ? 1 : 6;
      let offset = 0;
      const pump = (): void => {
        if (res.destroyed) return;
        for (let i = 0; i < (throttled ? perTick : 64) && offset < f.gz.length; i++) {
          res.write(f.gz.subarray(offset, offset + chunk));
          offset += chunk;
        }
        if (offset >= f.gz.length) res.end();
        else setTimeout(pump, throttled ? 100 : 1);
      };
      pump();
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
  });
}

async function shot(window: Page, name: string): Promise<void> {
  if (!DEMO_DIR) return;
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  await window.screenshot({ path: path.join(DEMO_DIR, `${name}.png`) });
}

const test = base;

test.describe('Module Manager background installs', () => {
  test.setTimeout(240_000);

  test('installs several modules in a row without blocking, with inline progress and retry', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-install-e2e-'));
    const dataDir = path.join(scratch, 'data');
    const userDataDir = path.join(scratch, 'profile');
    fs.mkdirSync(path.join(dataDir, 'modules'), { recursive: true });
    fs.mkdirSync(path.join(userDataDir, 'network'), { recursive: true });
    // This profile has already agreed to network access (the first-run question is not what is under test).
    fs.writeFileSync(path.join(userDataDir, 'network', 'config.json'), JSON.stringify({ allowNetwork: true }));
    const fixtureDir = path.join(scratch, 'fixtures');
    fs.mkdirSync(fixtureDir);

    const fixtures = makeFixtures(fixtureDir);
    const { server, base } = await startServer(fixtures);
    const guard = createConsoleGuard();

    const app = await electron.launch({
      args: ['--password-store=basic', '--no-sandbox', '--disable-dev-shm-usage', MAIN_JS],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_USER_DATA: userDataDir,
        BIBLE_DESKTOP_DATA_DIR: dataDir,
        BIBLE_KEYWORD_INDEX_DIR: path.join(scratch, 'kwi'),
      },
    });
    app.windows().forEach((w) => guard.attach(w));
    app.on('window', (w) => guard.attach(w));

    try {
      const window = await app.firstWindow();
      await window.waitForSelector('[data-testid="app-loaded"]', { timeout: 30_000 });
      await dismissFirstRunDialog(window);

      // Register the local catalog, then open the Module Manager on Commentaries.
      await window.evaluate(async (url) => {
        const api = (globalThis as unknown as { electron: { moduleManager: { init(): Promise<unknown>; addRepository(n: string, u: string, t: string, a?: string): Promise<unknown> } } }).electron;
        await api.moduleManager.init();
        const res = await api.moduleManager.addRepository('Local test catalog', url, 'third_party', 'TST');
        if (res && typeof res === 'object' && 'ok' in res && (res as { ok: boolean }).ok === false) throw new Error(JSON.stringify(res));
      }, `${base}/catalog.json`);
      await window.waitForFunction(() => Boolean(globalThis.__services), null, { timeout: 15_000 });
      await window.evaluate(() => globalThis.__services!.registry.execute('module.openManager'));
      await expect(window.locator('[data-testid="module-manager-dialog"]')).toBeVisible();
      await window.click('[data-testid="module-manager-type-tab-commentary"]');

      // The combined summary is listed first and marked Recommended.
      const rows = window.locator('[data-testid="module-table-commentary"] tr[data-testid^="module-row-"]');
      await expect(rows).toHaveCount(MODULES.length);
      await expect(rows.first()).toHaveAttribute('data-testid', 'module-row-SYNTHESIS');
      await expect(rows.first()).toContainText('Recommended');
      await shot(window, '1-catalog-recommended-synthesis');

      // Start several installs back to back, the large one first.
      for (const abbr of ['LARGE', 'TINYA', 'TINYB', 'SYNTHESIS', 'BROKEN']) {
        await window.click(`[data-testid="module-row-install-${abbr}"]`);
      }

      // Progress is a ring in each row; there is no downloads panel.
      await expect(window.locator('[data-testid="module-row-install-ring-LARGE"]')).toBeVisible();
      await expect(window.getByText(/Active downloads/i)).toHaveCount(0);

      // The UI stays usable meanwhile: switch tabs and filters, open a details panel.
      await window.click('[data-testid="module-manager-type-tab-bible"]');
      await window.click('[data-testid="module-manager-type-tab-commentary"]');
      await window.click('[data-testid="module-row-TINYB"]', { position: { x: 20, y: 10 } });
      await expect(window.locator('[data-testid="module-details-panel"]')).toBeVisible();

      // Click the large module's ring: stage, percent and bytes, with Cancel.
      await window.click('[data-testid="module-row-install-ring-LARGE"]');
      const popover = window.locator('[data-testid="install-popover-LARGE"]');
      await expect(popover).toBeVisible();
      await expect(popover.locator('[data-testid="install-popover-stage"]')).toHaveText(/Downloading|Waiting/);
      await shot(window, '2-large-install-ring-popover');
      await window.keyboard.press('Escape');

      // Small ones finish and flip to Installed; the failure shows in its row with a Retry.
      for (const abbr of ['TINYA', 'TINYB', 'SYNTHESIS']) {
        await expect(window.locator(`[data-testid="module-row-status-${abbr}"]`)).toHaveAttribute('data-status', 'installed', { timeout: 60_000 });
      }
      const brokenRow = window.locator('[data-testid="module-row-BROKEN"]');
      await expect(brokenRow).toContainText(/Checksum verification failed/, { timeout: 60_000 });
      await expect(window.locator('[data-testid="module-row-retry-BROKEN"]')).toBeVisible();
      await shot(window, '3-failed-inline-with-retry');

      // Retry runs it again (and fails again, the same way: the published checksum is wrong).
      await window.click('[data-testid="module-row-retry-BROKEN"]');
      await expect(brokenRow).toContainText(/Checksum verification failed/, { timeout: 60_000 });

      // The large module completes too.
      await expect(window.locator('[data-testid="module-row-status-LARGE"]')).toHaveAttribute('data-status', 'installed', { timeout: 120_000 });
      await shot(window, '4-all-installed');

      // The files are in the scratch data dir, not the developer's.
      expect(fs.readdirSync(path.join(dataDir, 'modules')).filter((n) => n.endsWith('.db')).length).toBe(4);
    } finally {
      await app.close().catch(() => undefined);
      server.close();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    guard.assertClean();
  });
});
