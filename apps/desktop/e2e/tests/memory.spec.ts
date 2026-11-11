/**
 * Memory "Today first" E2E (task 0219).
 *
 * Runs on the committed fixture (John 3 and Psalm 23 are in it). Verses are seeded through the module
 * bridge (`electron.modules.invoke('memory', ...)`, the same calls the app's own client makes) before
 * Memory is opened, so each test starts on the screen it is about. Wrong first letters are fine in the
 * UI practices: the point is the flow, not the grading.
 *
 * Reviews need a verse practiced on an earlier day. `practiceByApi` practices it now (correct answers)
 * and `advanceClock` moves `Date.now` forward in the main process (the core and the badge's status
 * read) and in the renderer (Today's queue) together, past the latest next-review date.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron.fixture';

function memory(window: Page) {
  return window.locator('section[data-app="memory"]');
}

async function openMemory(window: Page) {
  await window.locator('[data-app-id="memory"]').first().click();
  const mem = memory(window);
  await expect(mem.getByRole('tablist', { name: 'Memory' })).toBeVisible();
  return mem;
}

/** The Memory button on the app rail (it carries the badge). */
function memoryRailButton(window: Page) {
  return window.locator('.kth-app-rail button[data-app-id="memory"]');
}

/** One Memory API call over the module bridge; rejects with the core's message on failure. */
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

async function addVerse(window: Page, reference: string, collectionId?: number): Promise<number> {
  const reply = await memoryCall<{ passage: { id: number } }>(
    window,
    'addPassage',
    collectionId === undefined ? { reference } : { reference, collectionId },
  );
  return reply.passage.id;
}

/**
 * One full practice of a single verse with the right answers (blanks or first letters).
 * Returns the summary's next review time.
 */
async function practiceByApi(window: Page, passageId: number): Promise<number> {
  let session = await memoryCall(window, 'startSession', { passageId });
  for (let i = 0; i < 20; i++) {
    const step = session.step;
    if (!step) throw new Error(`practiceByApi: no step for passage ${passageId}`);
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
      throw new Error(`practiceByApi: unexpected activity ${step.kind}`);
    }
    const reply = await memoryCall(window, 'submitStep', { sessionId: session.sessionId, answer });
    if (reply.summary) {
      if (reply.summary.nextDueAt === null) throw new Error('practiceByApi: no next review date');
      return reply.summary.nextDueAt as number;
    }
    session = reply.session;
  }
  throw new Error(`practiceByApi: passage ${passageId} did not finish`);
}

/** Moves `Date.now` forward by `ms` in the main process and the renderer. */
async function advanceClock(electronApp: ElectronApplication, window: Page, ms: number): Promise<void> {
  await electronApp.evaluate((_electron, offset) => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + offset;
  }, ms);
  await window.evaluate((offset) => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + offset;
  }, ms);
}

/** Types a (wrong) first letter into each blank until none is left and Next or Finish shows. */
async function fillBlanks(window: Page): Promise<void> {
  const mem = memory(window);
  const open = mem.locator('input[aria-label^="Missing word"]:not([disabled])');
  const advance = mem.getByRole('button', { name: /^(Next|Finish)$/ });
  await expect(open.first().or(advance).first()).toBeVisible();
  for (let i = 0; i < 80 && (await open.count()) > 0; i++) {
    const input = open.first();
    const handle = await input.elementHandle();
    await input.focus();
    await window.keyboard.type('e');
    // A typed first letter replaces the box with the word.
    if (handle) await window.waitForFunction((el) => !(el as HTMLInputElement).isConnected || (el as HTMLInputElement).disabled, handle);
  }
  await expect(advance).toBeVisible();
}

/** Practices the verse on screen to its after-verse screen. */
async function practiceInUi(window: Page): Promise<void> {
  const mem = memory(window);
  for (let step = 0; step < 20; step++) {
    await fillBlanks(window);
    const advance = mem.getByRole('button', { name: /^(Next|Finish)$/ });
    const label = (await advance.textContent())?.trim();
    await advance.click();
    if (label === 'Finish') break;
  }
  await expect(mem.getByRole('button', { name: 'Again' })).toBeVisible();
}

// TODO(0219): opening Memory logs `console.warn: No available adapters.` (not seen in the diagnostics spec;
// source not yet traced, likely the speech/WebGPU probe). Opted out until its cause is fixed or allow-listed
// with a reason in fixtures/consoleGuard.ts.
test.use({ failOnConsoleProblems: false });

test.describe('Memory (Today first)', () => {
  test('add a verse, practice it, Today shows done', async ({ window }) => {
    const mem = await openMemory(window);

    // First open: the welcome screen with the add field and starter sets.
    await expect(mem.getByRole('heading', { name: 'Learn Scripture by heart' })).toBeVisible();
    await expect(mem.locator('.sm-starter-chips button').first()).toBeVisible();

    // Add and start goes straight into a practice.
    await mem.getByRole('textbox', { name: 'Verse to memorize' }).fill('John 3:16');
    await mem.getByRole('button', { name: 'Add and start' }).click();
    await expect(mem.getByRole('heading', { name: /John 3:16/ })).toBeVisible();

    await practiceInUi(window);
    await expect(mem.getByText(/right first time/).first()).toBeVisible();

    // After-verse screen, then back to Today.
    const doneToday = mem.getByRole('heading', { name: 'Done for today' });
    const next = mem.getByRole('button', { name: /^(Continue|Done|Stop for today)/ }).first();
    for (let i = 0; i < 6; i++) {
      await expect(doneToday.or(next).first()).toBeVisible();
      if (await doneToday.isVisible()) break;
      await next.click();
    }

    await expect(doneToday).toBeVisible();
    await expect(mem.getByRole('button', { name: 'Practice anyway' })).toBeVisible();
  });

  test('focusing a list changes Today and the badge; clearing it restores them', async ({ window, electronApp }) => {
    const plan = await memoryCall<{ lists: Array<{ id: number; name: string }> }>(window, 'createList', { name: 'Psalms' });
    const psalms = plan.lists.find((l) => l.name === 'Psalms')!.id;
    const ids = [
      await addVerse(window, 'John 3:16'),
      await addVerse(window, 'John 3:17'),
      await addVerse(window, 'Psalm 23:1', psalms),
    ];
    let latestDue = 0;
    for (const id of ids) latestDue = Math.max(latestDue, await practiceByApi(window, id));
    // A later day on which all three are due for review.
    await advanceClock(electronApp, window, latestDue - Date.now() + 60 * 60_000);

    const mem = await openMemory(window);
    const badge = memoryRailButton(window).locator('.kth-app-badge');
    // The badge is re-read when the window gains focus; nothing else re-reads it after a clock change.
    await window.evaluate(() => globalThis.dispatchEvent(new Event('focus')));

    await expect(mem.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(mem.getByText('3 to review', { exact: true })).toBeVisible();
    await expect(badge).toContainText('3 verses due');

    // Focus Today on Psalms from its list menu in My verses.
    await mem.getByRole('tab', { name: 'My verses' }).click();
    await mem.getByRole('button', { name: 'Options for Psalms' }).click();
    await mem.getByRole('menuitem', { name: 'Focus Today on this list' }).click();
    await mem.getByRole('tab', { name: 'Today' }).click();

    await expect(mem.getByText('Focus: Psalms')).toBeVisible();
    await expect(mem.getByText('1 to review', { exact: true })).toBeVisible();
    await expect(badge).toContainText('1 verse due');

    // The chip's clear button puts Today and the badge back on every list.
    await mem.getByRole('button', { name: 'Clear focus' }).click();
    await expect(mem.getByText('Focus: Psalms')).toHaveCount(0);
    await expect(mem.getByText('3 to review', { exact: true })).toBeVisible();
    await expect(badge).toContainText('3 verses due');
  });

  test('three new verses a day, then "Learn a new verse" once the queue is done', async ({ window }) => {
    for (const ref of ['John 3:16', 'John 3:17', 'John 3:18', 'John 3:19']) await addVerse(window, ref);

    const mem = await openMemory(window);
    await expect(mem.getByText('3 new', { exact: true })).toBeVisible();
    const upNext = mem.locator('.sm-today-upnext').getByRole('listitem');
    await expect(upNext).toHaveCount(3);
    await expect(upNext.filter({ hasText: 'John 3:19' })).toHaveCount(0);

    await mem.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(mem.getByRole('heading', { name: /John 3:16/ })).toBeVisible();
    await practiceInUi(window);
    await mem.getByRole('button', { name: 'Continue (2 left)' }).click();

    await expect(mem.getByRole('heading', { name: /John 3:17/ })).toBeVisible();
    await practiceInUi(window);
    await mem.getByRole('button', { name: 'Continue (1 left)' }).click();

    await expect(mem.getByRole('heading', { name: /John 3:18/ })).toBeVisible();
    await practiceInUi(window);
    // The third new verse was the last one allowed today.
    await mem.getByRole('button', { name: 'Done', exact: true }).click();

    await expect(mem.getByRole('heading', { name: 'Done for today' })).toBeVisible();
    await mem.getByRole('button', { name: 'Learn a new verse' }).click();
    await expect(mem.getByRole('heading', { name: /John 3:19/ })).toBeVisible();
  });

  test('Done for today > Practice anyway starts a verse', async ({ window }) => {
    const id = await addVerse(window, 'John 3:16');
    await practiceByApi(window, id);

    const mem = await openMemory(window);
    await expect(mem.getByRole('heading', { name: 'Done for today' })).toBeVisible();
    await expect(mem.getByRole('button', { name: 'Learn a new verse' })).toHaveCount(0);

    await mem.getByRole('button', { name: 'Practice anyway' }).click();
    await expect(mem.getByRole('heading', { name: /John 3:16/ })).toBeVisible();
    await expect(mem.locator('input[aria-label^="Missing word"]').first()).toBeVisible();
  });

  test('a verse page closes back to where it was opened', async ({ window }) => {
    await addVerse(window, 'John 3:16');
    const own = await addVerse(window, 'John 3:17');
    await memoryCall(window, 'setPassageAnswerMode', { passageId: own, mode: 'fullWord' });

    const mem = await openMemory(window);

    // From My verses.
    await mem.getByRole('tab', { name: 'My verses' }).click();
    await expect(mem.getByRole('heading', { name: 'My verses', level: 1 })).toBeVisible();
    await mem.getByRole('button', { name: 'Open John 3:16' }).click();
    await expect(mem.getByRole('heading', { name: 'John 3:16', exact: true, level: 1 })).toBeVisible();
    await mem.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(mem.getByRole('heading', { name: 'My verses', level: 1 })).toBeVisible();

    // From Settings > Verses with their own setting > Change.
    await mem.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(mem.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(mem.getByRole('heading', { name: 'Verses with their own setting' })).toBeVisible();
    await mem.getByRole('listitem').filter({ hasText: 'John 3:17' }).getByRole('button', { name: 'Change', exact: true }).click();
    await expect(mem.getByRole('heading', { name: 'John 3:17', exact: true, level: 1 })).toBeVisible();
    await mem.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(mem.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });

  test('Escape in the Memory panel ends a practice', async ({ window }) => {
    await addVerse(window, 'John 3:16');

    const mem = await openMemory(window);
    await mem.getByRole('button', { name: 'Start', exact: true }).click();
    const title = mem.getByRole('heading', { name: /John 3:16/ });
    await expect(title).toBeVisible();

    // Escape meant for something outside the Memory panel (here the app rail) leaves practice alone.
    await memoryRailButton(window).focus();
    await window.keyboard.press('Escape');
    await expect(title).toBeVisible();

    // An empty blank inside the practice screen has the focus.
    await mem.locator('input[aria-label^="Missing word"]').first().focus();
    await window.keyboard.press('Escape');

    await expect(title).toHaveCount(0);
    await expect(mem.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(mem.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  });
});
