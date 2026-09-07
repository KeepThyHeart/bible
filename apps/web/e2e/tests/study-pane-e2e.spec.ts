import { test, expect, type Page } from '@playwright/test';

/**
 * Open a collapsed study section by clicking its label.
 *
 * `StudySection` renders with `defaultExpanded = false`, so a section's content
 * is not in the DOM until it is expanded — which is why several tests here used
 * to look for content that could never be there.
 */
async function expandSection(page: Page, label: RegExp): Promise<void> {
  const header = page.locator('.study-pane__section-label').filter({ hasText: label }).first();
  await expect(header).toBeVisible({ timeout: 15000 });
  const body = header.locator('xpath=..').locator('.study-pane__section-body');
  if (await body.count() === 0) await header.click();
  await expect(body).toBeVisible({ timeout: 10000 });
}

/**
 * Select a verse and bring the Study pane up on it.
 *
 * Seven tests open this way. Each used to sleep 500ms after clicking the verse
 * and another 1000ms after switching tabs — approximating "the pane has
 * content", which `.study-pane__passage` states outright.
 */
async function openStudyOnVerse(page: Page, index = 0): Promise<void> {
  await page.locator('.verse').nth(index).click();
  await page.locator('.right-pane-tabs__tab').filter({ hasText: /study/i }).click();
  await expect(page.locator('.study-pane')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.study-pane__passage')).toBeVisible({ timeout: 15000 });
}

test.describe('Study Pane', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    await page.waitForSelector('.app');
    // Navigate to a well-known passage
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3:16');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });
  });

  test('study tab exists and shows study pane', async ({ page }) => {
    const studyTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /study/i });
    await expect(studyTab).toBeVisible();
    await studyTab.click();

    await expect(page.locator('.study-pane')).toBeVisible({ timeout: 5000 });
  });

  test('study pane shows passage reference for selected verse', async ({ page }) => {
    await openStudyOnVerse(page);
    // The passage reference is what tells the reader which verse the pane is
    // about, so it is required rather than checked-if-present.
    await expect(page.locator('.study-pane__passage')).toHaveText(/John\s*3:\s*\d+/, { timeout: 10000 });
  });

  test('study pane shows cross-references section', async ({ page }) => {
    await openStudyOnVerse(page);

    // Study sections start collapsed (StudySection defaults `defaultExpanded`
    // to false), so the section has to be opened before its content exists.
    // That is why the original `.study-crossrefs` lookup never matched and its
    // guard swallowed the whole test.
    await expandSection(page, /cross/i);

    // TSK is active in data/settings.json and John 3:16 is among the most
    // cross-referenced verses in it, so an empty section here is a failure. The
    // old assertion was `count >= 0`, which is true of every number.
    await expect(page.locator('.study-crossrefs')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.study-crossrefs__ref-link, .study-crossrefs__vl-ref').first())
      .toBeVisible({ timeout: 15000 });
  });

  test('study pane shows topics section for verse', async ({ page }) => {
    await openStudyOnVerse(page);

    await expandSection(page, /topics/i);

    // Whether this verse has topics or not, the section must resolve to one of
    // its three real states rather than staying blank; and any topic it does
    // list has to carry a name. The old double guard checked neither.
    await expect(
      page.locator('.study-topics, .study-topics__empty, .study-topics__loading').first(),
    ).toBeVisible({ timeout: 15000 });

    for (const name of await page.locator('.study-topics__chain').allTextContents()) {
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });

  test('clicking a cross-reference previews it in the Bible pane', async ({ page }) => {
    // Was "clicking cross-reference link navigates to verse", and asserted only
    // that `.bible-pane` was still visible — inside
    // `if (await refLink.isVisible())`, so it usually asserted nothing at all.
    //
    // On a fine pointer the link goes through `useVersePopup` →
    // `bibleStore.navigateToPreview`, which marks the target as the preview
    // verse and scrolls to it. It deliberately does *not* change tab, title or
    // study selection — TSK's first reference for a verse is often in the same
    // chapter, and re-titling the tab for that would be noise. So the preview
    // marker is the signal, and it is the same one whether the target is in
    // this chapter or another.
    await openStudyOnVerse(page);
    await expandSection(page, /cross[- ]?ref/i);

    await expect(page.locator('.verse--preview')).toHaveCount(0);

    const refLink = page.locator('.study-crossrefs__ref-link, .study-crossrefs__vl-ref').first();
    await expect(refLink).toBeVisible({ timeout: 15000 });
    await refLink.click();

    await expect(page.locator('.verse--preview').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.verse').first()).toBeVisible();
  });

  test('pin button toggles pinned state', async ({ page }) => {
    await openStudyOnVerse(page);

    // The pin control is not optional, and neither is its effect. The old body
    // ran inside `if (pinBtn.isVisible())` and accepted either the active class
    // or the banner via `expect(a || b).toBeTruthy()`, which cannot say which
    // one was missing — or notice that neither appeared for the right reason.
    const pinBtn = page.locator('.study-pane__pin');
    const banner = page.locator('.study-pane__pinned-banner');
    await expect(pinBtn).toBeVisible({ timeout: 15000 });

    const pinnedPassage = (await page.locator('.study-pane__passage').textContent())?.trim() ?? '';
    await pinBtn.click();
    await expect(page.locator('.study-pane__pin--active')).toBeVisible({ timeout: 10000 });

    await page.locator('.verse').nth(3).click();
    await expect(banner).toBeVisible({ timeout: 10000 });
    // Pinned means pinned: the pane must not have followed.
    await expect(page.locator('.study-pane__passage')).toHaveText(pinnedPassage);

    await pinBtn.click();
    await expect(page.locator('.study-pane__pin--active')).toHaveCount(0, { timeout: 10000 });
    await expect(banner).toHaveCount(0, { timeout: 10000 });
  });

  test('study sections are labelled', async ({ page }) => {
    await openStudyOnVerse(page);

    const sectionLabels = page.locator('.study-pane__section-label');
    await expect(sectionLabels.first()).toBeVisible({ timeout: 15000 });

    // Every label, not just the first: an unlabelled section is a blank heading
    // above a list of references.
    for (const label of await sectionLabels.allTextContents()) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  test('navigating to different verse updates study pane', async ({ page }) => {
    // Switch to study pane
    const studyTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /study/i });
    await studyTab.click();
    await expect(page.locator('.study-pane')).toBeVisible({ timeout: 5000 });

    const passage = page.locator('.study-pane__passage');

    await page.locator('.verse').first().click();
    await expect(passage).toBeVisible({ timeout: 10000 });
    const firstPassage = (await passage.textContent())?.trim() ?? '';
    expect(firstPassage.length).toBeGreaterThan(0);

    // Unconditional: the pane failing to follow the selection is the regression
    // this test is named for, and every guard here let it through silently.
    await page.locator('.verse').nth(3).click();
    await expect(passage).not.toHaveText(firstPassage, { timeout: 10000 });
  });
});
