import { test, expect, type Page } from '@playwright/test';

const SRC = { source: { type: 'static', base: '/data/' }, translation: 'KJV' };
async function open(page: Page, cfg: object = {}, q = '') {
  await page.goto(`/demo/article.html?cfg=${encodeURIComponent(JSON.stringify({ ...SRC, ...cfg }))}${q}`);
  await page.waitForSelector('.vh-ref');
  await page.waitForFunction(() => !!(window as any).__vhUi);
}
const link = (page: Page, text: string) => page.locator('.vh-ref', { hasText: text }).first();
const pop = (page: Page) => page.locator('.vh-pop.vh-pop--open');

test('links real references and none of the false positives', async ({ page }) => {
  await open(page);
  const texts = await page.locator('.vh-ref').allTextContents();
  for (const t of ['John 3:16', 'John 3:14-18', 'Romans 5:8', 'Rom. 8:28', '1 John 4:8', 'Matthew 5:3-12', 'Psalm 23', 'Jude 3', 'Psalm 117', '2 Timothy 1:7', 'II Corinthians 5:17', 'Genesis 1-3']) {
    expect(texts, t).toContain(t);
  }
  for (const bad of ['Is 1', 'Job 5', 'Job', 'Numbers', 'Mark 4', 'Chapter 3', '2020']) expect(texts.some((x) => x === bad), bad).toBe(false);
  // Skips code and existing links.
  expect(await page.locator('code .vh-ref, a[href="#"] .vh-ref').count()).toBe(0);
  // Chains: "Rom 3:23; 6:23, 25" gives three links.
  expect(texts).toEqual(expect.arrayContaining(['Rom 3:23', '6:23', '25']));
  // A "version" suffix is only picked up when the version is configured.
  expect(texts).not.toContain('John 3:16 (ASV)');
});

test('hover shows the verse text, stays while hovered, hides after leaving', async ({ page }) => {
  await open(page);
  await link(page, 'John 3:16').hover();
  await expect(pop(page)).toContainText('For God so loved the world');
  await expect(pop(page)).toContainText('KJV');
  // Hoverable: moving onto the popup keeps it open (WCAG 1.4.13).
  const box = (await pop(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
  await expect(pop(page)).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(pop(page)).toHaveCount(0, { timeout: 2000 });
});

test('popup stays inside the viewport and is anchored near the link', async ({ page }) => {
  await open(page);
  await link(page, 'Psalm 23').hover();
  await expect(pop(page)).toBeVisible();
  const b = (await pop(page).boundingBox())!;
  const l = (await link(page, 'Psalm 23').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  expect(Math.abs(b.y - (l.y + l.height)) < 40 || Math.abs(b.y + b.height - l.y) < 40).toBe(true);
});

test('keyboard: focus opens, Escape closes and keeps focus on the link, Enter pins', async ({ page }) => {
  await open(page);
  const l = link(page, 'John 3:16');
  await l.focus();
  await expect(pop(page)).toContainText('For God so loved');
  await page.keyboard.press('Escape');
  await expect(pop(page)).toHaveCount(0);
  await expect(l).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pop(page)).toHaveClass(/vh-pop--pinned/);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  await expect(pop(page)).toBeVisible(); // persistent until dismissed
  await expect(l).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(pop(page)).toHaveCount(0);
});

test('close button works and is labelled', async ({ page }) => {
  await open(page);
  await link(page, 'John 3:16').click();
  await expect(pop(page)).toBeVisible();
  const close = pop(page).locator('[data-vh-slot=close]');
  await expect(close).toHaveAttribute('aria-label', 'Close');
  await close.click();
  await expect(pop(page)).toHaveCount(0);
});

test('words of Christ are red by default and the opt-out removes it', async ({ page }) => {
  await open(page);
  await link(page, 'John 3:16').hover();
  const w = pop(page).locator('.vh-w-w').first();
  await expect(w).toBeVisible();
  const color = await w.evaluate((e) => getComputedStyle(e).color);
  expect(color).toBe('rgb(179, 38, 30)');
  await open(page, { wordsOfChrist: false });
  await link(page, 'John 3:16').hover();
  const w2 = pop(page).locator('.vh-w-w').first();
  await expect(w2).toBeVisible();
  expect(await w2.evaluate((e) => getComputedStyle(e).color)).not.toBe('rgb(179, 38, 30)');
});

test('supplied words are italic', async ({ page }) => {
  await open(page);
  await link(page, 'Psalm 23').hover();
  const s = pop(page).locator('.vh-w-s').first();
  await expect(s).toBeVisible();
  expect(await s.evaluate((e) => getComputedStyle(e).fontStyle)).toBe('italic');
});

test('context shows neighbouring verses only for a single verse', async ({ page }) => {
  await open(page, { context: 1 });
  await link(page, 'Rom. 8:28').hover(); // not in the fixture: shows not found, fine
  await link(page, 'John 3:16').hover();
  await expect(pop(page).locator('.vh-v--ctx')).toHaveCount(2);
  await expect(pop(page).locator('.vh-v--target')).toHaveCount(1);
  await page.mouse.move(5, 5);
  await link(page, 'John 3:14-18').hover();
  await expect(pop(page).locator('.vh-v--ctx')).toHaveCount(0);
  await expect(pop(page).locator('.vh-v--target')).toHaveCount(5);
});

test('a chapter reference previews the first verses with an ellipsis', async ({ page }) => {
  await open(page, { chapterPreview: 3 });
  await link(page, 'Psalm 23').hover();
  await expect(pop(page).locator('.vh-v')).toHaveCount(3);
  await expect(pop(page)).toContainText('…');
});

test('click with a link URL follows it; popup mode does not navigate', async ({ page }) => {
  await open(page, { linkUrl: '/demo/target.html?v={version}&b={bookName}&c={chapter}&x={verse}' });
  const l = link(page, 'John 3:16');
  await expect(l).toHaveAttribute('href', '/demo/target.html?v=KJV&b=John&c=3&x=16');
  await open(page);
  const before = page.url();
  await link(page, 'John 3:16').click();
  expect(page.url()).toBe(before);
});

test('javascript: link URLs are rejected', async ({ page }) => {
  await open(page, { linkUrl: 'javascript:alert({chapter})' });
  expect(await page.locator('a.vh-ref').count()).toBe(0);
});

test('scope selector: only text inside the matching elements is linked', async ({ page }) => {
  await open(page, { scope: ['#study'] });
  await page.goto(`/demo/article.html?cfg=${encodeURIComponent(JSON.stringify({ ...SRC, scope: ['p.nothing'] }))}`);
  await page.waitForTimeout(600);
  expect(await page.locator('.vh-ref').count()).toBe(0);
});

test('scope: main column linked, sidebar not', async ({ page }) => {
  await page.goto(`/demo/article.html?cfg=${encodeURIComponent(JSON.stringify({ ...SRC, scope: ['main > p'] }))}`);
  await page.waitForSelector('.vh-ref');
  expect(await page.locator('main > p .vh-ref').count()).toBeGreaterThan(10);
  expect(await page.locator('aside .vh-ref').count()).toBe(0);
});

test('malicious verse data cannot inject markup', async ({ page }) => {
  await page.route('**/data/KJV/43/3.json', (r) =>
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ k: 43003, f: 16, n: 36, v: ['<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>', [['w', '<b>bold</b>']]] }) }));
  await open(page);
  await link(page, 'John 3:16').hover();
  await expect(pop(page)).toContainText('<img src=x');
  expect(await pop(page).locator('img, script, b').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
});

test('loading state then error state with a failing source', async ({ page }) => {
  await page.route('**/data/KJV/43/3.json', async (r) => { await new Promise((x) => setTimeout(x, 400)); await r.fulfill({ status: 500 }); });
  await open(page);
  await link(page, 'John 3:16').hover();
  await expect(page.locator('.vh-pop--loading')).toBeVisible();
  await expect(page.locator('.vh-pop--error')).toBeVisible();
  await expect(pop(page)).toContainText('Could not load');
});

test('dark theme and custom style variables', async ({ page }) => {
  await open(page, { theme: 'dark', style: { accent: '#ff00ff', fontSize: '20px' } });
  await link(page, 'John 3:16').hover();
  const bg = await pop(page).evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).toBe('rgb(31, 32, 35)');
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--vh-font-size'))).toBe('20px');
});

test('custom template slots', async ({ page }) => {
  await open(page, { template: '<div class="mine"><b data-vh-slot="ref"></b> [<i data-vh-slot="version"></i>]<ol data-vh-slot="verses"><li data-vh-slot="verse"><span data-vh-slot="text"></span></li></ol></div>' });
  await link(page, 'John 3:16').hover();
  await expect(pop(page).locator('.mine b')).toHaveText('John 3:16');
  await expect(pop(page).locator('.mine i')).toHaveText('KJV');
  await expect(pop(page).locator('.mine li')).toHaveCount(1);
});

test('gzip static source (served as application/gzip)', async ({ page }) => {
  await open(page, { source: { type: 'static', base: '/data/', compressed: 'gzip' } });
  await link(page, 'John 3:16').hover();
  await expect(pop(page)).toContainText('For God so loved the world');
});

test('@phone narrow screens get a bottom sheet; tap opens, outside tap closes', async ({ page }) => {
  await open(page);
  await link(page, 'John 3:16').tap();
  await expect(pop(page)).toHaveClass(/vh-pop--sheet/);
  const b = (await pop(page).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.abs(b.y + b.height - vp.height)).toBeLessThan(2);
  await page.touchscreen.tap(10, 10);
  await expect(pop(page)).toHaveCount(0);
});

test('@phone touch: first tap opens the popup, second tap follows the link', async ({ page }) => {
  await open(page, { linkUrl: '/demo/target.html?c={chapter}' });
  await link(page, 'John 3:16').tap();
  await expect(pop(page)).toBeVisible();
  expect(page.url()).toContain('article.html');
  await link(page, 'John 3:16').tap();
  await page.waitForURL(/target\.html\?c=3/, { timeout: 5000 });
});

test('reader (plus bundle): opens on click, navigates across a book boundary, closes', async ({ page }) => {
  await open(page, { click: 'reader', plusUrl: '/dist/verse-hover-plus.min.js' });
  await link(page, 'John 3:16').click();
  const dlg = page.locator('dialog.vh-rd[open]');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.vh-v--target')).toContainText('For God so loved the world');
  await dlg.getByRole('button', { name: 'Next chapter' }).click();
  await expect(dlg.locator('select').nth(1)).toHaveValue('4');
  await expect(dlg.locator('.vh-v').first()).toContainText('When therefore the Lord knew');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});

test('references inserted after load are linked and interactive (single-page apps)', async ({ page }) => {
  await page.goto(`/demo/article.html?cfg=${encodeURIComponent(JSON.stringify({ ...SRC, scope: ['#late'] }))}`);
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'late'; document.body.appendChild(d); });
  await page.evaluate(() => { document.getElementById('late')!.textContent = 'Later: John 3:16'; });
  await page.waitForSelector('#late .vh-ref');
  await page.locator('#late .vh-ref').hover();
  await expect(pop(page)).toContainText('For God so loved the world');
});

test('keyboard: a pinned popup takes focus so its controls can be reached; Escape returns focus', async ({ page }) => {
  await open(page);
  const l = link(page, 'John 3:16');
  await l.focus();
  await page.keyboard.press('Enter');
  await expect(pop(page)).toHaveClass(/vh-pop--pinned/);
  await expect(pop(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(pop(page).locator('[data-vh-slot=close]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pop(page)).toHaveCount(0);
  await expect(l).toBeFocused();
});

test('references are role=button spans that wrap, and activate with Space', async ({ page }) => {
  await open(page);
  const l = link(page, 'John 3:16');
  await expect(l).toHaveAttribute('role', 'button');
  expect(await l.evaluate((e) => e.tagName)).toBe('SPAN');
  await l.focus();
  await page.keyboard.press('Space');
  await expect(pop(page)).toHaveClass(/vh-pop--pinned/);
});

test('missing UI script: references are restored to plain text', async ({ page }) => {
  await page.route('**/dist/verse-hover-ui.min.js', (r) => r.fulfill({ status: 404 }));
  const warns: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warns.push(m.text()));
  await page.goto(`/demo/article.html?cfg=${encodeURIComponent(JSON.stringify(SRC))}`);
  await page.waitForTimeout(800);
  expect(await page.locator('.vh-ref').count()).toBe(0);
  expect(warns.join()).toContain('could not load the popup script');
});
