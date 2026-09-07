import { test, type Page, type TestInfo } from '@playwright/test';

/** Skip test when running on a mobile project */
export function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only test');
}

/** Skip test when running on a desktop/tablet project */
export function mobileOnly(testInfo: TestInfo) {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only test');
}

/** Skip test unless running on the tablet project */
export function tabletOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== 'tablet-chrome', 'Tablet-only test');
}

/**
 * Wait until the Bible pane has stopped scrolling.
 *
 * Arriving at a chapter selects a verse and scrolls to it, two animation frames
 * after the verses render. A click issued in that window is aimed at where a
 * verse was when Playwright measured it and lands wherever the scroll has since
 * put it, so a test clicks one verse and asserts about another. Under load the
 * window is wide enough to lose regularly.
 */
async function settleScroll(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    const el = document.querySelector('.bible-pane__scroll-container');
    if (!el) { resolve(); return; }
    let previous = -1;
    let steady = 0;
    let frames = 0;
    const check = () => {
      // Give up rather than hang if something keeps the pane moving.
      if (++frames > 90) { resolve(); return; }
      steady = el.scrollTop === previous ? steady + 1 : 0;
      previous = el.scrollTop;
      if (steady >= 3) { resolve(); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
}

/** Navigate to a passage via the header search bar and wait for verses to load */
export async function navigateTo(page: Page, reference: string) {
  const searchInput = page.locator('.header__search-field');
  await searchInput.fill(reference);
  await searchInput.press('Enter');
  await page.waitForSelector('.verse', { timeout: 10000 });
  await settleScroll(page);
}

/** Wait for verses to appear after a page load or reload */
export async function waitForVerses(page: Page) {
  await page.waitForSelector('.verse', { timeout: 10000 });
  await settleScroll(page);
}

/** Get the active tab's passage title text */
export async function getActiveTabTitle(page: Page): Promise<string> {
  return (await page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title').textContent()) ?? '';
}
