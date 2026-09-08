/**
 * Scripture Reference Links E2E Tests
 *
 * Commentary text is full of references - "Rom 8:28; Gen 1:1; John 1:1" - and
 * the app turns each into a link. The bug this file guards against is a
 * semicolon-separated list becoming ONE link covering all three references.
 *
 * The first-run layout opens no commentary at all, so these tests share a setup
 * that opens one known to contain reference lists (Scofield on John 3:16) and
 * assert that it produced links before asserting anything about them.
 *
 * TSK would be the natural choice, its entries being pure reference lists, but
 * it is not installable as a commentary: `main.db` registers it once, as the
 * cross-reference module `TSKxref`, so the module picker has no row for it and
 * a setup that reached for it would silently leave whatever tab was already
 * open on screen.
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Page } from '@playwright/test';
import { selectVerse } from '../fixtures/test-utils';

/** Links inside rendered commentary text - the ones this file is about. */
function commentaryLinks(window: Page) {
  return window.locator('[data-testid="commentary-entry-content"] a[href^="#verse-"]');
}

/**
 * Put Scofield's John 3:16 entry on screen.
 *
 * Scofield rather than any commentary: that entry is almost nothing but a
 * reference list - `Mark 2:22, Matthew 10:6; 15:24; 18:11; Luke 15:4...` -
 * so it exercises both shapes this file is about, the semicolon-separated list
 * and the context-relative continuation ("15:24" with no book name, which must
 * resolve against the `Matthew` that precedes it on the line).
 */
async function openScofieldOnJohn316(window: Page): Promise<void> {
  expect(await selectVerse(window, 16)).toBe(true);

  const commentaryTab = window.locator('.dockview-tab-content', { hasText: 'Commentary' }).first();
  await commentaryTab.click({ force: true });
  const pane = window.locator('[data-testid="commentary-pane"]');
  await expect(pane).toBeAttached({ timeout: 10000 });

  const addCommentary = pane.locator('button[title="Add Commentary"]');
  await expect(addCommentary).toBeAttached({ timeout: 10000 });
  await addCommentary.click({ force: true });

  const filter = window.locator('input[placeholder*="filter"]');
  await expect(filter).toBeVisible({ timeout: 10000 });
  await filter.fill('Scofield');
  // Enter selects the first match - the keyboard path in ModuleSelector's
  // handleKeyDown, which is more reliable than clicking through the overlay.
  await filter.press('Enter');

  // The setup is only complete once real links exist; every test below depends
  // on that, and a silent zero here would make them all vacuous.
  await expect(commentaryLinks(window).first()).toBeAttached({ timeout: 20000 });
}

test.describe('Scripture Reference Links', () => {
  test.beforeEach(async ({ window }) => {
    await openScofieldOnJohn316(window);
  });

  test.describe('Link format', () => {
    test('every reference becomes a link with a parseable verse href', async ({ window }) => {
      const hrefs = await commentaryLinks(window).evaluateAll(els =>
        els.map(el => el.getAttribute('href') ?? ''),
      );

      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        // A plain verse, or a range: `#verse-43001014` / `#verse-43001014-43001018`.
        expect(href).toMatch(/^#verse-\d+(-\d+)?$/);
      }
    });

    test('every verse id in a link is a real verse', async ({ window }) => {
      const hrefs = await commentaryLinks(window).evaluateAll(els =>
        els.map(el => el.getAttribute('href') ?? ''),
      );
      expect(hrefs.length).toBeGreaterThan(0);

      for (const href of hrefs) {
        for (const part of href.replace('#verse-', '').split('-')) {
          const verseId = parseInt(part, 10);
          const book = Math.floor(verseId / 1000000);
          const chapter = Math.floor((verseId % 1000000) / 1000);
          const verse = verseId % 1000;

          // A parse failure upstream shows up here as book 0 or chapter 0,
          // which links to nothing and silently does nothing when clicked.
          expect(book, href).toBeGreaterThanOrEqual(1);
          expect(book, href).toBeLessThanOrEqual(66);
          expect(chapter, href).toBeGreaterThanOrEqual(1);
          expect(chapter, href).toBeLessThanOrEqual(150);
          expect(verse, href).toBeGreaterThanOrEqual(1);
          expect(verse, href).toBeLessThanOrEqual(200);
        }
      }
    });

    test('links carry the scripture-link class the handlers delegate on', async ({ window }) => {
      // Click handling is delegated from the pane container by this class, so a
      // link without it renders as a link and does nothing.
      const classes = await commentaryLinks(window).evaluateAll(els =>
        els.map(el => el.getAttribute('class') ?? ''),
      );

      expect(classes.length).toBeGreaterThan(0);
      for (const className of classes) {
        expect(className).toContain('scripture-link');
      }
    });
  });

  test.describe('Semicolon-separated reference lists', () => {
    test('each reference in a list gets its own link', async ({ window }) => {
      // The reported bug: "Rom 8:28; Gen 1:1; John 1:1" arriving as a single
      // link whose text carries all three.
      const texts = await commentaryLinks(window).allTextContents();
      expect(texts.length).toBeGreaterThan(0);

      for (const text of texts) {
        expect(text, text).not.toContain(';');
      }
    });

    test('a link never spans two book names', async ({ window }) => {
      // The other shape of the same bug: "John 3:16Romans 8:28" with no
      // separator left between them.
      const texts = await commentaryLinks(window).allTextContents();
      expect(texts.length).toBeGreaterThan(0);

      for (const text of texts) {
        const bookMatches = text.match(/[A-Za-z]+\s+\d+/g) ?? [];
        expect(bookMatches.length, text).toBeLessThanOrEqual(1);
      }
    });

    test('Scofield\'s John 3:16 entry yields many links, not one', async ({ window }) => {
      // A concatenation bug collapses the whole entry into a handful of links,
      // so the count itself is a signal. The entry carries eight references.
      expect(await commentaryLinks(window).count()).toBeGreaterThan(5);
    });
  });

  test.describe('Context-aware references', () => {
    test('a bare chapter:verse resolves against the current book', async ({ window }) => {
      // Scofield's John 3:16 entry reads "...Matthew 10:6; 15:24; 18:11...".
      // The bare "15:24" and "18:11" carry no book name and must resolve
      // against the Matthew that precedes them on the line - book 40, not the
      // pane's John, and not Genesis.
      const hrefs = await commentaryLinks(window).evaluateAll(els =>
        els.map(el => el.getAttribute('href')),
      );

      const hasMatt1524 = hrefs.some(href => href?.startsWith('#verse-40015024'));
      const hasMatt1811 = hrefs.some(href => href?.startsWith('#verse-40018011'));
      expect(hasMatt1524 || hasMatt1811, `hrefs: ${hrefs.slice(0, 20).join(', ')}`).toBe(true);
    });
  });

  test.describe('Navigation', () => {
    test('clicking a link takes the Bible pane to that verse', async ({ window }) => {
      const link = commentaryLinks(window).first();
      const href = await link.getAttribute('href');
      const verseId = parseInt(href!.replace('#verse-', '').split('-')[0], 10);
      const book = Math.floor(verseId / 1000000);
      const chapter = Math.floor((verseId % 1000000) / 1000);

      await link.click({ force: true });

      const heading = window.locator('[data-testid="bible-chapter-heading"]');
      await expect(heading).toContainText(String(chapter), { timeout: 10000 });
      // Book 43 is John - the chapter alone would also match the chapter the
      // pane was already on.
      if (book !== 43) {
        await expect(heading).not.toContainText('John', { timeout: 10000 });
      }
    });

    test('the Bible pane survives clicking several links in a row', async ({ window }) => {
      const count = Math.min(await commentaryLinks(window).count(), 3);
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        // Re-queried each time: navigation re-renders the commentary, so a
        // held locator goes stale.
        await commentaryLinks(window).nth(i).click({ force: true });
        await expect(window.locator('[data-testid="bible-pane"]')).toBeAttached({ timeout: 10000 });
        // Verses, not just the shell - a failed navigation leaves the pane
        // present and empty.
        await expect(window.locator('[data-testid^="verse-"]').first()).toBeAttached({ timeout: 10000 });
      }
    });
  });
});
