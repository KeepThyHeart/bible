/**
 * Study Pane E2E Tests
 *
 * Comprehensive tests for the Study Pane:
 * - Empty state and initial layout
 * - Verse sync and suggestion banner
 * - Topics from Nave's and Torrey's topical indexes
 * - Commentary summaries
 * - Cross-references from TSK
 * - Section collapse/expand
 * - Pin/unpin verse sync
 * - Commentary detail view navigation
 * - Topic search
 */

import { test, expect, Page } from '../fixtures/electron.fixture';
import { selectVerse as clickVerse } from '../fixtures/test-utils';

/**
 * The "Studying <reference>" banner.
 *
 * Every test in this file waited on `text=/Studying:/`. The banner comes from
 * `studyPane.studyingVerse`, which is "Studying {{reference}}" - no colon - so
 * that locator never matched and thirteen of these tests failed on it.
 */
function studyingBanner(window: Page) {
  return window.locator('text=/Studying\\s+\\S/');
}

/**
 * The Study pane itself.
 *
 * Needed because `pin-button` and the nav header are shared with the
 * Commentary pane, so an unscoped lookup is a strict-mode violation - or worse,
 * silently drives the wrong pane.
 */
function studyPane(window: Page) {
  return window.locator('[data-testid="study-pane"]');
}

/** The Study pane's pin toggle. */
function pinButton(window: Page) {
  return studyPane(window).getByTestId('pin-button');
}

/** The empty-state hint, shown when no verse is being studied. */
function emptyHint(window: Page) {
  return window.locator('text=/Click a verse.*Bible pane/');
}

/** Clear the studied verse via the banner's x button (aria-label "Clear"). */
async function clearVerse(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Clear' }).first().click({ force: true });
}

/** A Study-pane section header, addressed by its heading text. */
function section(window: Page, title: string) {
  // `aria-expanded` is on the header button (`StudySection`), which is a far
  // better handle than the v/> glyph itself: the glyph is `aria-hidden`
  // decoration and could be restyled away without any behaviour changing.
  return studyPane(window).getByRole('button', { name: new RegExp(title, 'i') }).first();
}

/** Activate the Study tab and wait for dockview to mount its panel. */
async function activateStudyTab(window: Page): Promise<void> {
  await window.locator('.dv-tab:has-text("Study")').first().click({ force: true });
  await expect(studyPane(window)).toBeVisible({ timeout: 15000 });
}

/**
 * Click a verse in the Bible pane and bring the Study pane up on it.
 *
 * Asserts rather than returning a boolean: a boolean invites
 * `if (!ready) return;` at the call site, which reports green on a run where
 * the Bible pane never loaded. `selectVerse` throws nothing and returns false
 * only in that case, so asserting on it is the honest form.
 */
async function studyVerse(window: Page, verseNum: number): Promise<void> {
  expect(await clickVerse(window, verseNum)).toBe(true);
  await activateStudyTab(window);
  await expect(studyingBanner(window)).toBeVisible({ timeout: 20000 });
}

test.describe('Study Pane', () => {

  test.describe('Empty State & Layout', () => {
    test('should show Study tab in default layout with empty state', async ({ window }) => {
      const studyTab = window.locator('.dv-tab:has-text("Study")');
      await expect(studyTab.first()).toBeVisible({ timeout: 10000 });

      await activateStudyTab(window);

      // The pane opens already studying the chapter's first verse, so the
      // empty state has to be reached rather than assumed - asserting the hint
      // straight away fails on a pane that is working correctly.
      await expect(studyingBanner(window)).toBeVisible({ timeout: 15000 });
      await clearVerse(window);

      await expect(emptyHint(window)).toBeVisible({ timeout: 5000 });

      // The topic search bar and the nav header stay available with no verse
      // selected - searching for a topic is how you get *out* of the empty state.
      await expect(studyPane(window).getByTestId('topic-search-input')).toBeVisible();
      await expect(pinButton(window)).toBeVisible();
    });
  });

  test.describe('Verse Study Data', () => {
    test('should load topics, commentaries, and cross-references on verse click', async ({ window }) => {
      await studyVerse(window, 1);

      // All three sections, scoped to the Study pane - the Commentary pane
      // carries headings of its own, so an unscoped count could be satisfied
      // entirely by the wrong pane.
      for (const title of ['Topics', 'Commentaries', 'Cross-References']) {
        await expect(section(window, title)).toBeVisible({ timeout: 15000 });
      }
    });

    test('shows real topical index entries for the studied verse', async ({ window }) => {
      // Named "for Genesis 1:1", but the fixture opens John 3 - and the whole
      // body sat inside `if (noTopicsCount === 0)`, so an empty Topics section
      // passed the test rather than failing it.
      //
      // John 3:1 has topic links in both installed indexes (4 in Nave's, 1 in
      // Torrey's), so there is a positive case to assert against.
      await studyVerse(window, 1);

      const topics = studyPane(window).getByTestId('study-topic-link');
      await expect(topics.first()).toBeVisible({ timeout: 20000 });
      expect(await topics.count()).toBeGreaterThan(0);

      await expect(studyPane(window).getByText(/No topical index entries/)).toHaveCount(0);
    });

    test('shows TSK cross-references for the studied verse', async ({ window }) => {
      // Named "for Genesis 1:1", but the fixture opens John 3 and the test
      // never navigated - so it studied John 3:1 and then looked for the
      // group heading "General", which is Genesis 1:1's. TSK labels John 3:1's
      // single group "Overall". The whole body was inside
      // `if (noXrefCount === 0)` as well.
      await studyVerse(window, 1);

      const pane = studyPane(window);
      await expect(pane.getByText(/Cross-References/)).toBeVisible({ timeout: 15000 });
      await expect(pane.getByText(/Treasury of Scripture Knowledge/).first()).toBeVisible();

      // The references themselves, not just the section chrome. Abbreviated
      // ("Jn 3:10"), because this pane now renders its references through
      // `collapseReferencesStructured` at `format: 'short'` for parity with the
      // web Study pane, rather than a full book name per entry on its own line.
      await expect(pane.getByText(/Jn\s*3:\s*10/)).toBeVisible({ timeout: 15000 });
    });

    test('should show commentary summaries with word counts', async ({ window }) => {
      // `wordCountEntries + noCommentary > 0` will not do - the "No commentary
      // entries" empty state satisfies it on its own, so a Study pane that
      // loaded nothing would pass. John 3:1 has entries in MHC, Barnes and TSK,
      // so the section must be populated.
      await studyVerse(window, 1);

      const cards = studyPane(window).getByTestId('study-commentary-card');
      await expect(cards.first()).toBeVisible({ timeout: 20000 });

      // Each card is a name, a word count and a preview. A card with no
      // preview is the failure mode worth catching: the summary query
      // returning metadata but no text.
      const first = cards.first();
      await expect(first).toHaveText(/\d+\s+words/);
      expect((await first.innerText()).replace(/\d+\s+words/, '').trim().length)
        .toBeGreaterThan(20);

      await expect(studyPane(window).getByText(/No commentary entries/)).toHaveCount(0);
    });
  });

  test.describe('Verse Sync & Navigation', () => {
    /**
     * These three tests encoded the *previous* sync model: that clicking a
     * different verse offers a "See study for ..." banner, and that pinning
     * suppresses it. The model is now the other way round - `StudyPane.tsx`
     * says so directly: "Only a pinned pane can be out of step with the Bible
     * pane now - an unpinned one follows the selected verse directly."
     *
     * The suggestion tests survived the change by asserting only inside
     * `if (hasSuggestion)`, so they passed while checking nothing; the
     * pin test asserted the banner was absent while pinned, and failed.
     */
    test('an unpinned pane follows the selected verse with no prompt', async ({ window }) => {
      expect(await clickVerse(window, 1)).toBe(true);
      await activateStudyTab(window);
      await expect(studyingBanner(window)).toBeVisible({ timeout: 15000 });

      expect(await clickVerse(window, 5)).toBe(true);

      await expect(studyPane(window).getByText(/Studying\s+\S.*:\s*5\b/))
        .toBeVisible({ timeout: 15000 });
      await expect(window.locator('[data-testid="suggestion-banner"]')).toHaveCount(0);
    });

    test('a pinned pane offers to sync instead of following', async ({ window }) => {
      expect(await clickVerse(window, 1)).toBe(true);
      await activateStudyTab(window);
      await expect(studyingBanner(window)).toBeVisible({ timeout: 15000 });

      await pinButton(window).click({ force: true });

      expect(await clickVerse(window, 5)).toBe(true);

      const banner = window.locator('[data-testid="suggestion-banner"]');
      await expect(banner).toBeVisible({ timeout: 15000 });
      // Pinned means pinned: the pane must still be on verse 1.
      await expect(studyPane(window).getByText(/Studying\s+\S.*:\s*1\b/)).toBeVisible();
    });

    test('accepting the suggestion moves the pinned pane to the new verse', async ({ window }) => {
      expect(await clickVerse(window, 1)).toBe(true);
      await activateStudyTab(window);
      await expect(studyingBanner(window)).toBeVisible({ timeout: 15000 });
      await pinButton(window).click({ force: true });
      expect(await clickVerse(window, 5)).toBe(true);

      const banner = window.locator('[data-testid="suggestion-banner"]');
      await expect(banner).toBeVisible({ timeout: 15000 });
      await banner.getByRole('button').first().click({ force: true });

      await expect(studyPane(window).getByText(/Studying\s+\S.*:\s*5\b/))
        .toBeVisible({ timeout: 15000 });
      await expect(banner).toHaveCount(0, { timeout: 10000 });
    });

    test('dismissing the suggestion leaves the pinned verse alone', async ({ window }) => {
      expect(await clickVerse(window, 1)).toBe(true);
      await activateStudyTab(window);
      await expect(studyingBanner(window)).toBeVisible({ timeout: 15000 });
      await pinButton(window).click({ force: true });
      expect(await clickVerse(window, 3)).toBe(true);

      const banner = window.locator('[data-testid="suggestion-banner"]');
      await expect(banner).toBeVisible({ timeout: 15000 });
      await banner.getByRole('button').last().click({ force: true });

      await expect(banner).toHaveCount(0, { timeout: 10000 });
      await expect(studyPane(window).getByText(/Studying\s+\S.*:\s*1\b/)).toBeVisible();
    });

    test('unpinning puts the pane back in step with the Bible pane', async ({ window }) => {
      expect(await clickVerse(window, 1)).toBe(true);
      await activateStudyTab(window);
      await expect(studyingBanner(window)).toBeVisible({ timeout: 15000 });
      await pinButton(window).click({ force: true });
      expect(await clickVerse(window, 5)).toBe(true);
      await expect(window.locator('[data-testid="suggestion-banner"]')).toBeVisible({ timeout: 15000 });

      await pinButton(window).click({ force: true });

      expect(await clickVerse(window, 7)).toBe(true);
      await expect(studyPane(window).getByText(/Studying\s+\S.*:\s*7\b/))
        .toBeVisible({ timeout: 15000 });
      await expect(window.locator('[data-testid="suggestion-banner"]')).toHaveCount(0);
    });
  });

  test.describe('Section Collapse/Expand', () => {
    /**
     * These asserted on the v/> glyph, which `StudySection` renders
     * `aria-hidden` - decoration, not state. `aria-expanded` on the header
     * button is the actual contract, and it is what a screen reader reads.
     */
    for (const title of ['Topics', 'Cross-References', 'Commentaries']) {
      test(`toggles the ${title} section`, async ({ window }) => {
        await studyVerse(window, 1);

        const header = section(window, title);
        await expect(header).toBeVisible({ timeout: 15000 });
        await expect(header).toHaveAttribute('aria-expanded', 'true');

        await header.click({ force: true });
        await expect(header).toHaveAttribute('aria-expanded', 'false');

        await header.click({ force: true });
        await expect(header).toHaveAttribute('aria-expanded', 'true');
      });
    }
  });

  test.describe('Commentary Detail', () => {
    test('should open inline commentary detail when a commentary card is clicked', async ({ window }) => {
      // Do not guard the body with
      // `if (await commentaryEntries.count() === 0) return;`. John 3:1 has
      // commentary in the installed modules, so an empty list is a failure,
      // not a reason to skip.
      await studyVerse(window, 1);

      const card = studyPane(window).getByTestId('study-commentary-card').first();
      await expect(card).toBeVisible({ timeout: 20000 });
      const cardName = (await card.innerText()).split('\n')[0].trim();
      await card.click({ force: true });

      const backButton = studyPane(window).getByRole('button', { name: /Back/ }).first();
      await expect(backButton).toBeVisible({ timeout: 15000 });

      // The detail view must show the commentary body, not just its chrome.
      // Counting `[style*="line-height"]` elements will not do - the summary
      // list has them too, so it passes without ever leaving the list.
      await expect(studyPane(window)).toContainText(cardName);
      expect((await studyPane(window).innerText()).length).toBeGreaterThan(200);

      await backButton.click({ force: true });

      // Back to the summary list, not merely back to a banner.
      await expect(studyPane(window).getByTestId('study-commentary-card').first())
        .toBeVisible({ timeout: 15000 });
      await expect(studyingBanner(window)).toBeVisible();
    });
  });

  test.describe('Topic Search', () => {
    /**
     * Both tests addressed the dropdown as
     * `[style*="position: absolute"][style*="z-index"]`, and the first asserted
     * only inside `if (await dropdown.count() > 0)` - so a search bar that
     * returned nothing passed. `TopicSearchBar` has carried
     * `topic-search-input` / `topic-search-results` test ids all along.
     */
    function searchInput(window: Page) {
      return studyPane(window).getByTestId('topic-search-input');
    }

    function results(window: Page) {
      return studyPane(window).getByTestId('topic-search-results');
    }

    test('should search topics and show results in dropdown', async ({ window }) => {
      await activateStudyTab(window);

      await searchInput(window).fill('love');

      await expect(results(window)).toBeVisible({ timeout: 15000 });
      expect(await results(window).getByRole('button').count()).toBeGreaterThan(0);
      // "love" is a topic in both Nave's and Torrey's; matching the query text
      // proves the results belong to the query rather than being stale.
      await expect(results(window)).toContainText(/love/i);
    });

    test('should clear search results when input is cleared', async ({ window }) => {
      await activateStudyTab(window);

      await searchInput(window).fill('love');
      await expect(results(window)).toBeVisible({ timeout: 15000 });

      await searchInput(window).fill('');

      await expect(results(window)).toHaveCount(0, { timeout: 10000 });
    });
  });

  test.describe('Clear Study', () => {
    test('should clear study state when x button is clicked', async ({ window }) => {
      await studyVerse(window, 1);

      // The control renders `&times;`, not the letter x, and is found by its
      // aria-label. `button:has-text("x")` matched the wrong button.
      await clearVerse(window);

      await expect(emptyHint(window)).toBeVisible({ timeout: 5000 });
    });
  });
});
