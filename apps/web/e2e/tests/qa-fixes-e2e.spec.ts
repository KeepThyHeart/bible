/**
 * Regression coverage for a batch of pre-release UI reports.
 *
 * Each test here pins behaviour a user actually reported as broken, in the
 * layer where it broke — the browser. The unit tests cover the stores; these
 * cover what the reader sees.
 *
 * Each of these was checked by reverting its fix and confirming the test fails.
 * That check killed an earlier scroll-to-verse test: it navigated between two
 * chapters short enough that the scroll container sat at the top either way, so
 * it passed against the bug. The version below picks its chapters so the offset
 * survives the navigation unless something deliberately resets it.
 */
import { test, expect } from '@playwright/test';

test.describe('Typed passage ranges', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    await page.waitForSelector('.app');
    await page.waitForSelector('.verse', { timeout: 15000 });
  });

  test('a typed verse range selects the whole range', async ({ page }) => {
    // Previously the reference parser had no branch for a range, so
    // "John 3:16-18" fell through and ran a full-text search for the text.
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3:16-18');
    await searchInput.press('Enter');

    await expect(page.locator('.verse--study')).toBeVisible({ timeout: 20000 });

    // The anchor plus the rest of the range, exactly as click + shift-click.
    await expect(page.locator('.verse--study')).toHaveAttribute('data-verse-id', '43003016');
    const inRange = page.locator('.verse--in-range');
    await expect(inRange).toHaveCount(2);
    await expect(inRange.first()).toHaveAttribute('data-verse-id', '43003017');
    await expect(inRange.last()).toHaveAttribute('data-verse-id', '43003018');
  });

  test('a single typed verse selects only that verse', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3:16');
    await searchInput.press('Enter');

    await expect(page.locator('.verse--study')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.verse--in-range')).toHaveCount(0);
  });
});

test.describe('Boot and pane state', () => {
  test('the boot splash is taken down once the app has painted', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    await page.waitForSelector('.verse', { timeout: 15000 });

    // The splash lives outside #app precisely so Preact's render cannot remove
    // it early; it is dismissed explicitly once the first chapter is on screen.
    await expect(page.locator('#app-loading')).toHaveCount(0);
  });

  test('a remembered Search pane does not leave the right pane blank', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    await page.waitForSelector('.verse', { timeout: 15000 });

    // Persist the state the user hit: rightPaneMode 'search' with no results,
    // which on reload rendered a pane with no active tab and no content.
    await page.evaluate(() => {
      const raw = localStorage.getItem('bible-reader-commentary');
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.rightPaneMode = 'search';
      localStorage.setItem('bible-reader-commentary', JSON.stringify(parsed));
    });
    await page.reload();
    await page.waitForSelector('.verse', { timeout: 15000 });

    // Whatever it falls back to, a tab must be active and its pane rendered.
    await expect(page.locator('.right-pane-tabs__tab--active')).toHaveCount(1);
  });
});

test.describe('Scroll position on chapter change', () => {
  test('stepping to the next chapter lands on the selected verse, not the old offset', async ({ page }, testInfo) => {
    // Mobile scrolls an outer .mobile-scroll-wrapper instead of this container.
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only test');
    await page.goto('/');
    await page.waitForSelector('.verse', { timeout: 15000 });

    // John 3 (36 verses) into John 4 (54). The new chapter must be the taller of
    // the two: if it were shorter the browser would clamp the carried-over
    // scrollTop back to zero on its own and the test would pass against the bug.
    //
    // The pane is put down the page by asking for the last verse of John 3
    // rather than by scrolling it here — the app's own arrival scroll is
    // deferred two animation frames, and on a loaded machine it lands after a
    // scroll set from the test and wipes it out.
    const search = page.locator('.header__search-field');
    await search.fill('John 3:36');
    await search.press('Enter');
    await page.waitForSelector('[data-verse-id="43003036"]', { timeout: 10000 });

    const pane = page.locator('.bible-pane__scroll-container').first();
    await expect
      .poll(() => pane.evaluate(el => el.scrollTop), { timeout: 10000 })
      .toBeGreaterThan(300);

    // Through the reference box rather than the toolbar's next-chapter button:
    // that button is hidden below the desktop breakpoint, and both take the same
    // path — navigateTo with no verse named.
    await search.fill('John 4');
    await search.press('Enter');
    await page.waitForSelector('[data-verse-id="43004054"]', { timeout: 10000 });

    // navigateTo with no verse selects verse 1, and verse 1 centres at the top.
    // Without the fix pendingScrollVerse was null here and the pane stayed put.
    await expect.poll(() => pane.evaluate(el => el.scrollTop), { timeout: 5000 }).toBeLessThan(100);
    await expect(page.locator('.verse--study')).toHaveAttribute('data-verse-id', '43004001');
  });
});

test.describe('Dictionary lookup', () => {
  test('a dictionary search finds the entry titled with the query', async ({ request }) => {
    // "Moses" used to return thirty other articles and not MOSES: the search was
    // a BM25-ranked full-text match over definitions, capped, so the entry
    // actually titled with the word never made the cut.
    const res = await request.get('/api/dictionary/AmTract/search?q=Moses');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    expect(String(body[0].entry_key).toUpperCase()).toBe('MOSES');
  });

  test('a query containing FTS5 syntax does not error', async ({ request }) => {
    // An apostrophe, a hyphen or a bare "not" was a SQLite syntax error, which
    // reached the browser as a 500 and rendered as nothing happening at all.
    for (const q of ["God's", 'God-fearing', 'NOT']) {
      const res = await request.get(`/api/dictionary/AmTract/search?q=${encodeURIComponent(q)}`);
      expect(res.status(), `query ${q}`).toBe(200);
    }
  });
});
