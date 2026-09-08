/**
 * Highlight Diagnosis E2E Tests
 *
 * Drives the REAL Electron app through the drag-select -> floating annotation
 * toolbar -> colour swatch flow that users actually perform, and asserts at
 * every stage:
 *
 *   1. the passage renders
 *   2. a real DOM Selection is produced by real mouse events
 *   3. the floating toolbar actually appears
 *   4. clicking a swatch produces a highlight span in the DOM
 *   5. that span's COMPUTED background-color is actually painted (a class can
 *      be applied while no CSS rule matches - that renders invisibly and looks
 *      exactly like "highlighting doesn't work")
 *   6. the highlight survives a reload
 *
 * The whole flow is run in all three display modes (standard / reading /
 * study) plus study-with-interlinear, because each renders verses through a
 * different component. Underlines are checked the same way - computed
 * `text-decoration-*`, never class presence.
 *
 * Screenshots for every step land in e2e/test-results/highlight-diag/.
 */

import type { Locator } from '@playwright/test';
import { test, expect, Page } from '../fixtures/electron.fixture';
import path from 'path';
import fs from 'fs';
import {
  setDisplayMode,
  enableInterlinear,
  dragAcross,
  getSelectionInfo,
  getHighlightInfo,
  isVisiblyPainted,
} from '../fixtures/highlight-utils';

// NOT under e2e/test-results - Playwright wipes its outputDir on every run.
const SHOT_DIR = path.resolve(__dirname, '../highlight-diag-screenshots');

fs.mkdirSync(SHOT_DIR, { recursive: true });

async function shot(window: Page, name: string): Promise<void> {
  await window.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Ask the main process how many markup rows are actually persisted. */
async function countPersistedHighlights(window: Page): Promise<number> {
  const info = await getHighlightInfo(window);
  return info.markupIds.length;
}

/** The four renderers a verse can go through, and how to get to each. */
const SCENARIOS = [
  { name: 'standard', mode: 'standard' as const, interlinear: false },
  { name: 'reading', mode: 'reading' as const, interlinear: false },
  { name: 'study', mode: 'study' as const, interlinear: false },
  { name: 'study+interlinear', mode: 'study' as const, interlinear: true },
];

/**
 * Wait for a locator without failing if it never arrives.
 *
 * This file is a *diagnostic*: when a highlight fails to appear, the value is
 * in the assertion messages below, which report class names, computed colours
 * and word counts. A hard wait here would replace those with a bare Playwright
 * timeout. So each of these settles as soon as the effect lands and otherwise
 * falls through to the real assertion - which is what the fixed 900ms/1200ms
 * sleeps were doing, only slower and with no upper bound on a loaded machine.
 *
 * The default is generous because it is only ever *spent* on a genuine failure:
 * on the passing path it returns the moment the element attaches.
 */
async function settle(locator: Locator, timeout = 30000): Promise<void> {
  await locator.first().waitFor({ state: 'attached', timeout }).catch(() => undefined);
}

/** Two frames, so a scrollIntoView has been laid out before boxes are read. */
async function nextFrames(window: Page): Promise<void> {
  await window.evaluate(
    () => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

test.describe('Highlight diagnosis (real Electron)', () => {
  for (const scenario of SCENARIOS) {
    const mode = scenario.name;

    test(`drag-select -> floating toolbar -> highlight renders [${mode} mode]`, async ({
      window,
    }) => {
      test.slow();

      /*
        Every renderer a verse can go through must highlight identically.

        Standard, Reading and Study's plain text render through
        HighlightedVerse -> applyHighlightsToVerse, which emits one
        `<span class="word" data-word-index=N>` per word inside a
        `[data-verse-id]` wrapper. Everything about highlighting is built on
        those two attributes: useBibleHighlights.buildSelectionFromDOM maps a
        selection to word indices by querying `.word`, and HighlightRenderer
        paints stored markup back onto the same indices.

        Study mode is wired the same way. Render it as raw HTML
        (`dangerouslySetInnerHTML` on a bare <p>) or leave it outside
        <HighlightSelector> and it produces no `.word` spans, so the floating
        toolbar never appears and stored markup never paints.

        Study+interlinear matters most, because `showInterlinear` defaults to
        true for a tab created in Study mode and so is the *default* Study
        experience. InterlinearDisplay builds its own JSX spans but resolves them
        through the same highlightAttrsForWord() the string path uses, over the
        same English word indices. Note `setDisplayMode` does NOT set showInterlinear - the
        interlinear case forces and asserts the toggle explicitly.
      */
      const diag: Record<string, unknown> = { mode };

      // ---- Step 1: open a passage in the requested display mode -------------
      await setDisplayMode(window, scenario.mode);
      if (scenario.interlinear) {
        const available = await enableInterlinear(window);
        test.skip(!available, 'Active Bible module ships no interlinear data');
        // Both must be present at once, proving this is the interlinear
        // renderer and not the plain fallback.
        expect(await window.locator('[data-testid="strongs-number"]').count()).toBeGreaterThan(0);
        expect(await window.locator('[data-testid="interlinear-word"]').count()).toBeGreaterThan(0);
      }
      await shot(window, `${mode}-1-passage`);

      const verse = window.locator('[data-testid="verse-16"]').first();
      const verseVisible = await verse.isVisible().catch(() => false);
      diag.verse16Visible = verseVisible;

      // How is the verse text structured in this mode? A mode with no .word
      // spans at all cannot highlight, which is the failure this spec exists
      // to catch.
      const structure = await window.evaluate(() => {
        const paneWords = document.querySelectorAll('.pane-content-bible .word');
        const verseEls = document.querySelectorAll('[data-verse-id]');
        return {
          wordSpansInPane: paneWords.length,
          elementsWithVerseId: verseEls.length,
        };
      });
      diag.structure = structure;

      // ---- Step 2: drag-select a few words inside one verse -----------------
      // Prefer dragging across specific .word spans when they exist; otherwise
      // fall back to dragging across the verse's own box.
      // The verse must be scrolled into the viewport first: Playwright's mouse
      // works in viewport coordinates, and John 3:16 sits ~1500px down the
      // scroll container on first paint. Dragging at an off-screen y silently
      // produces no selection at all.
      // Find the element holding John 3:16's text. Every mode now wraps it in
      // [data-verse-id]; the text fallback is kept so a regression that loses
      // the wrapper fails on the real assertion below rather than on "element
      // not found".
      const findVerseEl = () => {
        const byTestId = document.querySelector('[data-testid="verse-16"]');
        if (byTestId) return byTestId;
        const paragraphs = Array.from(document.querySelectorAll('.pane-content-bible p'));
        return (
          paragraphs.find((p) => (p.textContent || '').includes('God so loved the world')) ||
          document.querySelector('[data-verse-id]')
        );
      };

      await window.evaluate(`(${findVerseEl.toString()})()?.scrollIntoView({ block: 'center' })`);
      await nextFrames(window);

      const wordBoxes = (await window.evaluate(`(() => {
        const findVerseEl = ${findVerseEl.toString()};
        const container = findVerseEl();
        if (!container) return null;
        const words = Array.from(container.querySelectorAll('.word'));
        if (words.length >= 6) {
          const a = words[1].getBoundingClientRect();
          // Pick the furthest word (up to index 5) still on the SAME visual
          // line as word 1. In the stacked interlinear layout each word sits in
          // its own inline-block column, so word 4 can easily have wrapped to
          // the next row — dragging to it would produce a negative width and no
          // usable selection.
          let b = a;
          for (let i = 2; i <= 5 && i < words.length; i++) {
            const r = words[i].getBoundingClientRect();
            if (Math.abs(r.top - a.top) > 4) break;
            b = r;
          }
          return {
            source: 'word-spans',
            x: a.left,
            y: a.top,
            width: Math.max(b.right - a.left, a.width),
            height: a.height,
          };
        }
        const r = container.getBoundingClientRect();
        return { source: 'verse-box', x: r.left, y: r.top, width: r.width, height: r.height };
      })()`)) as {
        source: string;
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;

      diag.dragTargetSource = wordBoxes?.source ?? 'none';
      expect(wordBoxes, 'no verse element found to drag across').not.toBeNull();

      const box = wordBoxes!;
      if (box.source === 'word-spans') {
        // Drag the full span of words 1..4
        const y = box.y + box.height / 2;
        await window.mouse.move(box.x + 2, y);
        await window.mouse.down();
        for (let i = 1; i <= 12; i++) {
          await window.mouse.move(box.x + 2 + ((box.width - 4) * i) / 12, y);
          await window.waitForTimeout(15);
        }
        await window.mouse.up();
        // Deliberately a sleep: the assertions below report *whether* the
        // selection and toolbar appeared, so waiting for them first would
        // replace a diagnostic message with a Playwright timeout.
        await window.waitForTimeout(500);
      } else {
        await dragAcross(window, box, 0.05, 0.45);
      }

      const selection = await getSelectionInfo(window);
      diag.selection = selection;
      await shot(window, `${mode}-2-after-drag`);

      // ---- Step 3: floating annotation toolbar must appear ------------------
      const toolbar = window.locator('.floating-annotation-toolbar');
      const toolbarCount = await toolbar.count();
      diag.toolbarCount = toolbarCount;
      await shot(window, `${mode}-3-toolbar`);

      console.log(`[DIAG ${mode}] ${JSON.stringify(diag, null, 2)}`);

      expect(
        selection.isCollapsed,
        `[${mode}] real mouse drag produced no DOM selection (text="${selection.text}")`
      ).toBe(false);

      expect(
        toolbarCount,
        `[${mode}] floating annotation toolbar did not appear after selecting "${selection.text}". ` +
          `word spans in pane = ${structure.wordSpansInPane}`
      ).toBeGreaterThan(0);
      await expect(toolbar.first()).toBeVisible();

      // ---- Step 4: click a highlight colour swatch --------------------------
      const swatch = toolbar.first().locator('.floating-toolbar-swatch.highlight-yellow');
      await expect(swatch).toBeVisible();
      await swatch.click({ force: true });
      await settle(window.locator('.word.highlighted'));
      await shot(window, `${mode}-4-after-swatch`);

      // ---- Step 5: highlight is in the DOM *and* actually painted -----------
      const info = await getHighlightInfo(window);
      console.log(`[DIAG ${mode}] highlight info: ${JSON.stringify(info, null, 2)}`);
      await shot(window, `${mode}-5-highlight`);

      expect(
        info.highlightedCount,
        `[${mode}] no .word.highlighted span in the DOM after clicking the yellow swatch`
      ).toBeGreaterThan(0);

      expect(
        info.firstClasses,
        `[${mode}] highlighted word is missing the highlight-yellow class: ${info.firstClasses}`
      ).toContain('highlight-yellow');

      expect(
        isVisiblyPainted(info.firstBackground),
        `[${mode}] highlight class applied but computed background-color is not painted ` +
          `(computed="${info.firstBackground}", classes="${info.firstClasses}", inline="${info.firstInlineStyle}")`
      ).toBe(true);

      // ---- Step 6: underline the same words, and check COMPUTED decoration --
      // The class-versus-computed trap again: `floatingAnnotationFlow.test.tsx`
      // only ever asserted class names, and the e2e underline case in
      // highlights.spec.ts used a selector that matches nothing. Nothing in the
      // suite proved an underline is actually drawn until this.
      await window.mouse.move(box.x + 2, box.y + box.height / 2);
      await window.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await window.mouse.move(box.x + 2 + ((box.width - 4) * i) / 12, box.y + box.height / 2);
        await window.waitForTimeout(15);
      }
      await window.mouse.up();

      const underlineToolbar = window.locator('.floating-annotation-toolbar').first();
      // `useBibleSelection` defers the toolbar by 50ms after mouseup; a
      // retrying assertion covers that without a fixed 500ms.
      await expect(underlineToolbar).toBeVisible({ timeout: 15000 });
      const underlineBtn = underlineToolbar.locator('.floating-toolbar-btn').first();
      await expect(underlineBtn).toBeVisible();
      await underlineBtn.click({ force: true });
      await settle(window.locator('.word.underlined, .word[class*="underline"]'));
      await shot(window, `${mode}-6-underline`);

      const underlineInfo = await getHighlightInfo(window);
      console.log(`[DIAG ${mode}] underline info: ${JSON.stringify(underlineInfo, null, 2)}`);

      expect(
        underlineInfo.underlinedCount,
        `[${mode}] no word has a computed text-decoration-line of underline after ` +
          `clicking the toolbar underline button`
      ).toBeGreaterThan(0);
      expect(underlineInfo.underlineLine).toContain('underline');
      expect(
        underlineInfo.underlineStyleName,
        `[${mode}] underline style resolved to "${underlineInfo.underlineStyleName}" ` +
          `(classes="${underlineInfo.underlineClasses}")`
      ).toBe('solid');
      // A decoration colour identical to the text colour means the palette rule
      // never matched - the underline is drawn, but not in the colour asked for.
      expect(
        underlineInfo.underlineColor,
        `[${mode}] text-decoration-color equals the text colour, so no ` +
          `underline-color-* rule matched (classes="${underlineInfo.underlineClasses}")`
      ).not.toBe(underlineInfo.underlineTextColor);
      expect(isVisiblyPainted(underlineInfo.underlineColor)).toBe(true);

      // ---- Step 7: persistence across a reload ------------------------------
      const beforeReload = await countPersistedHighlights(window);
      // `waitUntil: 'domcontentloaded'` before the selector: without it the
      // wait can latch onto the *outgoing* document's `app-loaded` element,
      // which resolves "visible" and then never settles, and the call times out
      // 30s later reporting an element it had already found. Only showed up
      // when the suite ran four Electron instances at once.
      await window.reload({ waitUntil: 'domcontentloaded' });
      await window.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
      // Verses back in the DOM is the condition the 2.5s sleep approximated.
      await window.waitForSelector('[data-testid^="verse-"]', { timeout: 30000 });
      await setDisplayMode(window, scenario.mode);
      if (scenario.interlinear) {
        await enableInterlinear(window);
      }
      await settle(window.locator('.word.highlighted'));

      const afterReload = await getHighlightInfo(window);
      console.log(`[DIAG ${mode}] after reload: ${JSON.stringify(afterReload, null, 2)}`);
      await shot(window, `${mode}-7-after-reload`);

      expect(
        afterReload.highlightedCount,
        `[${mode}] highlight did not survive reload (${beforeReload} before, ` +
          `${afterReload.highlightedCount} after)`
      ).toBeGreaterThan(0);
      expect(isVisiblyPainted(afterReload.firstBackground)).toBe(true);
      expect(
        afterReload.underlinedCount,
        `[${mode}] underline did not survive reload`
      ).toBeGreaterThan(0);
    });
  }

  /**
   * Find-in-page resolves matches via
   * `verseContainer.querySelector('[data-word-index="N"]')`, so it was broken
   * in Study+interlinear for exactly the same reason highlighting was: no such
   * elements existed. Free regression coverage now that they do.
   */
  test('find-in-page marks words in study+interlinear', async ({ window }) => {
    test.slow();

    await setDisplayMode(window, 'study');
    const available = await enableInterlinear(window);
    test.skip(!available, 'Active Bible module ships no interlinear data');

    // Dispatch the command the Ctrl+F keybinding dispatches, rather than
    // pressing Ctrl+F: the minimized Electron window under test does not
    // reliably receive synthetic keyboard input, and the keybinding itself is
    // not what this test is about.
    await window.evaluate(() =>
      globalThis.dispatchEvent(new CustomEvent('command:search:openFindBar'))
    );
    const findInput = window.locator('[role="search"] input[type="text"]').first();
    await expect(findInput).toBeVisible({ timeout: 10000 });
    await findInput.fill('God');
    await settle(window.locator('.word.find-match'));
    await shot(window, 'find-interlinear');

    const matches = await window.locator('.word.find-match').count();
    expect(
      matches,
      'find-in-page produced no .word.find-match elements in study+interlinear'
    ).toBeGreaterThan(0);
  });

  /**
   * Right-click -> "Highlight/Underline" on a partial selection must highlight
   * only the selected words, not the whole verse.
   */
  test('context menu highlight respects the word selection [standard mode]', async ({
    window,
  }) => {
    test.slow();

    await setDisplayMode(window, 'standard');

    await window.evaluate(() => {
      document.querySelector('[data-testid="verse-16"]')?.scrollIntoView({ block: 'center' });
    });
    await nextFrames(window);

    const target = await window.evaluate(() => {
      const container = document.querySelector('[data-testid="verse-16"]');
      if (!container) return null;
      const words = Array.from(container.querySelectorAll('.word'));
      if (words.length < 8) return null;
      const a = words[1].getBoundingClientRect();
      const b = words[3].getBoundingClientRect();
      return {
        totalWords: words.length,
        x: a.left,
        y: a.top,
        width: b.right - a.left,
        height: a.height,
      };
    });

    expect(target, 'verse 16 has no .word spans to select').not.toBeNull();
    const t = target!;

    const y = t.y + t.height / 2;
    await window.mouse.move(t.x + 2, y);
    await window.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await window.mouse.move(t.x + 2 + ((t.width - 4) * i) / 10, y);
      await window.waitForTimeout(15);
    }
    await window.mouse.up();
    // Same reason as above: `expect(sel.isCollapsed).toBe(false)` below is the
    // check, so this must not pre-wait for a non-collapsed selection.
    await window.waitForTimeout(400);

    const sel = await getSelectionInfo(window);
    console.log(`[DIAG ctx] selection before right-click: ${JSON.stringify(sel)}`);
    expect(sel.isCollapsed).toBe(false);
    await shot(window, 'ctx-1-selection');

    // Right-click inside the selection
    await window.mouse.move(t.x + t.width / 2, y);
    await window.mouse.down({ button: 'right' });
    await window.mouse.up({ button: 'right' });
    await shot(window, 'ctx-2-menu');

    const highlightItem = window
      .locator('[data-testid="context-menu-highlight"], button:has-text("Highlight")')
      .first();
    await expect(highlightItem).toBeVisible({ timeout: 15000 });
    await highlightItem.click({ force: true });
    await shot(window, 'ctx-3-color-menu');

    // What survived the click on the menu item? If mousedown collapsed the
    // selection, BiblePaneOverlays falls through to "highlight entire verse".
    const selAfterMenuClick = await getSelectionInfo(window);
    console.log(`[DIAG ctx] selection after menu-item click: ${JSON.stringify(selAfterMenuClick)}`);

    // Pick yellow from the highlight menu (role=dialog + .highlight-yellow swatch)
    const yellow = window.locator('[role="dialog"] button.highlight-yellow').first();
    await expect(yellow).toBeVisible({ timeout: 15000 });
    await yellow.click({ force: true });
    await settle(window.locator('.word.highlighted'));
    await shot(window, 'ctx-4-result');

    const info = await getHighlightInfo(window);
    console.log(`[DIAG ctx] result: ${JSON.stringify(info, null, 2)}`);

    expect(info.highlightedCount).toBeGreaterThan(0);
    // The whole point: a 3-word selection must NOT highlight the entire verse.
    expect(
      info.highlightedCount,
      `context-menu highlight covered ${info.highlightedCount} of ${t.totalWords} words — ` +
        `the partial selection was lost and the whole verse was highlighted`
    ).toBeLessThan(t.totalWords);
  });
});
