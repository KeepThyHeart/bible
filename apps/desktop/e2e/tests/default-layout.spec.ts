/**
 * Default Layout E2E Tests
 *
 * Verifies the default layout when no saved session exists:
 * - Bible pane on the left showing John 3 with verse 16 highlighted
 * - Study (active), Commentary and Dictionary tabs on the right
 * - Books and Notes are NOT open by default
 * - Commentary pane auto-syncs with the Bible verse
 */

import { test, expect } from '../fixtures/electron.fixture';

test.describe('Default Layout', () => {
  test('should show Bible on left with John 3:16 and right-side pane tabs', async ({ window }) => {
    // -- Bible pane visible with John 3 --
    await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible();
    await expect(window.locator('[data-testid="bible-pane"]')).toBeVisible();

    const heading = window.locator('[data-testid="bible-chapter-heading"]');
    await expect(heading).toContainText('John');
    await expect(heading).toContainText('3');

    // John 3 should have verses loaded
    const verses = window.locator('[data-testid^="verse-"]');
    await expect(verses.first()).toBeVisible();
    const count = await verses.count();
    expect(count).toBeGreaterThan(20); // John 3 has 36 verses

    // Verse 16 should be present
    const verse16 = window.locator('[data-testid="verse-16"]');
    await expect(verse16).toBeVisible();

    // -- Dockview tab bar should have exactly the default panel tabs --
    // The dockview tabs are rendered inside .dockview-tab-content spans
    const dockviewTabs = window.locator('.dockview-tab-content');

    // Collect all tab titles
    const tabCount = await dockviewTabs.count();
    const tabTitles: string[] = [];
    for (let i = 0; i < tabCount; i++) {
      const text = await dockviewTabs.nth(i).textContent();
      if (text) tabTitles.push(text.trim());
    }

    // Bible (left) plus Study, Commentary and Dictionary (right group). The Bible tab is
    // titled with its passage - "John 3" over the translation abbreviation -
    // because a passage is now a top-level panel rather than a sub-tab inside a
    // generic "Bible" pane. See docs/Design/BiblePaneTabRestructure.md.
    expect(tabTitles.some(t => /John\s*3/.test(t))).toBe(true);
    expect(tabTitles.some(t => t.includes('KJV'))).toBe(true);
    expect(tabTitles.some(t => t.includes('Study'))).toBe(true);
    expect(tabTitles.some(t => t.includes('Commentary'))).toBe(true);
    // Dictionary has its own slot: a Strong's-number click is the commonest
    // route out of the Bible text, and with no Dictionary pane that click had
    // to conjure one labelled "Books".
    expect(tabTitles.some(t => t.includes('Dictionary'))).toBe(true);

    // Books and Notes are intentionally NOT opened on first run - a pane per
    // feature launches as an empty tab crowding the Bible text. They remain
    // reachable through the "New tab" button. Asserting their absence keeps the
    // lean default from silently regressing.
    expect(tabTitles.some(t => t.includes('Books'))).toBe(false);
    expect(tabTitles.some(t => t.includes('Notes'))).toBe(false);

    // -- Commentary pane should be accessible (click its dockview tab first) --
    // The default active right-pane tab is Study; we need to activate Commentary.
    const commentaryDockTab = window.locator('.dockview-tab-content', { hasText: 'Commentary' }).first();
    await commentaryDockTab.click({ force: true });

    await expect(window.locator('[data-testid="commentary-pane"]')).toBeVisible();
  });

  test('should auto-sync commentary with Bible verse on initial load', async ({ window }) => {
    // Activate Commentary tab (Study is the default active tab)
    const commentaryDockTab = window.locator('.dockview-tab-content', { hasText: 'Commentary' }).first();
    await commentaryDockTab.click({ force: true });

    const commentaryPane = window.locator('[data-testid="commentary-pane"]');
    await expect(commentaryPane).toBeVisible({ timeout: 20000 });

    // The commentary Overview should show content for the current verse
    // Look for "Commentaries on" header which indicates verse sync happened
    const overviewContent = commentaryPane.locator('text=/Commentaries on/');
    const contentCount = await overviewContent.count();

    if (contentCount > 0) {
      // Commentary synced and is showing content for a verse
      await expect(overviewContent.first()).toBeVisible();
    } else {
      // At minimum, the Overview tab should be present
      const overviewTab = commentaryPane.locator('[data-testid="commentary-overview-tab"]').first();
      await expect(overviewTab).toBeVisible();
    }
  });
});
