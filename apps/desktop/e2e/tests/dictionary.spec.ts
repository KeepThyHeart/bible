/**
 * Dictionary Pane E2E Tests
 *
 * These drive the real path - Library overview -> open a dictionary -> look up
 * an entry - and assert on the entry that comes back. The Dictionary tab opens
 * `BookPane`, whose dictionaries render through `DictionarySinglePanel`;
 * `[data-testid="dictionary-lookup-input"]` belongs to `DictionaryPane` and is
 * absent on this path.
 *
 * The lookup box is a live search (`DictionaryLiveSearch`): matches appear
 * underneath it on a 200ms debounce. Submitting still works - Enter or the
 * "Look up" button opens the highlighted match, or falls back to the exact-key
 * cascade when the debounce has not fired yet - so the Strong's-number tests
 * below reach the same entry down either path.
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Page } from '@playwright/test';
import { ensurePaneOpen } from '../fixtures/test-utils';

/**
 * Strong's Greek is in the dev dataset, and its keys are zero-padded: looking
 * up "G25" (agapao) must resolve to entry `00025`. That normalisation is the
 * reason to prefer it over a word dictionary here.
 */
const DICTIONARY = 'StrongsGreek';
const STRONGS_QUERY = 'G25';
const STRONGS_KEY = '00025';

// BookPane renders an open dictionary through `DictionaryPane hideTabs`, so
// these are its ids. They exist only once a dictionary has been opened.
const lookupInput = (window: Page) => window.locator('[data-testid="dictionary-lookup-input"]');
const entry = (window: Page) => window.locator('[data-testid="dictionary-entry"]');
const entryKey = (window: Page) => window.locator('[data-testid="dictionary-entry-key"]');

/** Open the Dictionary pane and open one dictionary module inside it. */
async function openDictionary(window: Page): Promise<void> {
  await ensurePaneOpen(window, 'Dictionary');
  await expect(window.locator('[data-testid="books-pane"]')).toBeVisible({ timeout: 15000 });

  // A Dictionary pane with nothing open lands on its Overview shelf, which is
  // how a reader finds a module to open. No click needed to reach it.
  const shelf = window.locator('[data-testid="library-home"]');
  await expect(shelf).toBeVisible({ timeout: 15000 });

  const item = shelf.locator(`[data-testid="library-item-${DICTIONARY}"]`);
  await expect(item).toBeVisible({ timeout: 15000 });
  // force: the window under test may be minimized, which fails Playwright's
  // actionability check on a perfectly interactable element.
  await item.click({ force: true });

  await expect(lookupInput(window)).toBeVisible({ timeout: 15000 });
}

/** Type a term into the lookup box and submit it. */
async function lookUp(window: Page, term: string): Promise<void> {
  await lookupInput(window).fill(term);
  await window.locator('[data-testid="dictionary-lookup-btn"]').click({ force: true });
}

test.describe('Dictionary Pane', () => {
  test('opens a dictionary from the library shelf, with a lookup box', async ({ window }) => {
    await openDictionary(window);

    await expect(lookupInput(window)).toBeVisible();
    await expect(window.locator('[data-testid="dictionary-lookup-btn"]')).toBeVisible();
    await expect(window.locator('[data-testid="dictionary-pane"]')).toBeVisible();
  });

  test("normalises a Strong's number to its padded entry key", async ({ window }) => {
    await openDictionary(window);

    await lookUp(window, STRONGS_QUERY);

    await expect(entry(window)).toBeVisible({ timeout: 15000 });
    await expect(entryKey(window)).toContainText(STRONGS_KEY);
    await expect(entry(window)).not.toBeEmpty();
  });

  test('shows matches under the box as the word is typed, without submitting', async ({ window }) => {
    // The point of the live list: "love" is not a Strong's key, so an exact
    // lookup misses - but the entries that *are* about love have to be offered
    // while the word is still being typed, not after a failed submit.
    await openDictionary(window);

    await lookupInput(window).fill('love');

    const rows = window.locator('[data-testid="dictionary-live-result"]');
    await expect(rows.first()).toBeVisible({ timeout: 15000 });

    await rows.first().click({ force: true });

    await expect(entry(window)).toBeVisible({ timeout: 15000 });
    await expect(entry(window)).not.toBeEmpty();
  });

  test('navigates from one entry to a related one', async ({ window }) => {
    await openDictionary(window);
    await lookUp(window, STRONGS_QUERY);
    await expect(entryKey(window)).toContainText(STRONGS_KEY, { timeout: 15000 });

    // G26 (agape) is derived from G25 and is a separate entry, so looking it up
    // must replace what is shown rather than leave the previous entry in place.
    await lookUp(window, 'G26');

    await expect(entryKey(window)).toContainText('00026', { timeout: 15000 });
    await expect(entryKey(window)).not.toContainText(STRONGS_KEY);
  });
});
