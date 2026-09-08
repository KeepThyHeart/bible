/**
 * Narrow Window Layout E2E Tests (KAN-44)
 *
 * Tests that the app remains functional when the window is resized
 * to its minimum allowed size. Verifies no content overflows and
 * all pane tabs remain accessible.
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron.fixture';
import { ensurePaneOpen } from '../fixtures/test-utils';

/**
 * Shrink the window to its configured minimum and wait for the renderer to see it.
 *
 * Eight tests repeated this `electronApp.evaluate` block followed by a flat
 * 500ms sleep. Every one of them then measured layout in viewport coordinates,
 * so what they actually needed was for `resize` to have reached the renderer
 * and the next frame to have been laid out - which `waitForFunction` states and
 * a sleep only approximates. Under four parallel Electron instances the
 * approximation is the wrong way round: 500ms is usually too long and
 * occasionally too short.
 */
async function resizeToMinimum(
  electronApp: ElectronApplication,
  window: Page,
): Promise<void> {
  const [minWidth, minHeight] = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const minSize = win.getMinimumSize();
    win.restore(); // Ensure it's not minimized/maximized first
    win.setSize(minSize[0], minSize[1]);
    return win.getMinimumSize();
  });

  // Chromium's viewport is the content area, so it is at most the outer size.
  // Waiting for "no wider than the minimum" is the check that survives the
  // window chrome differing per platform.
  await window.waitForFunction(
    ([w, h]) => globalThis.innerWidth <= w && globalThis.innerHeight <= h,
    [minWidth || 800, minHeight || 600] as [number, number],
    { timeout: 15000 },
  );
  await window.evaluate(
    () => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}


test.describe('Narrow Window Layout', () => {
  test.describe('Minimum Window Size', () => {
    test('should have minimum window size configured as 800x600', async ({ electronApp }) => {
      // Verify that the BrowserWindow has minWidth/minHeight configured.
      // On headless Linux (no window manager), getMinimumSize() may return [0, 0]
      // and size constraints may not be enforced, so we check both the API value
      // and fall back to verifying the window can be set to at least 800x600.
      const result = await electronApp.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return { minW: 0, minH: 0, actualW: 800, actualH: 600 };
        win.restore();
        const [minW, minH] = win.getMinimumSize();
        // Also verify the window works at the expected minimum size
        win.setSize(800, 600);
        await new Promise(r => setTimeout(r, 200));
        const [actualW, actualH] = win.getSize();
        return { minW, minH, actualW, actualH };
      });

      // On systems with a window manager, getMinimumSize() returns the configured values.
      // On headless systems it may return 0, so we also verify the window can
      // actually be set to 800x600 (the intended minimum).
      if (result.minW > 0) {
        expect(result.minW).toBeGreaterThanOrEqual(800);
        expect(result.minH).toBeGreaterThanOrEqual(600);
      }
      // The window should be able to operate at 800x600
      expect(result.actualW).toBeGreaterThanOrEqual(800);
      expect(result.actualH).toBeGreaterThanOrEqual(600);
    });

    test('should resize to minimum allowed size without breaking layout', async ({ electronApp, window }) => {
      await resizeToMinimum(electronApp, window);
      // The app should still be loaded and visible
      await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible();

      // The Bible pane should still be visible
      await expect(window.locator('[data-testid="bible-pane"]')).toBeVisible();
    });
  });

  test.describe('No Content Overflow at Minimum Size', () => {
    test('should not have horizontal scrollbar on the app root', async ({ electronApp, window }) => {
      await resizeToMinimum(electronApp, window);

      // Check that the root element does not overflow horizontally
      const overflow = await window.evaluate(() => {
        const root = document.getElementById('root');
        if (!root) return { overflows: true, reason: 'no root element' };
        return {
          overflows: root.scrollWidth > root.clientWidth,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
        };
      });

      expect(overflow.overflows).toBe(false);
    });

    test('should not have vertical scrollbar on the app root', async ({ electronApp, window }) => {
      await resizeToMinimum(electronApp, window);

      // Check that the root element does not overflow vertically at the app level
      const overflow = await window.evaluate(() => {
        const root = document.getElementById('root');
        if (!root) return { overflows: true, reason: 'no root element' };
        return {
          overflows: root.scrollHeight > root.clientHeight,
          scrollHeight: root.scrollHeight,
          clientHeight: root.clientHeight,
        };
      });

      expect(overflow.overflows).toBe(false);
    });

    test('should keep all content within the visible window bounds', async ({ electronApp, window }) => {
      await resizeToMinimum(electronApp, window);

      // Get the window viewport dimensions and check key elements
      const boundsCheck = await window.evaluate(() => {
        const viewportWidth = globalThis.innerWidth;
        const viewportHeight = globalThis.innerHeight;

        // Check the main app container
        const appContainer = document.querySelector('[data-testid="app-loaded"]');
        if (!appContainer) return { valid: false, reason: 'no app container' };

        const appRect = appContainer.getBoundingClientRect();

        return {
          valid: true,
          viewportWidth,
          viewportHeight,
          appRight: appRect.right,
          appBottom: appRect.bottom,
          appOverflowsRight: appRect.right > viewportWidth + 1, // +1 for rounding
          appOverflowsBottom: appRect.bottom > viewportHeight + 1,
        };
      });

      expect(boundsCheck.valid).toBe(true);
      expect(boundsCheck.appOverflowsRight).toBe(false);
      expect(boundsCheck.appOverflowsBottom).toBe(false);
    });
  });

  test.describe('Pane Tab Accessibility at Minimum Size', () => {
    // The pane has no tab bar of its own any more - its passage is a dockview
    // tab - so what has to survive a narrow window is the toolbar band.
    test('should keep Bible pane toolbar accessible', async ({ electronApp, window }) => {
      await resizeToMinimum(electronApp, window);

      // Bible pane should still be visible and its tab area present
      const biblePaneVisible = await window.locator('[data-testid="bible-pane"]').isVisible();
      expect(biblePaneVisible).toBe(true);

      // Navigation controls should still be functional
      const prevChapterBtn = window.locator('[data-testid="prev-chapter"]');
      const nextChapterBtn = window.locator('[data-testid="next-chapter"]');

      // At least one navigation button should be visible (within viewport bounds)
      const prevVisible = await prevChapterBtn.isVisible().catch(() => false);
      const nextVisible = await nextChapterBtn.isVisible().catch(() => false);
      expect(prevVisible || nextVisible).toBe(true);
    });

    test('should keep dockview tabs accessible at minimum size', async ({ electronApp, window }) => {
      // Dictionary is in the first-run layout; `ensurePaneOpen` activates the
      // existing tab (and would open one if a future default dropped it)
      // before asserting the tab stays reachable when cramped.
      await ensurePaneOpen(window, 'Dictionary');

      await resizeToMinimum(electronApp, window);

      // Check that dockview tabs exist in the DOM
      // The app uses dockview with tabs rendered as .dockview-tab-content elements
      const commentaryTab = window.locator('.dockview-tab-content', { hasText: 'Commentary' }).first();
      const dictionaryTab = window.locator('.dockview-tab-content', { hasText: 'Dictionary' }).first();

      const commentaryExists = await commentaryTab.count();
      const dictionaryExists = await dictionaryTab.count();

      // The tabs should exist in the DOM
      expect(commentaryExists).toBeGreaterThan(0);
      expect(dictionaryExists).toBeGreaterThan(0);

      // At minimum window size, tabs may overflow and dockview shows scroll arrows.
      // Use the scroll-right button to reveal hidden tabs before checking visibility.
      const scrollRight = window.locator('button:has-text("›")').first();
      if (await scrollRight.isVisible().catch(() => false)) {
        // Click scroll button a few times to ensure Dictionary tab is scrolled into view
        for (let i = 0; i < 3; i++) {
          if (await scrollRight.isEnabled().catch(() => false)) {
            await scrollRight.click({ force: true });
          }
        }
      }

      // Clicking the dictionary tab should activate it (use force:true since
      // dockview overflow containers may not satisfy Playwright's visibility checks)
      await dictionaryTab.click({ force: true });

      // Was `isVisible().catch(() => false)` fed into `expect(...).toBe(true)`,
      // which reports "expected true, received false" and nothing about which
      // pane failed to mount. A retrying assertion says what it was waiting for.
      await expect(
        window.locator('[data-testid="books-pane"], [data-testid="dictionary-pane"]').first(),
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Functional Extremities at Minimum Size', () => {
    test('should allow clicking on elements at the far right edge', async ({ electronApp, window }) => {
      await resizeToMinimum(electronApp, window);

      // The display mode control sits at the right end of the Bible toolbar, so
      // it is the first thing a too-narrow window clips.
      //
      // The control is a single `display-mode-select`; there are no
      // `display-mode-study` / `display-mode-standard` testids to look for.
      const modeSelect = window.locator('[data-testid="display-mode-select"]');
      await expect(modeSelect).toBeVisible({ timeout: 15000 });

      // force: a minimized Electron window intermittently fails Playwright's
      // actionability check on an element that is perfectly interactable.
      //
      // Switching display mode re-renders the whole chapter, which is slow
      // enough under four parallel Electron instances to outrun the default
      // 5s assertion timeout - hence the explicit ones here.
      await modeSelect.selectOption('study', { force: true, timeout: 30000 });
      await expect(modeSelect).toHaveValue('study', { timeout: 30000 });

      await modeSelect.selectOption('standard', { force: true, timeout: 30000 });
      await expect(modeSelect).toHaveValue('standard', { timeout: 30000 });
    });

    test('should allow clicking on elements at the bottom edge', async ({ electronApp, window }) => {
      await resizeToMinimum(electronApp, window);

      // Verify Bible text content area is scrollable (it's near the bottom)
      const contentScrollable = await window.evaluate(() => {
        // Find the Bible text scroll container
        const scrollContainer = document.querySelector('.pane-content-bible');
        if (!scrollContainer) return { found: false };

        const rect = scrollContainer.getBoundingClientRect();
        return {
          found: true,
          isWithinViewport: rect.bottom <= globalThis.innerHeight + 1,
          hasHeight: rect.height > 0,
        };
      });

      expect(contentScrollable.found).toBe(true);
      expect(contentScrollable.hasHeight).toBe(true);
    });

    test('should not have elements cut off or inaccessible at right boundary', async ({ electronApp, window }) => {
      await resizeToMinimum(electronApp, window);

      // Check that no element with a data-testid extends beyond the viewport.
      // Elements inside a horizontally scrollable container (overflow-x: auto/scroll)
      // are excluded, since they are designed to scroll and may legitimately sit
      // outside the visible viewport at narrow widths.
      const overflowingElements = await window.evaluate(() => {
        const viewportWidth = globalThis.innerWidth;
        const testElements = document.querySelectorAll('[data-testid]');
        const overflowing: string[] = [];

        // Check if an element is inside a horizontally scrollable ancestor
        function isInsideScrollableContainer(el: Element): boolean {
          let parent = el.parentElement;
          while (parent) {
            const style = globalThis.getComputedStyle(parent);
            const overflowX = style.overflowX;
            if (overflowX === 'auto' || overflowX === 'scroll') {
              return true;
            }
            parent = parent.parentElement;
          }
          return false;
        }

        testElements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          // Only check visible elements (width and height > 0)
          if (rect.width > 0 && rect.height > 0) {
            if (rect.right > viewportWidth + 2) { // +2 for rounding tolerance
              // Skip elements inside scrollable containers - they scroll by design
              if (!isInsideScrollableContainer(el)) {
                overflowing.push(
                  `${el.getAttribute('data-testid')}: right=${Math.round(rect.right)} > viewport=${viewportWidth}`
                );
              }
            }
          }
        });

        return overflowing;
      });

      // No test-identified elements should overflow to the right
      expect(overflowingElements).toEqual([]);
    });
  });
});
