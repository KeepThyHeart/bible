/**
 * Memory performance E2E (task 0219, design-r2 section 1c, subtask P0). Skipped unless `MEMORY_PERF=1`.
 *
 * Seeds 300 verses over the module bridge (ranges of John 3 and Psalm 23 from the committed fixture),
 * practices 40 of them through the API, then cycles the tabs Home > Practice > My verses > Settings (whose
 * first section is Lists) > My verses five times, opens three verse pages, starts practice from the Practice
 * tab twice, changes the List filter five times and leaves and reopens Memory (which opens on Home) twice.
 * The UI's own marks (`packages/memory/src/ui/perf.ts`) do the timing: `memory:screen:<view name>` measures
 * (home, queue, verses, settings, verse, practice), and `window.__memoryPerf` (requests, long tasks).
 *
 * It prints one table (median and p95 per screen, requests per switch, long tasks). Set `MEMORY_PERF_OUT`
 * to also write the numbers as JSON. With `MEMORY_PERF_AFTER=1` it asserts p95 under 100 ms and 0 requests
 * per tab switch after the first load (Settings excepted).
 */

import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron.fixture';

const ENABLED = Boolean(process.env.MEMORY_PERF);
const AFTER = Boolean(process.env.MEMORY_PERF_AFTER);
const OUT = process.env.MEMORY_PERF_OUT;
const TOTAL_VERSES = 300;
const PRACTICED = 40;
const CYCLES = 5;

function memory(window: Page) {
  return window.locator('section[data-app="memory"]');
}

async function openMemory(window: Page) {
  await window.locator('[data-app-id="memory"]').first().click();
  const mem = memory(window);
  await expect(mem.getByRole('tablist', { name: 'Memory' })).toBeVisible();
  return mem;
}

async function closeMemory(window: Page) {
  // Leaving Memory = opening another app on the rail; Escape-free and layout independent.
  const other = window.locator('.kth-app-rail button[data-app-id]:not([data-app-id="memory"])').first();
  await other.click();
  await expect(memory(window)).toBeHidden();
}

async function memoryCall<T = any>(window: Page, method: string, args?: unknown): Promise<T> {
  return window.evaluate(
    async ({ method, args }) => {
      const modules = (globalThis as any).electron.modules;
      const r = await modules.invoke('memory', method, ...(args === undefined ? [] : [args]));
      if (r && typeof r === 'object' && 'ok' in r) {
        if (!r.ok) throw new Error(`memory.${method}: ${r.error?.message ?? 'failed'}`);
        return r.value;
      }
      return r;
    },
    { method, args },
  );
}

/** Distinct references inside John 3 (36 verses) and Psalm 23 (6 verses), short ranges first. */
function references(count: number): string[] {
  const refs: string[] = [];
  for (let span = 0; span < 12 && refs.length < count; span++) {
    for (let s = 1; s <= 36 - span && refs.length < count; s++) refs.push(span === 0 ? `John 3:${s}` : `John 3:${s}-${s + span}`);
    for (let s = 1; s <= 6 - span && refs.length < count; s++) refs.push(span === 0 ? `Psalm 23:${s}` : `Psalm 23:${s}-${s + span}`);
  }
  return refs.slice(0, count);
}

async function practiceByApi(window: Page, passageId: number): Promise<void> {
  let session = await memoryCall(window, 'startSession', { passageId });
  for (let i = 0; i < 20; i++) {
    const step = session.step;
    if (!step) return;
    let answer: unknown;
    if (step.kind === 'blanks') {
      const words = (step.blanks as Array<{ verseId: number; indices: number[] }>).flatMap((b) => {
        const verse = (step.verses as Array<{ verseId: number; words: string[] }>).find((v) => v.verseId === b.verseId)!;
        return b.indices.map((index) => verse.words[index]!);
      });
      answer = { kind: 'blanks', words };
    } else if (step.kind === 'firstletters') {
      answer = { kind: 'firstletters', words: step.verse.words };
    } else {
      await memoryCall(window, 'endSession', { sessionId: session.sessionId });
      return;
    }
    const reply = await memoryCall(window, 'submitStep', { sessionId: session.sessionId, answer });
    if (reply.summary) return;
    session = reply.session;
  }
}

interface Sample {
  step: string;
  screen: string;
  ms: number;
  requests: number;
  longTasks: number;
  longTaskMaxMs: number;
}

/** Reads the UI's counters and the last `memory:screen:<name>` measure. */
async function read(window: Page, screen: string) {
  return window.evaluate((name) => {
    const c = (window as any).__memoryPerf ?? { requests: 0, longTasks: 0, longTaskMaxMs: 0 };
    const entries = performance.getEntriesByName(`memory:screen:${name}`);
    const last = entries[entries.length - 1];
    return { requests: c.requests as number, longTasks: c.longTasks as number, longTaskMaxMs: c.longTaskMaxMs as number, count: entries.length, ms: last ? last.duration : -1 };
  }, screen);
}

/** Runs `action`, waits for the next `memory:screen:<screen>` measure and returns it with the counter deltas. */
async function timed(window: Page, step: string, screen: string, action: () => Promise<void>): Promise<Sample> {
  const before = await read(window, screen);
  await action();
  await window.waitForFunction(
    ({ name, count }) => performance.getEntriesByName(`memory:screen:${name}`).length > count,
    { name: screen, count: before.count },
    { timeout: 15_000 },
  );
  const after = await read(window, screen);
  return {
    step,
    screen,
    ms: after.ms,
    requests: after.requests - before.requests,
    longTasks: after.longTasks - before.longTasks,
    longTaskMaxMs: after.longTaskMaxMs,
  };
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
}

// Same opt-out as memory.spec.ts (opening Memory logs `No available adapters.`; see the TODO there).
test.use({ failOnConsoleProblems: false });

test.describe('Memory performance', () => {
  test.skip(!ENABLED, 'set MEMORY_PERF=1 to run');
  test.setTimeout(20 * 60_000);

  test('tab cycle, verse pages, practice start, List filter, reopen', async ({ window }) => {
    // --- seed ---------------------------------------------------------------------------------
    const ids: number[] = [];
    for (const reference of references(TOTAL_VERSES)) {
      const reply = await memoryCall<{ passage: { id: number } }>(window, 'addPassage', { reference });
      ids.push(reply.passage.id);
    }
    for (const id of ids.slice(0, PRACTICED)) await practiceByApi(window, id);

    // --- measure ------------------------------------------------------------------------------
    const samples: Sample[] = [];
    let mem = await openMemory(window);
    // The screen's h2 (visually hidden on Home); the page h1 is drawn before the data lands.
    await expect(mem.locator('h2.sm-screen-title').first()).toBeAttached();
    await window.evaluate(() => performance.clearMeasures());

    const tab = (name: string) => mem.getByRole('tab', { name, exact: true });
    // [tab label, `memory:screen:` view name, action]; the Practice tab's view is `queue`.
    const steps: Array<[string, string, () => Promise<void>]> = [
      ['Home', 'home', () => tab('Home').click()],
      ['Practice', 'queue', () => tab('Practice').click()],
      ['My verses', 'verses', () => tab('My verses').click()],
      ['Settings', 'settings', () => tab('Settings').click()],
      ['My verses', 'verses', () => tab('My verses').click()],
    ];
    // Leave the tab we start on (Home), so the first click of the cycle is a real switch.
    await tab('Settings').click();
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      for (const [label, screen, action] of steps) {
        const s = await timed(window, `cycle ${label}`, screen, action);
        samples.push({ ...s, step: cycle === 0 ? `first ${label}` : `cycle ${label}` });
      }
    }

    // Verse pages: open three from My verses, close each.
    await tab('My verses').click();
    for (let i = 0; i < 3; i++) {
      const open = mem.locator('tbody tr.sm-verse-row').nth(i * 7).locator('button.sm-verse-ref');
      samples.push(await timed(window, 'verse page', 'verse', () => open.click()));
      const back = mem.locator('button.kth-back');
      await timed(window, 'back to My verses', 'verses', () => back.click());
    }

    // Practice from the Practice tab, twice (Escape ends it).
    for (let i = 0; i < 2; i++) {
      await tab('Practice').click();
      const start = mem.getByRole('button', { name: /^(Start|Continue)$/ }).first();
      if ((await start.count()) === 0) break;
      const before = await read(window, 'practice');
      await start.click();
      await expect(mem.locator('.sm-practice, [data-view="practice"], .sm-step').first()).toBeVisible({ timeout: 15_000 });
      const after = await read(window, 'practice');
      samples.push({ step: 'practice start', screen: 'practice', ms: after.ms, requests: after.requests - before.requests, longTasks: after.longTasks - before.longTasks, longTaskMaxMs: after.longTaskMaxMs });
      await window.keyboard.press('Escape');
    }

    // List filter, five changes.
    await tab('My verses').click();
    const filter = mem.locator('select#sm-verses-list');
    if ((await filter.count()) > 0) {
      const options = await filter.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      for (let i = 0; i < 5; i++) {
        const value = options[(i + 1) % options.length]!; // starts on a change from (All)
        samples.push(await timed(window, 'List filter', 'verses', () => filter.selectOption(value).then(() => undefined)));
      }
    }

    // Leave and reopen Memory twice (it opens on Home).
    for (let i = 0; i < 2; i++) {
      await closeMemory(window);
      const before = await read(window, 'home');
      const t0 = Date.now();
      mem = await openMemory(window);
      const wall = Date.now() - t0;
      const after = await read(window, 'home');
      samples.push({ step: 'reopen Memory', screen: 'home', ms: after.ms >= 0 ? after.ms : wall, requests: after.requests - before.requests, longTasks: after.longTasks - before.longTasks, longTaskMaxMs: after.longTaskMaxMs });
    }

    // --- report -------------------------------------------------------------------------------
    const groups = new Map<string, Sample[]>();
    for (const s of samples) groups.set(`${s.step} (${s.screen})`, [...(groups.get(`${s.step} (${s.screen})`) ?? []), s]);
    const rows = [...groups.entries()].map(([name, list]) => ({
      name,
      n: list.length,
      medianMs: quantile(list.map((s) => s.ms), 0.5),
      p95Ms: quantile(list.map((s) => s.ms), 0.95),
      requestsPerSwitch: list.reduce((a, s) => a + s.requests, 0) / list.length,
      longTasks: list.reduce((a, s) => a + s.longTasks, 0),
      longTaskMaxMs: Math.max(0, ...list.map((s) => s.longTaskMaxMs)),
    }));
    const lines = ['| step | n | median ms | p95 ms | requests / switch | long tasks | max long task ms |', '|---|---:|---:|---:|---:|---:|---:|'];
    for (const r of rows) lines.push(`| ${r.name} | ${r.n} | ${r.medianMs.toFixed(0)} | ${r.p95Ms.toFixed(0)} | ${r.requestsPerSwitch.toFixed(1)} | ${r.longTasks} | ${r.longTaskMaxMs.toFixed(0)} |`);
    // eslint-disable-next-line no-console
    console.log(`\n${lines.join('\n')}\n`);
    if (OUT) writeFileSync(OUT, JSON.stringify({ verses: TOTAL_VERSES, practiced: PRACTICED, rows, samples }, null, 2));

    if (AFTER) {
      for (const r of rows.filter((x) => x.name.startsWith('cycle '))) {
        expect(r.p95Ms, `${r.name} p95`).toBeLessThan(100);
        // Settings reads fresh settings on purpose. The speech probe is counted separately as background work.
        if (!r.name.startsWith('cycle Settings')) expect(r.requestsPerSwitch, `${r.name} requests per switch`).toBe(0);
      }
    }
  });
});
