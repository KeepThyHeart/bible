/**
 * Shared helpers for the highlight/underline E2E specs.
 *
 * Extracted from `e2e/tests/highlight-diagnosis.spec.ts`, which had the only
 * honest highlight coverage in the suite. `highlights.spec.ts` needed the same
 * gestures and the same computed-style probes to stop being a set of guarded
 * no-ops, and duplicating a 100-line drag helper into it would have guaranteed
 * the two drifted.
 *
 * The probes deliberately read COMPUTED style rather than class names: a class
 * can be applied while no CSS rule matches it, which paints nothing and looks
 * exactly like "highlighting doesn't work".
 */
import { expect, Page } from '@playwright/test';

/**
 * Display-mode switches re-render the whole chapter, and the suite runs four
 * Electron instances at once. 20s was not enough under that contention - the
 * "[study mode]" and "study+interlinear" cases failed intermittently and passed
 * whenever the file was run on its own.
 */
export const MODE_SWITCH_TIMEOUT = 40000;

/** Switch the Bible pane's display mode and wait for the re-render. */
export async function setDisplayMode(window: Page, mode: 'standard' | 'reading' | 'study'): Promise<void> {
  const modeSelect = window.locator('[data-testid="display-mode-select"]');
  await expect(modeSelect).toBeVisible();
  // force: true - the Electron window under test is minimized, which
  // intermittently fails Playwright's "visible and enabled" actionability
  // check even though the element is perfectly interactable. Same reason
  // e2e/tests/interlinear.spec.ts forces this exact selectOption.
  await modeSelect.selectOption(mode, { force: true, timeout: MODE_SWITCH_TIMEOUT });
  // Explicit timeout: switching mode re-renders the whole chapter, which under
  // four parallel Electron instances routinely outruns the default 5s assertion
  // timeout. That was the cause of the intermittent "[study mode]" failures
  // that only ever appeared when the file ran alongside others.
  await expect(modeSelect).toHaveValue(mode, { timeout: MODE_SWITCH_TIMEOUT });
  // The select changing is not the same as the pane having re-rendered in the
  // new mode; verses being back in the DOM is, and it is what the 800ms sleep
  // this replaces was waiting for.
  await expect(window.locator('[data-testid^="verse-"]').first())
    .toBeAttached({ timeout: MODE_SWITCH_TIMEOUT });
}

/**
 * Turn the interlinear view on and prove it actually rendered.
 *
 * `setDisplayMode` does NOT set `showInterlinear` - only creating a tab in
 * Study mode does - so without this the "study" case silently exercises the
 * plain-text path and an interlinear regression goes unnoticed.
 *
 * Returns false when the active module ships no interlinear data, in which case
 * there is nothing to test rather than something failing.
 */
export async function enableInterlinear(window: Page): Promise<boolean> {
  await window.waitForSelector('[data-testid="study-controls"]', { timeout: MODE_SWITCH_TIMEOUT });

  const toggle = window.locator('[data-testid="interlinear-checkbox"]');
  if ((await toggle.count()) === 0) return false;

  if (!(await toggle.isChecked())) {
    await toggle.check({ force: true });
  }
  await expect(toggle).toBeChecked();

  // Assert the view really switched. Without this the test degrades to the
  // plain path - exactly the vacuity trap this spec exists to avoid.
  await window.waitForSelector('[data-testid="strongs-number"]', { timeout: MODE_SWITCH_TIMEOUT });
  await expect(window.locator('[data-testid="interlinear-word"]').first()).toBeVisible();
  return true;
}

/**
 * Drag the mouse across a horizontal strip of an element with intermediate
 * steps. A single jump frequently fails to produce a DOM Selection in Chromium.
 */
export async function dragAcross(
  window: Page,
  box: { x: number; y: number; width: number; height: number },
  fromFrac = 0.05,
  toFrac = 0.45
): Promise<void> {
  // Aim at the FIRST text line: a multi-line paragraph's vertical centre can
  // land between lines, where there is nothing to select.
  const y = box.y + Math.min(box.height, 24) / 2;
  const x1 = box.x + box.width * fromFrac;
  const x2 = box.x + box.width * toFrac;

  await window.mouse.move(x1, y);
  await window.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await window.mouse.move(x1 + ((x2 - x1) * i) / steps, y);
    await window.waitForTimeout(15);
  }
  await window.mouse.up();
  // `useBibleSelection` defers `showFloatingToolbar` by 50ms after mouseup.
  // Kept as a sleep rather than a wait on the toolbar: callers of this helper
  // assert on whether the toolbar appeared, and pre-waiting for it would turn
  // an informative failure into a bare timeout.
  await window.waitForTimeout(500);
}

/** The current DOM text selection, as the renderer sees it. */
export async function getSelectionInfo(window: Page) {
  return window.evaluate(() => {
    const sel = globalThis.getSelection();
    return {
      text: sel ? sel.toString() : '',
      isCollapsed: sel ? sel.isCollapsed : true,
      rangeCount: sel ? sel.rangeCount : 0,
    };
  });
}

/**
 * Everything we need to know about what actually got painted:
 * how many .word spans exist, how many carry a highlight class, and the
 * computed background-color of the first highlighted one.
 */
export async function getHighlightInfo(window: Page) {
  return window.evaluate(() => {
    const words = Array.from(document.querySelectorAll('.word'));
    const highlighted = Array.from(document.querySelectorAll('.word.highlighted'));
    const first = highlighted[0] as HTMLElement | undefined;

    // Underline is probed by COMPUTED decoration, never by class name: a class
    // can be applied while no rule matches, which renders nothing and looks
    // exactly like "underlining doesn't work".
    const underlined = words.find((el) => {
      const style = getComputedStyle(el as HTMLElement);
      return style.textDecorationLine.includes('underline');
    }) as HTMLElement | undefined;
    const underlineStyle = underlined ? getComputedStyle(underlined) : null;

    return {
      wordSpanCount: words.length,
      highlightedCount: highlighted.length,
      firstClasses: first ? first.className : null,
      firstText: first ? first.textContent : null,
      firstBackground: first ? getComputedStyle(first).backgroundColor : null,
      firstInlineStyle: first ? first.getAttribute('style') : null,
      markupIds: highlighted
        .map((el) => (el as HTMLElement).getAttribute('data-markup-id'))
        .filter(Boolean),
      underlinedCount: words.filter((el) =>
        getComputedStyle(el as HTMLElement).textDecorationLine.includes('underline')
      ).length,
      underlineClasses: underlined ? underlined.className : null,
      underlineText: underlined ? underlined.textContent : null,
      underlineLine: underlineStyle ? underlineStyle.textDecorationLine : null,
      underlineStyleName: underlineStyle ? underlineStyle.textDecorationStyle : null,
      underlineColor: underlineStyle ? underlineStyle.textDecorationColor : null,
      underlineTextColor: underlineStyle ? underlineStyle.color : null,
    };
  });
}

/** Parse an rgb()/rgba() string and report whether it actually paints anything. */
export function isVisiblyPainted(color: string | null): boolean {
  if (!color) return false;
  if (color === 'transparent') return false;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return false;
  const parts = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
  const alpha = parts.length >= 4 ? parts[3] : 1;
  return alpha > 0.01;
}
