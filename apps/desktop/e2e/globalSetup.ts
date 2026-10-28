/**
 * Builds the keyword-search indexes once, before any spec runs.
 *
 * Bibles, commentaries and topical indexes from the v0.2 catalog ship no FTS table; the app builds a
 * sidecar index for each in the background after startup. In the e2e suite that went wrong twice over:
 * every test launches a fresh app, so search and topic-search specs raced that background build and
 * saw "no results"; and the parallel instances all built into one directory (the unpackaged app keeps
 * them under apps/desktop/data), tearing each other's `.part` files. A torn build is recorded as failed
 * and never retried until the module changes, so search stayed empty in every later run too.
 *
 * Now the suite keeps its indexes in `E2E_KEYWORD_INDEX_DIR`. This launches the app once, lets its
 * background build fill that directory, rebuilds any index left failed, and waits until none is
 * unbuilt, building or failed. A later run finds them ready and returns at once.
 */
import { _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { E2E_KEYWORD_INDEX_DIR } from './fixtures/keywordIndexDir';

const MAIN_JS_PATH = path.resolve(__dirname, '../out/main/index.js');
const BUILD_BUDGET_MS = 15 * 60_000;

interface StatusRow { name: string; state: string }

export default async function globalSetup(): Promise<void> {
  // For a dataset of modules that carry their own FTS tables (a development `data/` dir), where this
  // wait for sidecar indexes would only ever time out. Set E2E_SKIP_KEYWORD_INDEX_SETUP=1.
  if (process.env.E2E_SKIP_KEYWORD_INDEX_SETUP === '1') return;
  if (!fs.existsSync(MAIN_JS_PATH)) return; // the fixture reports the missing build itself
  fs.mkdirSync(E2E_KEYWORD_INDEX_DIR, { recursive: true });
  const userDataDir = path.join(os.tmpdir(), 'bible-e2e', 'keyword-index-setup');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const app = await electron.launch({
    args: ['--password-store=basic', '--no-sandbox', '--disable-dev-shm-usage', MAIN_JS_PATH],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_USER_DATA: userDataDir,
      BIBLE_KEYWORD_INDEX_DIR: E2E_KEYWORD_INDEX_DIR,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="app-loaded"]', { timeout: 120_000 });
    const deadline = Date.now() + BUILD_BUDGET_MS;
    let pending: StatusRow[] = [];
    for (;;) {
      pending = await page.evaluate(async () => {
        const unwrap = (r: unknown): any => (r && typeof r === 'object' && 'ok' in r ? (r as any).value : r);
        const api = (globalThis as any).electron.moduleManager;
        const modules: Array<{ module_id: number; abbreviation?: string; name?: string }> = unwrap(await api.getInstalledModules()) ?? [];
        const rows: StatusRow[] = [];
        for (const m of modules) {
          const status = unwrap(await api.getKeywordIndexStatus(m.module_id));
          if (status?.state) rows.push({ name: m.abbreviation ?? m.name ?? String(m.module_id), state: status.state });
        }
        // A build that failed is never retried on its own (the app waits for the module to change), and an
        // earlier run whose workers raced one another can leave exactly that behind: rebuild those here.
        for (const m of modules) {
          const status = unwrap(await api.getKeywordIndexStatus(m.module_id));
          if (status?.state === 'failed') await api.rebuildKeywordIndex(m.module_id);
        }
        return rows.filter((r) => r.state === 'unbuilt' || r.state === 'building' || r.state === 'failed');
      });
      if (pending.length === 0) break;
      if (Date.now() > deadline) {
        throw new Error(`Keyword indexes still not built after ${BUILD_BUDGET_MS / 60_000} min: ${pending.map((p) => `${p.name} (${p.state})`).join(', ')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } finally {
    await app.close();
  }
}
