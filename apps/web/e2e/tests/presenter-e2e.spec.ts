import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { desktopOnly } from '../helpers';

/**
 * The projection viewer, driven the way a controller drives it.
 *
 * These run against the real server and the real built bundle because that is
 * the only place the interesting failures live: the viewer is a *second* HTML
 * entry point, so a mistake in how it is built or routed produces a page that
 * still returns 200 and still renders something -- just the wrong thing.
 */

const JOHN_3 = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };
const JOHN_3_16 = 43003016;
const JOHN_3_17 = 43003017;

interface Session {
  sessionId: string;
  joinCode: string;
  controlToken: string;
}

async function createSession(request: APIRequestContext): Promise<Session> {
  const res = await request.post('/api/present/sessions', { data: { name: 'e2e' } });
  expect(res.status()).toBe(201);
  return res.json() as Promise<Session>;
}

async function send(request: APIRequestContext, session: Session, intent: unknown): Promise<void> {
  const res = await request.post(`/api/present/s/${session.sessionId}/intent`, {
    headers: { 'X-Present-Token': session.controlToken },
    data: { intent },
  });
  expect(res.status()).toBe(200);
}

/** Put John 3 on the wall, anchored at verse 16, and wait for it to land. */
async function showJohn3(request: APIRequestContext, session: Session, page: Page): Promise<void> {
  await send(request, session, { type: 'show', item: JOHN_3, index: 16 });
  await expect(page.locator('.pv-verse--anchor')).toBeVisible({ timeout: 10000 });
}

test.describe('Projection viewer', () => {
  test.beforeEach(async ({}, testInfo) => {
    // The viewer is a fixed-layout page for a television; running it through
    // every phone profile tests the profiles, not the viewer.
    desktopOnly(testInfo);
  });

  test('serves the viewer page, not the reading app', async ({ page, request }) => {
    // The regression this exists for: the viewer route sits above the SPA
    // catch-all, and if it goes missing the catch-all answers the same URL with
    // the reading app's shell. That is a 200 with HTML, so a status check calls
    // it a pass while the television shows a Bible reader nobody can drive.
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);

    await expect(page.locator('#present-viewer')).toBeAttached();
    await expect(page.locator('#app .app')).toHaveCount(0);
  });

  test('shows the join code while it waits for the presenter', async ({ page, request }) => {
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);

    const code = page.locator('.pv-lobby-code');
    await expect(code).toBeVisible();
    expect((await code.textContent())?.replace(/\s/g, '')).toBe(session.joinCode);
  });

  test('offers a code to scan as well as one to type', async ({ page, request }) => {
    // Pointing a camera at the screen is the difference between a room that
    // joins and a room that does not. It has to be a real image, not a broken
    // one: an <img> that failed to load still occupies the DOM.
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);

    const qr = page.locator('.pv-lobby-qr');
    await expect(qr).toBeVisible();
    await expect.poll(() => qr.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);

    // It leaves the screen once anything is being presented; the wall is not
    // the place for a join code once a service has started.
    await showJohn3(request, session, page);
    await expect(qr).toHaveCount(0);
  });

  test('follows the controller onto a passage', async ({ page, request }) => {
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);
    await showJohn3(request, session, page);

    // Book and chapter only: a reference carrying the verse would change on
    // every advance and flicker at the top of the screen.
    await expect(page.locator('.pv-heading')).toHaveText('John 3');
    await expect(page.locator('.pv-verse--anchor')).toContainText('For God so loved');
  });

  test('renders every word addressably', async ({ page, request }) => {
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);
    await showJohn3(request, session, page);

    const words = page.locator('.pv-verse--anchor .pv-w');
    expect(await words.count()).toBeGreaterThan(20);

    // 0-based and sequential is the protocol's addressing scheme; if this drifts,
    // every highlight lands on the wrong words.
    const indices = await words.evaluateAll(els =>
      els.map(el => Number(el.getAttribute('data-word-index'))));
    expect(indices).toEqual(indices.map((_, i) => i));
  });

  test('lights exactly the words the controller asked for', async ({ page, request }) => {
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);
    await showJohn3(request, session, page);

    // Words 2-5 of John 3:16 -- "so loved the world".
    await send(request, session, {
      type: 'setHighlight',
      highlight: { verseIdStart: JOHN_3_16, textStart: 2, textEnd: 5 },
    });

    const lit = page.locator('.pv-w--hl');
    await expect(lit).toHaveCount(4);
    // "world," with its comma: words are *indexed* on their bare text so that
    // "world" and "world," are the same word, and *rendered* with punctuation
    // intact so the wall reads as written.
    expect((await lit.allTextContents()).join(' ').replace(/\s+/g, ' ').trim())
      .toBe('so loved the world,');

    // And nowhere else on the screen.
    await expect(page.locator('.pv-verse:has(.pv-w--hl)')).toHaveCount(1);
  });

  test('clears a highlight without disturbing the passage', async ({ page, request }) => {
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);
    await showJohn3(request, session, page);

    await send(request, session, {
      type: 'setHighlight',
      highlight: { verseIdStart: JOHN_3_16, textStart: 2, textEnd: 5 },
    });
    await expect(page.locator('.pv-w--hl')).toHaveCount(4);

    await send(request, session, { type: 'clearHighlight' });
    await expect(page.locator('.pv-w--hl')).toHaveCount(0);
    await expect(page.locator('.pv-verse--anchor')).toContainText('For God so loved');
  });

  test('carries a highlight across a verse boundary', async ({ page, request }) => {
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);
    await showJohn3(request, session, page);

    await send(request, session, {
      type: 'setHighlight',
      highlight: {
        verseIdStart: JOHN_3_16, textStart: 26,
        verseIdEnd: JOHN_3_17, textEnd: 3,
      },
    });

    await expect(page.locator('.pv-verse:has(.pv-w--hl)')).toHaveCount(2);
  });

  test('blanking covers the wall without losing it', async ({ page, request }) => {
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);
    await showJohn3(request, session, page);

    await send(request, session, { type: 'blank' });
    await expect(page.locator('.pv-curtain')).toHaveCSS('opacity', '1');
    // Still mounted underneath: unblanking has to restore the screen exactly,
    // scroll position included.
    await expect(page.locator('.pv-verse--anchor')).toHaveCount(1);

    await send(request, session, { type: 'unblank' });
    await expect(page.locator('.pv-curtain')).toHaveCSS('opacity', '0');
  });

  test('font step changes the size on screen', async ({ page, request }) => {
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);
    await showJohn3(request, session, page);

    const anchor = page.locator('.pv-verse--anchor');
    const sizeOf = async (): Promise<number> =>
      anchor.evaluate(el => parseFloat(getComputedStyle(el).fontSize));

    const before = await sizeOf();
    await send(request, session, { type: 'setFontStep', fontStep: 9 });
    await expect.poll(sizeOf).toBeGreaterThan(before);
  });

  test('ends cleanly rather than reconnecting forever', async ({ page, request }) => {
    const session = await createSession(request);
    await page.goto(`/present/v/${session.joinCode}`);
    await showJohn3(request, session, page);

    await send(request, session, { type: 'end' });
    await expect(page.locator('.pv-lobby-hint')).toContainText(/ended/i);
  });
});
