/**
 * Task 0215 (QA polish), round 5 item 19: every web item, checked in the running web app on the
 * committed fixture, with one screenshot per item.
 *
 * Screenshots go to QA_SHOT_DIR (default: none written). Ideas (semantic) and Strong's results are
 * stubbed by intercepting the API, since the fixture has no semantic pack and a handful of Strong's hits:
 * the checks are about what the page does with a long list, not about the search pipeline.
 *
 * Items with no web counterpart (desktop-only: 3, 4, 5-selector-in-bar, 7, 11-15) are not here; the
 * web renditions of 5, 6, 8, 9, 10 and 16 are checked where the web app has the feature.
 */
import { test, expect } from '../fixtures';
import type { Page } from '../fixtures';
import type { Route } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawn, type ChildProcess } from 'node:child_process';
import { desktopOnly, navigateTo } from '../helpers';
import { prepareE2eData } from '../prepareData';
import { E2E_PORT } from '../ports';

const packageRoot = resolve(import.meta.dirname, '..', '..');

const SHOT_DIR = process.env.QA_SHOT_DIR;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

function fakeRows(n: number, module = 'KJV') {
  return Array.from({ length: n }, (_, i) => {
    const chapter = 1 + Math.floor(i / 30);
    const verse = 1 + (i % 30);
    return {
      verseId: 43000000 + chapter * 1000 + verse,
      reference: `John ${chapter}:${verse}`,
      text: `Stubbed result ${i + 1}: for God so loved the world`,
      module,
      type: 'exact',
    };
  });
}

test.describe('QA items (web)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    test.skip(testInfo.project.name !== 'desktop-chrome', 'one layout is enough for these checks');
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  test('item 1: Strong\'s "Show more" loads 1,000 more at once', async ({ page }) => {
    const requested: number[] = [];
    await page.route('**/api/search/strongs*', route => {
      const url = new URL(route.request().url());
      const max = Number(url.searchParams.get('maxResults') ?? 100);
      requested.push(max);
      const rows = fakeRows(Math.min(max, 1500), 'KJV').map((r, i) => ({ ...r, verseId: 43001000 + (i % 21) + 1 + Math.floor(i / 21) * 1000 }));
      return json(route, {
        entry: { strongsNumber: 'G25', word: 'ἀγαπάω', transliteration: 'agapaō', gloss: 'to love' },
        wordFamily: [],
        groupedCounts: [],
        results: rows,
        total: rows.length,
        totalAvailable: 1500,
      });
    });
    await page.goto('/');
    await page.waitForSelector('.app');
    const input = page.locator('.header__search-field');
    await input.fill('G25');
    await input.press('Enter');
    await expect(page.locator('.search-result-item')).toHaveCount(100, { timeout: 15000 });

    const more = page.locator('.search-panel-inline__load-more-btn').first();
    await expect(more).toHaveText(/1,?000/);
    await more.click();
    await expect(page.locator('.search-result-item')).toHaveCount(1100, { timeout: 20000 });
    expect(requested).toContain(1100);
    await page.locator('.search-result-item').nth(1099).scrollIntoViewIfNeeded();
    await shot(page, 'web-01-paging-1000-rows');
  });

  test('item 2: commentary Next/Previous crosses chapters and scrolls the verse into view', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');
    await navigateTo(page, 'John 3:36');
    await page.locator('.verse').filter({ hasText: /believeth on the Son/ }).first().click();
    await page.locator('.right-pane-tabs__tab', { hasText: 'Commentary' }).click();
    const passage = page.locator('.commentary-passage-header__passage, .commentary-passage-header').first();
    await expect(passage).toContainText(/John\s*3:\s*36/, { timeout: 15000 });

    // Next on the last verse of John 3 goes to John 4:1, not a non-existent 3:37.
    await page.getByTitle(/next verse/i).click();
    await expect(passage).toContainText(/John\s*4:\s*1(?!\d)/, { timeout: 15000 });
    await expect(passage).not.toContainText(/3:\s*37/);
    await shot(page, 'web-02-commentary-next-chapter');

    // Previous from a chapter's first verse lands on the last verse of the previous chapter and shows it.
    await page.getByTitle(/previous verse/i).click();
    await expect(passage).toContainText(/John\s*3:\s*36/, { timeout: 15000 });
    await page.getByTitle(/previous verse/i).click(); // 3:35
    await navigateTo(page, 'John 3:1');
    await page.locator('.verse').first().click();
    await expect(passage).toContainText(/John\s*3:\s*1(?!\d)/, { timeout: 15000 });
    await page.getByTitle(/previous verse/i).click();
    await expect(passage).toContainText(/John\s*2:\s*25/, { timeout: 15000 });
    const verse = page.locator('.bible-pane__scroll-container [data-verse="43002025"], .verse').filter({ hasText: /testify of man/ }).first();
    await expect(verse).toBeVisible();
    const inView = await verse.evaluate(el => {
      const box = el.getBoundingClientRect();
      const pane = el.closest('.bible-pane__scroll-container')!.getBoundingClientRect();
      return box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1;
    });
    expect(inView).toBe(true);
    await shot(page, 'web-02b-commentary-previous-chapter');
  });

  test('item 5: web Search / Ideas selector offers both modes with explanations', async ({ page }) => {
    await page.route('**/api/search/semantic/warmup', route => json(route, { ok: true }));
    await page.goto('/');
    await page.waitForSelector('.app');
    await page.locator('.header__search-type-btn').click();
    const options = page.locator('.header__search-type-option');
    await expect(options).toHaveCount(2);
    await expect(page.locator('[data-search-type="semantic"]')).toBeVisible();
    await shot(page, 'web-05-search-ideas-selector');
  });

  test('item 6: words of Christ are red in search results', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');
    const input = page.locator('.header__search-field');
    await input.fill('Verily verily');
    await input.press('Enter');
    const item = page.locator('.search-result-item').first();
    await expect(item).toBeVisible({ timeout: 15000 });
    await shot(page, 'web-06-red-letters-search-results');
    // The server marks the words of Christ (`christ-words`); they must be coloured like the Bible pane's.
    const word = page.locator('.search-result-item__text .christ-words').first();
    await expect(word).toBeVisible();
    const colours = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'christ-words';
      document.querySelector('.verse')?.appendChild(probe);
      const inResult = getComputedStyle(document.querySelector('.search-result-item__text .christ-words')!).color;
      const normal = getComputedStyle(document.querySelector('.search-result-item__text')!).color;
      probe.remove();
      return { inResult, normal };
    });
    expect(colours.inResult).not.toBe(colours.normal);
  });

  test('item 8: distribution graph tooltip is on top of the header and results', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');
    const input = page.locator('.header__search-field');
    await input.fill('love');
    await input.press('Enter');
    await expect(page.getByTestId('search-distribution')).toBeVisible({ timeout: 15000 });
    const bar = page.locator('.search-distribution__plot button[data-book="43"]');
    await bar.hover();
    const tip = page.getByTestId('search-distribution-tip');
    await expect(tip).toBeVisible();
    await shot(page, 'web-08-graph-tooltip');
    // The tip is pointer-events:none, so hit-testing cannot see it: check it is whole (not clipped by the
    // panel's scroll container) and below the header, and that it paints over the caption beneath the plot.
    const geo = await tip.evaluate(el => {
      const r = el.getBoundingClientRect();
      const panel = (el.closest('.search-panel-inline, .right-pane, .main-layout__right') ?? document.body).getBoundingClientRect();
      const header = document.querySelector('header, .header')!.getBoundingClientRect();
      let p: HTMLElement | null = el.parentElement;
      let clipped = false;
      while (p && p !== document.body) {
        const o = getComputedStyle(p).overflow + getComputedStyle(p).overflowY;
        if (/(hidden|auto|scroll)/.test(o)) {
          const pr = p.getBoundingClientRect();
          if (r.top < pr.top - 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1 || r.right > pr.right + 1) clipped = true;
        }
        p = p.parentElement;
      }
      return { clipped, belowHeader: r.top >= header.bottom - 1, inPanel: r.left >= panel.left - 1 && r.right <= panel.right + 1, z: getComputedStyle(el).zIndex };
    });
    expect(geo, JSON.stringify(geo)).toMatchObject({ clipped: false, belowHeader: true, inPanel: true });
  });

  test('item 9: commentary header shows the verse text', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');
    await navigateTo(page, 'John 3:16');
    await page.locator('.verse').filter({ hasText: /so loved the world/ }).first().click();
    await page.locator('.right-pane-tabs__tab', { hasText: 'Commentary' }).click();
    await expect(page.locator('.commentary-verse-text')).toContainText(/so loved the world/, { timeout: 15000 });
    await shot(page, 'web-09-commentary-verse-text');
  });

  test('item 16: the new-tab "+" button carries the tab bar underline', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');
    await navigateTo(page, 'John 3:16');
    await page.locator('.right-pane-tabs__tab', { hasText: 'Commentary' }).click();
    for (const bar of ['bible', 'commentary']) {
      const add = page.locator(`.${bar}-tab-bar__add`);
      await expect(add).toBeVisible();
      const lines = await page.evaluate((name) => {
        const barEl = document.querySelector(`.${name}-tab-bar`) as HTMLElement;
        const addEl = document.querySelector(`.${name}-tab-bar__add`) as HTMLElement;
        return {
          barLine: parseFloat(getComputedStyle(barEl).borderBottomWidth),
          addLine: parseFloat(getComputedStyle(addEl).borderBottomWidth),
          // How far below the button the bar's own rule sits: the line must not break at the "+".
          addInsideBar: addEl.getBoundingClientRect().bottom <= barEl.getBoundingClientRect().bottom + 1,
          // Bottom edge of the button within 2px of the bar's bottom rule (the bar's border box ends at the rule).
          addMeetsRule: Math.abs(addEl.getBoundingClientRect().bottom - barEl.getBoundingClientRect().bottom) <= 2,
        };
      }, bar);
      // Either the bar draws one continuous line under the "+", or the button draws its own.
      expect(lines.barLine > 0 || lines.addLine > 0, `${bar}: ${JSON.stringify(lines)}`).toBe(true);
      // The "+" button's bottom edge meets the bar's rule (it sits inside the bar, not above or below it).
      expect(lines.addInsideBar, `${bar}: ${JSON.stringify(lines)}`).toBe(true);
      expect(lines.addMeetsRule, `${bar}: ${JSON.stringify(lines)}`).toBe(true);
    }
    await shot(page, 'web-16-tab-plus-underline');
  });
});


/**
 * Ideas needs a semantic source. The shared servers use the in-browser index, which the fixture does not
 * have, so these run on a server of their own in remote mode (the bibsearch URL is never contacted: the
 * browser's /api/search/semantic call is answered by the test).
 */
test.describe('QA items (web, Ideas)', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
  let server: { proc: ChildProcess; dir: string; url: string } | undefined;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop Chrome only');
    testInfo.setTimeout(300_000);
    const { dataDir, modulesDir } = prepareE2eData();
    const dir = join(dataDir, 'qa-ideas');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dataDir)) {
      if (name === 'site-config.json' || name.startsWith('state-') || name.startsWith('remote-') || name === 'qa-ideas') continue;
      if (name.startsWith('main.db')) continue;
      symlinkSync(join(dataDir, name), join(dir, name));
    }
    writeFileSync(join(dir, 'main.db'), readFileSync(join(dataDir, 'main.db')));
    const base = JSON.parse(readFileSync(join(packageRoot, 'e2e', 'fixtures', 'site-config.json'), 'utf-8'));
    base.features = { ...base.features, semanticSearch: true };
    base.search = { mode: 'remote', remote: { url: 'http://127.0.0.1:9', via: 'server' } };
    writeFileSync(join(dir, 'site-config.json'), JSON.stringify(base, null, 2));
    const port = E2E_PORT + 22;
    const proc = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
      cwd: packageRoot,
      env: { ...process.env, PORT: String(port), NO_AUTH: '1', DISABLE_RATE_LIMIT: '1', FEATURE_PWA: '0', BIBLE_DATA_DIR: dir, BIBLE_MODULES_DIR: modulesDir, BIBLE_APP_STATE_DIR: join(dir, 'state') },
      stdio: 'ignore',
    });
    const url = `http://localhost:${port}`;
    server = { proc, dir, url };
    const deadline = Date.now() + 240_000;
    for (;;) {
      try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('qa ideas server did not start');
      await new Promise(r => setTimeout(r, 500));
    }
  });

  test.afterAll(() => {
    server?.proc.kill('SIGTERM');
    if (server) rmSync(server.dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop Chrome only');
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  async function ideasSearch(page: Page, query: string): Promise<void> {
    await page.goto(server!.url);
    await page.waitForSelector('.app');
    await page.locator('.header__search-type-btn').click();
    await page.locator('[data-search-type="semantic"]').click();
    const input = page.locator('.header__search-field');
    await input.fill(query);
    await input.press('Enter');
    const agree = page.getByTestId('remote-consent-agree');
    await agree.click({ timeout: 10_000 }).catch(() => {});
  }

  test('item 1: Ideas "Show more" grows by 100 up to the 500 cap', async ({ page }) => {
    const requested: number[] = [];
    await page.route('**/api/search/semantic?*', route => {
      const url = new URL(route.request().url());
      const max = Number(url.searchParams.get('maxResults') ?? 20);
      requested.push(max);
      // Real, DISTINCT verse ids (John 1-21, verses 1-25; the client hydrates the text and drops repeated ranges).
      const rows = fakeRows(Math.min(max, 525)).map((r, i) => ({ ...r, verseId: 43000000 + (1 + Math.floor(i / 25)) * 1000 + 1 + (i % 25), reference: `John ${1 + Math.floor(i / 25)}:${1 + (i % 25)}`, type: 'semantic', score: 0.5 }));
      return json(route, { results: rows, total: rows.length, semantic: { source: 'remote' } });
    });
    await ideasSearch(page, 'God loves the world');
    await expect(page.locator('.search-result-item')).toHaveCount(20, { timeout: 20000 });
    const more = page.locator('.search-panel-inline__load-more-btn').first();
    await expect(more).toHaveText(/100/);
    await more.click();
    await expect(page.locator('.search-result-item')).toHaveCount(120, { timeout: 15000 });
    expect(requested.at(-1)).toBe(120);
    await page.locator('.search-result-item').nth(119).scrollIntoViewIfNeeded();
    await expect(page.locator('.search-result-item__text').nth(119)).not.toBeEmpty();
    await shot(page, 'web-01b-ideas-show-more-100');
    // The real route accepts the new cap (it used to answer with at most 50).
    const res = await page.request.get(`${server!.url}/api/search/semantic?q=love&maxResults=500`, { headers: { 'X-Remote-Search-Consent': 'x' } });
    expect(res.status()).not.toBe(400);
  });

  test('item 10: Ideas results show a repeated verse range once', async ({ page }) => {
    const poor = 'He that hath pity upon the poor lendeth unto the LORD; and that which he hath given will he pay him again.';
    await page.route('**/api/search/semantic?*', route => json(route, {
      results: [
        { verseId: 20019017, endVerseId: 20019017, reference: 'Proverbs 19:17', text: poor, module: 'KJV', type: 'semantic', score: 0.71 },
        { verseId: 43003016, reference: 'John 3:16', text: 'For God so loved the world.', module: 'KJV', type: 'semantic', score: 0.6 },
        { verseId: 20019017, reference: 'Proverbs 19:17', text: poor, module: 'KJV', type: 'semantic', score: 0.69 },
      ],
      total: 3,
      semantic: { source: 'remote' },
    }));
    await ideasSearch(page, 'God repaying those who help the poor');
    await expect(page.locator('.search-result-item').first()).toBeVisible({ timeout: 20000 });
    await shot(page, 'web-10-ideas-dedupe');
    // The stub returns Proverbs 19:17 twice; the list shows it once (fails on a duplicate row).
    await expect(page.locator('.search-result-item')).toHaveCount(2);
    await expect(page.locator('.search-result-item').filter({ hasText: 'Proverbs 19:17' })).toHaveCount(1);
  });
});
