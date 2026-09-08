/**
 * Test Utilities for E2E Tests
 *
 * Provides helper functions for common test operations.
 */

import { Page, expect } from '@playwright/test';

/**
 * Panes the first-run layout opens. Anything else must be added by the user
 * (or by `ensurePaneOpen`) before it can be interacted with.
 *
 * The default layout deliberately opens only Bible + Study + Commentary, so a
 * fresh profile does not launch with several empty panes competing with the
 * Bible text. Tests must not assume Books, Dictionary or Notes tabs exist.
 */
export const DEFAULT_OPEN_PANES = ['Bible', 'Study', 'Commentary'] as const;

/**
 * Wait until the app is genuinely usable, rather than sleeping and hoping.
 *
 * `app-loaded` is attached as soon as the React tree mounts, which is well
 * before dockview has laid out its panels. A fixed 1.5-2s sleep is both slower
 * than it needs to be on a warm machine and not long enough on a cold one; the
 * tab strip having rendered its panels is the condition such a sleep only
 * approximates, so wait on that instead.
 *
 * @param expectTabs Tab titles that must be present before returning. Defaults
 *                   to the first-run layout's panes.
 */
export async function waitForAppReady(
  page: Page,
  expectTabs: readonly string[] = DEFAULT_OPEN_PANES,
): Promise<void> {
  await expect(page.locator('[data-testid="app-loaded"]')).toBeAttached({ timeout: 15000 });
  for (const label of expectTabs) {
    // Bible's tab is titled with its passage ("John 3"), not "Bible".
    const matcher = label === 'Bible' ? /Bible|John\s*\d/ : label;
    await expect(
      page.locator('.dockview-tab-content', { hasText: matcher }).first(),
    ).toBeAttached({ timeout: 20000 });
  }
}

/**
 * Click a verse so the app registers it as *selected* (which is what drives the
 * Study/Commentary/Topics panes).
 *
 * Which element carries the click handler depends on the display mode, and the
 * default is Standard (verse numbers visible - this is a study app):
 *   - standard / study: the verse-number gutter, so that dragging across the
 *     verse text stays available for highlighting.
 *   - reading: no gutter exists, and the whole verse span is clickable.
 * Clicking the verse *container* works in neither reliably, so always resolve
 * the gutter first and fall back to the container.
 *
 * @returns false when the Bible pane or the verse never appeared, so callers
 *          can skip rather than fail on an environment without modules.
 */
export async function selectVerse(page: Page, verseNumber: number): Promise<boolean> {
  try {
    await page.waitForSelector('[data-testid="bible-pane"]', { timeout: 15000 });
    await page.waitForSelector('[data-testid^="verse-"]', { timeout: 15000 });
  } catch {
    return false;
  }

  const verse = page.locator(`[data-testid="verse-${verseNumber}"]`);
  if (await verse.count() === 0) return false;

  // Click the verse itself. The verse number is not a separate click target -
  // the whole row is, and its pointer cursor comes from the `.verse-row` CSS
  // class rather than a Tailwind utility, so there is nothing narrower to aim at.
  await verse.click({ force: true });

  // `verse-selected` is applied to the `[data-testid="verse-N"]` element itself
  // in both render branches (reading-mode span and standard-mode row), so it is
  // the one signal that says the store actually took the selection. The 200ms
  // sleep this replaces was both slower than the usual case and too short when
  // four Electron instances share the machine.
  //
  // This was `bg-accent-soft` until selection stopped being an ad-hoc Tailwind
  // fill and became the themed `.verse-selected` treatment. The class is the
  // contract between the app and every e2e test that selects a verse - if it
  // changes again, this line and `bible-pane.spec.ts` change with it.
  await expect(verse).toHaveClass(/verse-selected/, { timeout: 10000 });
  return true;
}

/**
 * Make a pane available and active, whether or not the default layout opened it.
 *
 * If a dockview tab with `label` already exists it is simply activated.
 * Otherwise the pane is created the way a user would: the "New tab" button in
 * the dockview header opens `NewTabPage`, whose quick-action buttons add a pane
 * of the requested type.
 *
 * @param label Dockview tab text, matching NewTabPage's quick-action labels:
 *              'Bible' | 'Commentary' | 'Books' | 'Dictionary' | 'Notes' |
 *              'Prayer' | 'Study' | 'Topics'.
 */
export async function ensurePaneOpen(page: Page, label: string): Promise<void> {
  const existing = page.locator('.dockview-tab-content', { hasText: label });
  if (await existing.count() > 0) {
    // `force` because a minimized Electron window can fail actionability checks.
    await existing.first().click({ force: true });
    // dockview marks the selected tab `dv-active-tab`; waiting on that is what
    // the caller actually needs, since a panel only mounts once its tab is active.
    await expect(
      page.locator('.dv-tab.dv-active-tab', { hasText: label }).first(),
    ).toBeVisible({ timeout: 10000 });
    return;
  }

  // `title` comes from i18n key `ui.dockviewHeaderActions.newTab` ("New tab").
  const newTabButton = page.locator('[title="New tab"]').first();
  await expect(newTabButton).toBeVisible({ timeout: 10000 });
  await newTabButton.click({ force: true });

  const quickAction = page.getByRole('button', { name: label }).first();
  await expect(quickAction).toBeVisible({ timeout: 10000 });
  await quickAction.click({ force: true });

  await expect(
    page.locator('.dockview-tab-content', { hasText: expectedTabText(label) }).first()
  ).toBeVisible({ timeout: 10000 });
}

/**
 * The tab title a quick-action button produces, which is not always the button's
 * own text.
 *
 * Panel titles are stored as a canonical English label and then localized at
 * render time through `paneName.*` (see `src/ui/utils/paneNames.ts`). Those
 * catalog values are deliberately **bare singular nouns**, so that the word
 * "pane" can live in the surrounding message where an inflecting language can
 * inflect it. The New Tab page's button, meanwhile, reads naturally as a plural.
 *
 * So "Books" opens a tab titled "Book". That is intended on both sides; only the
 * test needed to stop assuming they match.
 */
function expectedTabText(buttonLabel: string): string | RegExp {
  // Unanchored on purpose: `.dockview-tab-content` wraps the title alongside
  // other nodes, so `hasText` needs substring semantics - the same behaviour a
  // plain string gives. Only the singular/plural mismatch needs widening.
  const overrides: Record<string, RegExp> = {
    Books: /Books?/,
  };
  return overrides[buttonLabel] ?? buttonLabel;
}

/**
 * Parse a verse ID to extract book, chapter, verse
 */
export function parseVerseId(verseId: number): { book: number; chapter: number; verse: number } {
  const book = Math.floor(verseId / 1000000);
  const remainder = verseId % 1000000;
  const chapter = Math.floor(remainder / 1000);
  const verse = remainder % 1000;
  return { book, chapter, verse };
}

/**
 * Calculate a verse ID from book, chapter, verse
 */
export function calculateVerseId(book: number, chapter: number, verse: number): number {
  return (book * 1000000) + (chapter * 1000) + verse;
}
