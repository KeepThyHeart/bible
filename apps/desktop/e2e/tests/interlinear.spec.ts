/**
 * Interlinear Display E2E Tests
 *
 * These tests hedged on which layout was rendering - "stacked layout has
 * `interlinear-word`; inline renders words as spans" - and branched on
 * `count() > 0` to decide what to assert. That hedge was never needed: both
 * layouts carry the same testids (`InterlinearDisplay.tsx` tags
 * `interlinear-container`, `-word`, `-gloss`, `-original`, `-transliteration`
 * in each). The branching only meant a test that found nothing asserted
 * something else and passed.
 *
 * Two of them could assert nothing at all: "should open dictionary when
 * clicking Strong's number" wrapped its check in `if (dictCount > 0)`, and
 * "should display transliteration when available" in `if (count > 0)`.
 *
 * Both layouts are now covered explicitly, because the difference between them
 * is what the reader sees.
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Page } from '@playwright/test';

/** Set the interlinear layout via the radio in Study controls. */
async function useLayout(window: Page, layout: 'inline' | 'stacked'): Promise<void> {
  const radio = window.locator(`input[name="interlinearLayout"][value="${layout}"]`);
  await expect(radio).toBeAttached({ timeout: 10000 });
  await radio.check({ force: true });
  await expect(radio).toBeChecked();
  await expect(window.locator('[data-testid="interlinear-container"]').first())
    .toBeAttached({ timeout: 15000 });
}

test.describe('Interlinear Display', () => {
  test.beforeEach(async ({ window }) => {
    // Switching to study mode re-renders the whole chapter and loads study
    // data. That takes several seconds in a built app and longer with four
    // Electron workers in parallel.
    test.slow();

    await window.locator('[data-testid="display-mode-select"]')
      .selectOption('study', { force: true, timeout: 60000 });
    await window.waitForSelector('[data-testid="study-controls"]', { timeout: 15000 });

    // Unconditional: KJV - the module the fixture opens - ships interlinear
    // data, so a missing toggle is a failure. A `test.skip` on a zero count
    // would turn any regression that removes the toggle into a green run.
    //
    // And it must arrive ALREADY CHECKED. Do not write
    // `if (!await checkbox.isChecked()) await checkbox.check(...)`: that ticks
    // the box on the suite's behalf, so if switching to Study mode stops
    // enabling interlinear these tests all still pass and the user finds the
    // regression instead. Asserting the default is the whole point: a guard
    // that repairs the state under test cannot fail.
    const checkbox = window.locator('[data-testid="interlinear-checkbox"]');
    await expect(checkbox).toBeAttached({ timeout: 15000 });
    await expect(checkbox).toBeChecked({ timeout: 15000 });

    await window.waitForSelector('[data-testid="strongs-number"]', { timeout: 15000 });
  });

  // Named separately from the beforeEach assertion so a failure reads as
  // "Study mode no longer turns interlinear on" rather than as every
  // interlinear test breaking at once.
  test('switching to Study mode turns interlinear on by default', async ({ window }) => {
    await expect(window.locator('[data-testid="interlinear-checkbox"]')).toBeChecked();
    await expect(window.locator('[data-testid="interlinear-container"]').first())
      .toBeAttached({ timeout: 15000 });
  });

  for (const layout of ['inline', 'stacked'] as const) {
    test.describe(`${layout} layout`, () => {
      test.beforeEach(async ({ window }) => {
        await useLayout(window, layout);
      });

      test('renders interlinear words', async ({ window }) => {
        const words = window.locator('[data-testid="interlinear-word"]');

        expect(await words.count()).toBeGreaterThan(0);
        await expect(words.first()).toBeVisible();
      });

      test('shows the original-language word', async ({ window }) => {
        const original = window.locator('[data-testid="interlinear-original"]');

        expect(await original.count()).toBeGreaterThan(0);
        const text = await original.first().textContent();
        // Greek, for John 3 - so outside the Latin range.
        expect(text?.trim()).toMatch(/[^\u0000-\u024F]/);
      });

      test('emits no transliteration element when the module has no transliterations', async ({ window }) => {
        // Not the assertion this test would like to make. KJV's
        // `interlinear_word` table carries zero transliterations - verified
        // across all 355,426 rows - so there is no positive case to check
        // against the dev dataset. What is checked instead is that the absent
        // data produces *nothing*: an empty italic span beside every word is a
        // visible defect, and a `if (count > 0)` guard here would pass either way.
        expect(await window.locator('[data-testid="interlinear-transliteration"]').count()).toBe(0);
      });

      test('shows the English gloss', async ({ window }) => {
        const gloss = window.locator('[data-testid="interlinear-gloss"]');

        expect(await gloss.count()).toBeGreaterThan(0);
        expect((await gloss.first().textContent())?.trim().length).toBeGreaterThan(0);
      });

      test('shows Strong\'s numbers in the standard form', async ({ window }) => {
        const strongs = window.locator('[data-testid="strongs-number"]');

        expect(await strongs.count()).toBeGreaterThan(0);
        await expect(strongs.first()).toBeVisible();
        expect(await strongs.first().textContent()).toMatch(/^[GH]\d+$/);
      });

      test('keeps the English text complete', async ({ window }) => {
        // The regression the cell model exists to prevent: rendering one block
        // per interlinear row drops every English word no row claims - 5.7% of
        // the KJV, including all the italicised supplied words. John 3:16 has
        // several, so the verse simply reads wrong when it recurs.
        const glosses = await window.locator('[data-testid="interlinear-gloss"]').allTextContents();
        const rendered = glosses.join(' ').toLowerCase();

        for (const word of ['god', 'so', 'loved', 'world']) {
          expect(rendered, `missing "${word}"`).toContain(word);
        }
      });
    });
  }

  test.describe('Strong\'s lookup', () => {
    test('clicking a Strong\'s number opens its dictionary entry', async ({ window }) => {
      // Assert unconditionally. `if (dictCount > 0)` would assert only once the
      // dictionary had opened, which is the whole thing being tested.
      const strongs = window.locator('[data-testid="strongs-number"]').first();
      const number = (await strongs.textContent())?.trim();
      expect(number).toMatch(/^[GH]\d+$/);

      await strongs.click({ force: true });

      const entry = window.locator('[data-testid="dictionary-entry"]');
      await expect(entry.first()).toBeVisible({ timeout: 20000 });
      // The entry that opened must be the number that was clicked, not merely
      // some entry left over from an earlier lookup. Matched on the digits:
      // the dictionary keys Strong's entries zero-padded and without the
      // language prefix, so G1510 is stored as 01510.
      const digits = number!.replace(/^[GH]0*/, '');
      await expect(window.locator('[data-testid="dictionary-entry-key"]').first())
        .toContainText(digits, { timeout: 20000 });
    });
  });

  test.describe('Layout switching', () => {
    test('the two layouts render differently from the same data', async ({ window }) => {
      // Both carry the same testids, so a switch that silently did nothing
      // would satisfy every test above. The container class is what actually
      // differs.
      await useLayout(window, 'inline');
      const container = window.locator('[data-testid="interlinear-container"]').first();
      await expect(container).toHaveClass(/interlinear-inline/);

      await useLayout(window, 'stacked');

      await expect(container).toHaveClass(/interlinear-stacked/);
    });
  });
});
