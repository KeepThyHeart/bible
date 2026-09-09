/**
 * Bible pane chrome regression guard.
 *
 * The Bible pane carries three persistent horizontal bands above the scripture
 * text and no more. Each passage is a top-level dockview tab, and the
 * per-passage controls fold into a settings menu rather than a band of their
 * own.
 *
 * Chrome creep is a slow, silent regression: each new band looks reasonable on
 * its own, and nobody notices the text column has been pushed down 200px until
 * a user complains. These tests put a hard ceiling on it.
 *
 * The band list is derived STRUCTURALLY rather than from a hand-written list of
 * selectors: walk up from the Bible scroll container to <body>, and every
 * preceding sibling that occupies vertical space above it is a band. A band
 * nobody remembered to register still gets counted.
 *
 * If you are here because this test failed: you probably added a toolbar. That
 * is not automatically wrong, but it is a deliberate product decision about the
 * app's most important screen, so make it deliberately - update MAX_BANDS and
 * MAX_CHROME_PX with a reason, or move the control into the settings menu.
 */
import { test, expect } from '../fixtures/electron.fixture';
import fs from 'fs';
import path from 'path';

/**
 * Measured at 1400x900 after the restructure: 3 bands / 128px
 * (header 55 + dockview tabs 38 + toolbar 35). The ceilings carry a little
 * headroom for font-metric and platform differences, but not a whole band.
 */
const MAX_BANDS = 3;
const MAX_CHROME_PX = 150;

/** Set MEASURE_OUT to dump JSON + screenshots for debugging a failure. */
const OUT = process.env.MEASURE_OUT;

interface Band {
  tag: string;
  testid?: string;
  cls?: string;
  top: number;
  height: number;
  width: number;
}

/**
 * Dismiss first-run onboarding so we measure *persistent* chrome.
 *
 * The welcome bar is a ~45px band above the Bible text on a fresh profile. It is
 * deliberately transient - one click retires it forever - so counting it here
 * would conflate "what a first-time user sees once" with "what every user lives
 * with". `firstRunBandCount` below asserts the first-run case separately, so
 * neither is going unmeasured.
 */
async function dismissFirstRun(window: import('@playwright/test').Page): Promise<boolean> {
  const bar = window.locator('[data-testid="onboarding-welcome-bar"]');
  if (await bar.count() === 0) return false;
  const dismiss = bar.locator('button').last();
  await dismiss.click({ force: true });
  await expect(bar).toHaveCount(0, { timeout: 5000 });
  return true;
}

async function measure(
  electronApp: import('@playwright/test').ElectronApplication,
  window: import('@playwright/test').Page,
  label: string
) {
  // Fixed window size so runs are comparable across machines.
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds({ x: 0, y: 0, width: 1400, height: 900 });
  });
  // Two frames, so the resize has been laid out before anything is measured.
  // (Not a `waitForFunction` on `innerWidth`: the window under test is
  // minimized, so `setBounds` does not necessarily move the renderer viewport
  // to the requested size at all - the assertion never settled.)
  await window.evaluate(
    () => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

  // Scroll the passage back to the top before measuring. The pane restores the
  // reader's last position, so verse 1 can legitimately be above the viewport
  // - which reported as `firstVerseTop: -626` and failed the render-sanity
  // check with "no verses rendered", on a pane that was rendering fine.
  await window.evaluate(() => {
    document.querySelector('.pane-content-bible')?.scrollTo({ top: 0 });
  });
  await window.evaluate(
    () => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

  const data = await window.evaluate(() => {
    const describe = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid') || undefined,
        cls: (el.className && typeof el.className === 'string'
          ? el.className.split(/\s+/).slice(0, 4).join(' ')
          : undefined),
        top: Math.round(r.top),
        height: Math.round(r.height),
        width: Math.round(r.width),
      };
    };

    const scroll = document.querySelector('.pane-content-bible');
    const scrollTop = scroll ? scroll.getBoundingClientRect().top : 0;
    const bands: ReturnType<typeof describe>[] = [];

    if (scroll) {
      let node: Element | null = scroll;
      while (node && node.parentElement && node.parentElement !== document.body.parentElement) {
        let sib = node.previousElementSibling;
        while (sib) {
          const r = sib.getBoundingClientRect();
          // A band is a strip that finishes above the text column. Layout
          // containers that merely *start* above it (dockview's sash container
          // wraps the whole workbench) are not chrome and are skipped.
          if (r.height > 0 && r.width > 0 && Math.round(r.bottom) <= Math.round(scrollTop)) {
            bands.unshift(describe(sib));
          }
          sib = sib.previousElementSibling;
        }
        node = node.parentElement;
      }
      bands.sort((a, b) => a.top - b.top);
    }

    const firstVerse = document.querySelector('[data-testid="verse-1"]')
      ?? document.querySelector('[data-verse-id]');
    const heading = document.querySelector('[data-testid="bible-chapter-heading"]');

    return {
      windowSize: { w: globalThis.innerWidth, h: globalThis.innerHeight },
      // Total persistent chrome: everything above the top of the Bible scroll
      // container. The chapter heading is *inside* that container and scrolls
      // away as the user reads, so it is deliberately excluded - it is a
      // document title, not chrome.
      chromeHeight: scroll ? Math.round(scroll.getBoundingClientRect().top) : -1,
      bandCount: bands.length,
      bands: bands as Band[],
      chapterHeadingTop: heading ? Math.round(heading.getBoundingClientRect().top) : -1,
      firstVerseTop: firstVerse ? Math.round(firstVerse.getBoundingClientRect().top) : -1,
      // Bands the restructure removed - must stay absent.
      hasBibleSubTabBar: !!document.querySelector('[aria-label="Bible passages"]'),
      hasChapterToggleBar: !!document.querySelector('[data-testid="chapter-toggle-bar"]'),
      dir: document.documentElement.getAttribute('dir'),
      lang: document.documentElement.getAttribute('lang'),
    };
  });

  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(data, null, 2));
    await window.screenshot({ path: path.join(OUT, `${label}.png`) });
  }

  return data;
}

/** Shared assertions, so en and ar cannot drift apart. */
function assertChrome(data: Awaited<ReturnType<typeof measure>>) {
  // Render sanity: without this a broken pane reports 0 bands and "passes".
  expect(data.chromeHeight, 'Bible scroll container not found').toBeGreaterThan(0);
  expect(data.firstVerseTop, 'no verses rendered').toBeGreaterThan(0);

  const bandSummary = data.bands
    .map(b => `${b.testid ?? b.cls ?? b.tag} (${b.height}px)`)
    .join(', ');

  expect(
    data.bandCount,
    `Expected at most ${MAX_BANDS} persistent chrome bands above the Bible ` +
    `text, found ${data.bandCount}: ${bandSummary}. See the header comment.`
  ).toBeLessThanOrEqual(MAX_BANDS);

  expect(
    data.chromeHeight,
    `Chrome above the Bible text grew to ${data.chromeHeight}px ` +
    `(ceiling ${MAX_CHROME_PX}px). Bands: ${bandSummary}.`
  ).toBeLessThanOrEqual(MAX_CHROME_PX);

  // The two bands the restructure deleted. Asserting absence stops them being
  // reintroduced by a revert or a merge.
  expect(data.hasBibleSubTabBar, 'the per-passage sub-tab strip is back').toBe(false);
  expect(data.hasChapterToggleBar, 'the chapter toggle bar is back').toBe(false);
}

test.describe('Bible pane chrome', () => {
  test('stays within the band and height budget (en)', async ({ electronApp, window }) => {
    await expect(window.locator('[data-testid="app-loaded"]')).toBeAttached({ timeout: 30000 });
    await window.waitForSelector('[data-testid^="verse-"]', { timeout: 30000 });

    await dismissFirstRun(window);
    const data = await measure(electronApp, window, 'chrome-en');
    assertChrome(data);
    expect(data.dir).toBe('ltr');
  });

  test('first run adds the welcome bar, and dismissing it returns to budget', async ({
    electronApp,
    window,
  }) => {
    await expect(window.locator('[data-testid="app-loaded"]')).toBeAttached({ timeout: 30000 });
    await window.waitForSelector('[data-testid^="verse-"]', { timeout: 30000 });

    const before = await measure(electronApp, window, 'chrome-en-firstrun');
    const dismissed = await dismissFirstRun(window);

    // A fresh profile is not guaranteed here - the fixture may reuse one. Only
    // assert the delta when the bar was actually present.
    if (!dismissed) {
      assertChrome(before);
      return;
    }

    // One extra band on first run is the accepted cost of onboarding.
    expect(before.bandCount).toBeLessThanOrEqual(MAX_BANDS + 1);

    const after = await measure(electronApp, window, 'chrome-en-dismissed');
    assertChrome(after);
    expect(after.chromeHeight).toBeLessThan(before.chromeHeight);
  });

  test('stays within the same budget in RTL (ar)', async ({ electronApp, window }) => {
    await expect(window.locator('[data-testid="app-loaded"]')).toBeAttached({ timeout: 30000 });
    await window.evaluate(() => globalThis.localStorage.setItem('bible.ui.locale', 'ar'));
    await window.reload();
    await window.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
    await window.waitForSelector('[data-testid^="verse-"]', { timeout: 30000 });
    // The locale actually having switched - measuring the LTR layout would
    // silently pass the RTL band check.
    await expect(window.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 15000 });

    await dismissFirstRun(window);
    const data = await measure(electronApp, window, 'chrome-ar');
    assertChrome(data);

    // Direction actually flipped - otherwise this is just the en test twice.
    expect(data.dir).toBe('rtl');
    expect(data.lang).toBe('ar');
  });
});
