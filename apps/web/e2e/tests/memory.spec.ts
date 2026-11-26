/**
 * Memory on the web (task 0219, Round 2): Today / My verses / Lists / Progress at phone width (390x844), plus one
 * desktop-width check.
 *
 * Runs against the accounts server (port base + 2), because Memory needs `features.localUserDb`. Chromium only:
 * the worker DB needs OPFS access handles that Playwright's WebKit build lacks. Each test gets a fresh browser
 * context, so a fresh (empty) user DB.
 *
 * Seeding: the page that owns the user-DB worker is the "leader" and answers requests posted on the
 * BroadcastChannel `kth-userdb` (see apps/web/src/userdb/leader.ts). `memoryCall` posts one `{op:'call',
 * repo:'memory'}` request from the page, as a follower tab would, so the spec seeds without a test hook in the app.
 *
 * `MEMORY_PERF=1` adds the tab-cycle performance block (300 seeded verses); `MEMORY_PERF_OUT` writes the numbers.
 */
import { writeFileSync } from 'node:fs';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { ACCOUNTS_URL } from '../ports';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const TABS = ['Today', 'My verses', 'Lists', 'Progress'] as const;

test.beforeEach(({}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Worker DB + OPFS: desktop Chromium project only (the spec sets its own viewport)');
});

// Opening Memory logs `No available adapters.` (the speech probe), as in the desktop spec; the guard here is the
// Playwright default (no console guard), so nothing to opt out of.

function memory(page: Page): Locator {
  return page.locator('section[data-app="memory"]');
}

async function openMemory(page: Page): Promise<Locator> {
  await page.goto(`${ACCOUNTS_URL}/#/@memory`);
  const mem = memory(page);
  await expect(mem.getByRole('tablist', { name: 'Memory' })).toBeVisible({ timeout: 30_000 });
  return mem;
}

/** One Memory request to the user-DB leader over the BroadcastChannel; rejects with the core's message. */
async function memoryCall<T = any>(page: Page, method: string, args?: unknown): Promise<T> {
  return page.evaluate(({ method, args }) => new Promise<T>((resolve, reject) => {
    const ch = new BroadcastChannel('kth-userdb');
    const from = `e2e-${Math.random().toString(36).slice(2)}`;
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => { ch.close(); reject(new Error(`memory.${method}: timed out`)); }, 20_000);
    ch.addEventListener('message', (e) => {
      const m = e.data as { t?: string; to?: string; id?: number; ok?: boolean; value?: any; error?: { message?: string } };
      if (m?.t !== 'res' || m.to !== from || m.id !== id) return;
      clearTimeout(timer);
      ch.close();
      if (m.ok) resolve(m.value as T);
      else reject(new Error(`memory.${method}: ${m.error?.message ?? 'failed'}`));
    });
    ch.postMessage({ t: 'req', from, id, req: { op: 'call', repo: 'memory', method, args: args === undefined ? [] : [args] } });
  }), { method, args });
}

async function addVerse(page: Page, reference: string, collectionId?: number): Promise<number> {
  const reply = await memoryCall<{ passage: { id: number } }>(page, 'addPassage', collectionId === undefined ? { reference } : { reference, collectionId });
  return reply.passage.id;
}

async function createListApi(page: Page, name: string): Promise<number> {
  const plan = await memoryCall<{ lists: Array<{ id: number; name: string }> }>(page, 'createList', { name });
  return plan.lists.find((l) => l.name === name)!.id;
}

/**
 * Reload the page and wait for Memory's tabs. A reload on `#/@memory` leaves the stage empty in roughly half of the
 * runs (the rail shows, the app never mounts; open issue, see the task thread), so the helper reloads again, up to
 * four times, rather than let a flake hide what the test is about.
 */
async function reloadMemory(page: Page): Promise<Locator> {
  const mem = memory(page);
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.reload();
    const up = await mem.getByRole('tablist', { name: 'Memory' }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
    if (up) return mem;
  }
  await expect(mem.getByRole('tablist', { name: 'Memory' })).toBeVisible({ timeout: 10_000 });
  return mem;
}

/** Opens Memory (so the worker is up), seeds through `seed`, and reloads Memory so the UI reads the seeded data. */
async function openSeeded(page: Page, seed: () => Promise<void>): Promise<Locator> {
  await openMemory(page);
  await seed();
  return reloadMemory(page);
}

/** No horizontal page scroll: neither the document nor the Memory section is wider than the viewport. */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    view: window.innerWidth,
    mem: (document.querySelector('section[data-app="memory"]') as HTMLElement | null)?.scrollWidth ?? 0,
  }));
  expect(widths.doc, 'document scrollWidth').toBeLessThanOrEqual(widths.view);
  expect(widths.body, 'body scrollWidth').toBeLessThanOrEqual(widths.view);
  expect(widths.mem, 'memory section scrollWidth').toBeLessThanOrEqual(widths.view);
}

/** Every tab is fully inside the viewport (no scrolling needed to reach it). */
async function expectTabsInView(page: Page, mem: Locator): Promise<void> {
  const view = page.viewportSize()!;
  for (const name of TABS) {
    const tab = mem.getByRole('tab', { name, exact: true });
    // The tab bar re-renders when the data arrives: measure with a retry.
    await expect(async () => {
      const box = await tab.boundingBox({ timeout: 2_000 });
      expect(box, `${name} box`).not.toBeNull();
      expect(box!.x, `${name} left`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${name} right`).toBeLessThanOrEqual(view.width + 0.5);
      expect(box!.y, `${name} top`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${name} bottom`).toBeLessThanOrEqual(view.height);
    }).toPass({ timeout: 10_000 });
  }
}

/** Types a (wrong) first letter into each blank until none is left and Next or the result shows. */
async function fillBlanks(page: Page): Promise<void> {
  const mem = memory(page);
  const open = mem.locator('input[aria-label^="Missing word"]:not([disabled])');
  const advance = mem.getByRole('button', { name: /^Next$/ });
  const result = mem.locator('.sm-result');
  await expect(open.first().or(advance).or(result).first()).toBeVisible();
  for (let i = 0; i < 80 && (await open.count()) > 0; i++) {
    const input = open.first();
    const handle = await input.elementHandle();
    await input.focus();
    await page.keyboard.type('e');
    if (handle) await page.waitForFunction((el) => !(el as HTMLInputElement).isConnected || (el as HTMLInputElement).disabled, handle);
  }
}

/** Practices the verse on screen until the single result message shows. */
async function practiceInUi(page: Page): Promise<void> {
  const mem = memory(page);
  const result = mem.locator('.sm-result');
  for (let step = 0; step < 20; step++) {
    if (await result.isVisible()) break;
    await fillBlanks(page);
    if (await result.isVisible()) break;
    const advance = mem.getByRole('button', { name: /^Next$/ });
    if (await advance.isVisible()) await advance.click();
  }
  await expect(result).toBeVisible();
  await expect(result).toHaveCount(1);
  await expect(result.getByText(/right first time/)).toBeVisible();
  await expect(mem.getByRole('button', { name: 'Finish' })).toHaveCount(0);
}

async function listOrder(page: Page): Promise<string[]> {
  return (await memory(page).locator('.sm-order-row .sm-order-ref').allTextContents()).map((t) => t.trim());
}

test.describe('Memory on the web (phone width)', () => {
  test.use({ viewport: PHONE });

  test('all four tabs are visible without scrolling and the page does not scroll sideways', async ({ page }) => {
    const mem = await openSeeded(page, async () => {
      const psalms = await createListApi(page, 'Psalms');
      await addVerse(page, 'John 3:16');
      await addVerse(page, 'Psalm 23:1', psalms);
    });
    await expectTabsInView(page, mem);
    await expectNoHorizontalScroll(page);
    for (const name of TABS) {
      await mem.getByRole('tab', { name, exact: true }).click();
      await expect(mem.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(mem.locator('h1').first()).toBeVisible();
      await expectTabsInView(page, mem);
      await expectNoHorizontalScroll(page);
    }
  });

  test('first open: the welcome screen fits and "Add and start" begins a practice with one result message', async ({ page }) => {
    const mem = await openMemory(page);
    await expectTabsInView(page, mem);
    await expect(mem.getByRole('heading', { name: 'Learn Scripture by heart' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await mem.getByRole('textbox', { name: 'Verse to memorize' }).fill('John 3:16');
    await mem.getByRole('button', { name: 'Add and start' }).click();
    await expect(mem.getByRole('heading', { name: /John 3:16/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await practiceInUi(page);
    await expectNoHorizontalScroll(page);
  });

  test('My verses: Add verse dialog with the verse selector and preview adds a verse; List picker filters', async ({ page }) => {
    const mem = await openSeeded(page, async () => {
      const psalms = await createListApi(page, 'Psalms');
      await addVerse(page, 'John 3:16');
      await addVerse(page, 'John 3:17');
      await addVerse(page, 'Psalm 23:1', psalms);
    });
    await mem.getByRole('tab', { name: 'My verses', exact: true }).click();
    await expect(mem.getByRole('heading', { name: 'My verses', level: 1 })).toBeVisible();
    await expect(mem.locator('.sm-verse-row')).toHaveCount(3);
    await expectNoHorizontalScroll(page);

    // The one List picker.
    const picker = mem.locator('select#sm-verses-list');
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: 'Psalms (1)' });
    await expect(mem.locator('.sm-verse-row')).toHaveCount(1);
    await picker.selectOption('all');
    await expect(mem.locator('.sm-verse-row')).toHaveCount(3);

    // Add verse dialog: the selector, the preview, "Add" and "Add and start".
    await mem.getByRole('button', { name: 'Add verse', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add verse' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.kth-verse-selector')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add and start' })).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 0.5);
    await expectNoHorizontalScroll(page);
    await dialog.getByPlaceholder('e.g. John 3:16').fill('John 3:18');
    await expect(dialog.locator('.kth-verse-selector__preview')).toContainText(/\S/, { timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(mem.locator('.sm-verse-row')).toHaveCount(4);
    await expect(mem.locator('.sm-verse-row', { hasText: 'John 3:18' })).toBeVisible();
  });

  test('Lists: reorder with Move up, and the stored order survives a reload', async ({ page }) => {
    const mem = await openSeeded(page, async () => {
      const core = await createListApi(page, 'Core');
      await addVerse(page, 'John 3:16', core);
      await addVerse(page, 'John 3:17', core);
      await addVerse(page, 'John 3:18', core);
    });
    await mem.getByRole('tab', { name: 'Lists', exact: true }).click();
    await mem.locator('.sm-list-row', { hasText: 'Core' }).locator('.sm-list-pick').click();
    await expect.poll(() => listOrder(page)).toEqual(['John 3:16', 'John 3:17', 'John 3:18']);
    await expectNoHorizontalScroll(page);
    await mem.getByRole('button', { name: 'Move John 3:18 up' }).click();
    await mem.getByRole('button', { name: 'Move John 3:18 up' }).click();
    await expect.poll(() => listOrder(page)).toEqual(['John 3:18', 'John 3:16', 'John 3:17']);

    const again = await reloadMemory(page);
    await again.getByRole('tab', { name: 'Lists', exact: true }).click();
    await again.locator('.sm-list-row', { hasText: 'Core' }).locator('.sm-list-pick').click();
    await expect.poll(() => listOrder(page)).toEqual(['John 3:18', 'John 3:16', 'John 3:17']);
  });

  test('practice: Start shows the queue bar, one result message per verse, then Continue', async ({ page }) => {
    const mem = await openSeeded(page, async () => {
      await addVerse(page, 'John 3:16');
      await addVerse(page, 'John 3:17');
    });
    await mem.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(mem.getByRole('heading', { name: /John 3:16/ })).toBeVisible();
    await expect(mem.getByRole('progressbar', { name: 'Practice queue' })).toBeVisible();
    await expect(mem.getByText('0 of 2 done · 2 left')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await practiceInUi(page);
    await expectNoHorizontalScroll(page);
    await mem.getByRole('button', { name: 'Continue (1 left)' }).click();
    await expect(mem.getByRole('heading', { name: /John 3:17/ })).toBeVisible();
    await expect(mem.getByText('1 of 2 done · 1 left')).toBeVisible();
  });

  test('Memorize from the reader: the add-to-list dialog, then Memory with "Practice now"', async ({ page }) => {
    // Study first (the reader), then the context menu on a verse.
    await page.goto(`${ACCOUNTS_URL}/`);
    await page.waitForSelector('.verse', { timeout: 30_000 });
    await page.locator('.verse').nth(0).click({ button: 'right' });
    const menu = page.locator('.verse-context-menu');
    await menu.waitFor({ timeout: 10_000 });
    await menu.locator('[data-action-id="memory.memorize"]').click();

    const dialog = page.getByRole('dialog', { name: /^Add .* to Memory$/ });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 0.5);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden();

    // Memory opens on Today with the "Added ... Practice now" row.
    const mem = memory(page);
    await expect(mem.getByRole('tablist', { name: 'Memory' })).toBeVisible({ timeout: 15_000 });
    const offer = mem.locator('.sm-today-offer');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText(/Added .* to Memory/);
    await expectNoHorizontalScroll(page);
    await offer.getByRole('button', { name: 'Practice now' }).click();
    await expect(mem.locator('input[aria-label^="Missing word"], .sm-step, .sm-practice').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Memory on the web (desktop width)', () => {
  test.use({ viewport: DESKTOP });

  test('four tabs visible, no horizontal scroll, Today starts a verse', async ({ page }) => {
    const mem = await openSeeded(page, async () => {
      await addVerse(page, 'John 3:16');
    });
    await expectTabsInView(page, mem);
    await expectNoHorizontalScroll(page);
    for (const name of TABS) {
      await mem.getByRole('tab', { name, exact: true }).click();
      await expect(mem.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
    await mem.getByRole('tab', { name: 'Today', exact: true }).click();
    await mem.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(mem.getByRole('heading', { name: /John 3:16/ })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------
// Performance (MEMORY_PERF=1): cycles the four tabs 5 times at 300 seeded verses.
// ---------------------------------------------------------------------------------------------------------

const PERF = Boolean(process.env.MEMORY_PERF);
const PERF_OUT = process.env.MEMORY_PERF_OUT;
const PERF_VERSES = Number(process.env.MEMORY_PERF_VERSES ?? 300);
const CYCLES = 5;

/** Distinct references inside John 3 (36 verses) and Psalm 23 (6 verses), short ranges first. */
function references(count: number): string[] {
  const refs: string[] = [];
  for (let span = 0; span < 12 && refs.length < count; span++) {
    for (let s = 1; s <= 36 - span && refs.length < count; s++) refs.push(span === 0 ? `John 3:${s}` : `John 3:${s}-${s + span}`);
    for (let s = 1; s <= 6 - span && refs.length < count; s++) refs.push(span === 0 ? `Psalm 23:${s}` : `Psalm 23:${s}-${s + span}`);
  }
  return refs.slice(0, count);
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
}

async function readPerf(page: Page, screen: string) {
  return page.evaluate((name) => {
    const c = (window as any).__memoryPerf ?? { requests: 0, longTasks: 0, longTaskMaxMs: 0 };
    const entries = performance.getEntriesByName(`memory:screen:${name}`);
    const last = entries[entries.length - 1];
    return { requests: c.requests as number, longTasks: c.longTasks as number, count: entries.length, ms: last ? last.duration : -1 };
  }, screen);
}

test.describe('Memory performance (web)', () => {
  test.skip(!PERF, 'set MEMORY_PERF=1 to run');
  test.use({ viewport: PHONE });

  test('tab cycle at 300 seeded verses', async ({ page }) => {
    test.setTimeout(20 * 60_000); // after the file's beforeEach, which sets the shorter default
    await openMemory(page);
    const refs = references(PERF_VERSES);
    for (const reference of refs) await addVerse(page, reference);
    const mem = await reloadMemory(page);
    await expect(mem.locator('h1').first()).toBeVisible();
    await page.evaluate(() => performance.clearMeasures());

    const screens: Record<string, string> = { Today: 'today', 'My verses': 'verses', Lists: 'lists', Progress: 'progress' };
    const samples: Array<{ tab: string; ms: number; requests: number; longTasks: number; first: boolean }> = [];
    // Leave the tab we start on so every click is a real switch.
    await mem.getByRole('tab', { name: 'Progress', exact: true }).click();
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      for (const name of TABS) {
        const screen = screens[name]!;
        const before = await readPerf(page, screen);
        await mem.getByRole('tab', { name, exact: true }).click();
        await page.waitForFunction(({ n, count }) => performance.getEntriesByName(`memory:screen:${n}`).length > count, { n: screen, count: before.count }, { timeout: 15_000 });
        const after = await readPerf(page, screen);
        samples.push({ tab: name, ms: after.ms, requests: after.requests - before.requests, longTasks: after.longTasks - before.longTasks, first: cycle === 0 });
      }
    }
    const rows = TABS.map((name) => {
      const all = samples.filter((s) => s.tab === name);
      const warm = all.filter((s) => !s.first);
      return {
        tab: name,
        n: all.length,
        medianMs: quantile(all.map((s) => s.ms), 0.5),
        p95Ms: quantile(all.map((s) => s.ms), 0.95),
        warmMedianMs: quantile(warm.map((s) => s.ms), 0.5),
        warmP95Ms: quantile(warm.map((s) => s.ms), 0.95),
        requestsPerSwitch: all.reduce((a, s) => a + s.requests, 0) / all.length,
        warmRequestsPerSwitch: warm.reduce((a, s) => a + s.requests, 0) / Math.max(1, warm.length),
        longTasks: all.reduce((a, s) => a + s.longTasks, 0),
      };
    });
    const lines = ['| tab | n | median ms | p95 ms | warm median | warm p95 | requests/switch | warm requests/switch | long tasks |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
    for (const r of rows) lines.push(`| ${r.tab} | ${r.n} | ${r.medianMs.toFixed(0)} | ${r.p95Ms.toFixed(0)} | ${r.warmMedianMs.toFixed(0)} | ${r.warmP95Ms.toFixed(0)} | ${r.requestsPerSwitch.toFixed(1)} | ${r.warmRequestsPerSwitch.toFixed(1)} | ${r.longTasks} |`);
    // eslint-disable-next-line no-console
    console.log(`\n${lines.join('\n')}\n`);
    if (PERF_OUT) writeFileSync(PERF_OUT, JSON.stringify({ platform: 'web', viewport: PHONE, verses: refs.length, cycles: CYCLES, rows, samples }, null, 2));
  });
});
