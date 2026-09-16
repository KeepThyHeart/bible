import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Phone follow-along mode (`/present/f/<code>`): the ordinary reading app,
 * nudged to the presenter's live reference by `followStore`.
 *
 * Run against the real server and the real built bundle, the same reasoning
 * as `presenter-e2e.spec.ts`: this is a second entry into the reading app's
 * own navigation (`bibleStore.navigateTo`), and a mistake there produces a
 * page that still renders something, just not the presenter's passage.
 */

const JOHN_3 = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };

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

async function joinFollowing(page: Page, session: Session): Promise<void> {
  await page.goto(`/present/f/${session.joinCode}`);
  await expect(page.locator('.follow-banner')).toBeVisible({ timeout: 10000 });
}

test.describe('Follow-along mode', () => {
  test('lands on the presenter\'s passage and shows the following banner', async ({ page, request }) => {
    const session = await createSession(request);
    await send(request, session, { type: 'show', item: JOHN_3, index: 16 });

    await joinFollowing(page, session);

    await expect(page.locator('.follow-banner')).toContainText('Following');
    await expect(page.locator('.follow-banner')).toContainText('John 3:16');
    await expect(page.locator('.verse--follow-live')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-verse-id="43003016"]')).toHaveClass(/verse--follow-live/);
  });

  test('follows the presenter onto a new passage without a page reload', async ({ page, request }) => {
    const session = await createSession(request);
    await send(request, session, { type: 'show', item: JOHN_3, index: 16 });
    await joinFollowing(page, session);

    await send(request, session, {
      type: 'show', item: { kind: 'passage', module: 'KJV', book: 19, chapter: 23 }, index: 1,
    });

    await expect(page.locator('.follow-banner')).toContainText('Psalms 23:1', { timeout: 10000 });
    await expect(page.locator('.bible-tab-bar')).toContainText('Psalms 23');
  });

  test('blanking the wall does not affect what the follower is reading', async ({ page, request }) => {
    const session = await createSession(request);
    await send(request, session, { type: 'show', item: JOHN_3, index: 16 });
    await joinFollowing(page, session);
    await expect(page.locator('.follow-banner')).toContainText('John 3:16');

    await send(request, session, { type: 'blank' });
    await page.waitForTimeout(300);

    await expect(page.locator('.follow-banner')).toContainText('Following');
    await expect(page.locator('.bible-tab-bar')).toContainText('John 3');
  });

  test('pauses when the reader navigates away, and resumes on "Back to live"', async ({ page, request }) => {
    const session = await createSession(request);
    await send(request, session, { type: 'show', item: JOHN_3, index: 16 });
    await joinFollowing(page, session);

    // Navigate away the same way a reader tapping a cross-reference would.
    await page.evaluate(() => { window.location.hash = '#/KJV/19/23'; });
    await expect(page.locator('.follow-banner')).toContainText('Paused', { timeout: 10000 });
    await expect(page.locator('.follow-banner')).toContainText('Live: John 3:16');
    await expect(page.locator('.bible-tab-bar')).toContainText('Psalms 23');

    await page.locator('.follow-banner__button', { hasText: 'Back to live' }).click();
    await expect(page.locator('.follow-banner')).toContainText('Following', { timeout: 10000 });
    await expect(page.locator('.bible-tab-bar')).toContainText('John 3');
  });

  test('"Stop following" pauses without leaving the stream', async ({ page, request }) => {
    const session = await createSession(request);
    await send(request, session, { type: 'show', item: JOHN_3, index: 16 });
    await joinFollowing(page, session);

    await page.locator('.follow-banner__button', { hasText: 'Stop following' }).click();
    await expect(page.locator('.follow-banner')).toContainText('Paused');

    // The presenter moves on; the reader must not be pulled along while paused.
    await send(request, session, {
      type: 'show', item: { kind: 'passage', module: 'KJV', book: 19, chapter: 23 }, index: 1,
    });
    await page.waitForTimeout(300);
    await expect(page.locator('.bible-tab-bar')).toContainText('John 3');
    await expect(page.locator('.follow-banner')).toContainText('Live: Psalms 23:1');
  });

  test('offers a switch to the screen view, and the screen offers one back', async ({ page, request }) => {
    const session = await createSession(request);
    await send(request, session, { type: 'show', item: JOHN_3, index: 16 });
    await joinFollowing(page, session);

    const screenLink = page.locator('.follow-banner__link', { hasText: 'Open screen view instead' });
    await expect(screenLink).toHaveAttribute('href', new RegExp(`/present/v/${session.joinCode}$`));

    await send(request, session, { type: 'end' });
  });

  test('the screen\'s own hover menu offers to switch to follow-along', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only test: this is the projector page.');
    const session = await createSession(request);
    await send(request, session, { type: 'show', item: JOHN_3, index: 16 });

    await page.goto(`/present/v/${session.joinCode}`);
    await expect(page.locator('.pv-verse--anchor')).toBeVisible({ timeout: 10000 });
    await page.mouse.move(400, 400);
    await page.mouse.move(420, 420);

    const followLink = page.locator('.pv-menu a', { hasText: 'Follow along instead' });
    await expect(followLink).toBeVisible({ timeout: 5000 });
    await expect(followLink).toHaveAttribute('href', new RegExp(`/present/f/${session.joinCode}$`));

    await send(request, session, { type: 'end' });
  });
});
