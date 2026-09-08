/**
 * Tab strip header-actions alignment guard.
 *
 * dockview wraps a React `rightHeaderActionsComponent` in its own
 * `div.dv-react-part`, and never gives that div any CSS - so it defaults to
 * `display: block`. Every control in DockviewHeaderActions positions itself
 * with `align-self: stretch` (the tab strip has no fixed height, so `height:
 * 100%` has nothing to resolve against). `align-self` only affects a FLEX
 * item, so inside that block wrapper it was silently inert: the component root
 * collapsed to its ~18px content height and the "+" button and scroll chevrons
 * rendered flush against the TOP of the ~40px strip rather than centred in it.
 *
 * The fix is a rule in dockview-overrides.css making that wrapper a flex
 * container. It is the kind of thing that regresses the moment someone
 * refactors the overrides file, and it is invisible to every other test -
 * nothing throws, the button still works, it just sits in the wrong place.
 *
 * Measured, not eyeballed: assert the button actually fills the strip and that
 * its glyph is optically centred in both axes.
 */
import { test, expect } from '../fixtures/electron.fixture';

/** Sub-pixel slack for font metrics and fractional container heights. */
const CENTRE_TOLERANCE_PX = 1.5;

test.describe('tab strip header actions', () => {
  test('the "+" button fills the tab strip and centres its glyph', async ({ window }) => {
    await window.waitForSelector('[data-tour-anchor="add-pane"]', { timeout: 30000 });

    const geometry = await window.evaluate(() => {
      const btn = globalThis.document.querySelector<HTMLElement>('[data-tour-anchor="add-pane"]');
      const strip = btn?.closest('.dv-tabs-and-actions-container');
      if (!btn || !strip) return null;

      const b = btn.getBoundingClientRect();
      const s = strip.getBoundingClientRect();

      // The glyph's own painted box, not the button's.
      const range = globalThis.document.createRange();
      range.selectNodeContents(btn);
      const g = range.getBoundingClientRect();

      return {
        buttonHeight: b.height,
        stripHeight: s.height,
        offsetY: (g.y + g.height / 2) - (b.y + b.height / 2),
        offsetX: (g.x + g.width / 2) - (b.x + b.width / 2),
      };
    });

    expect(geometry).not.toBeNull();
    const { buttonHeight, stripHeight, offsetX, offsetY } = geometry!;

    // The strip is a real band, not a collapsed line - guards the guard.
    expect(stripHeight).toBeGreaterThan(20);

    // The button stretches to the strip. Before the fix this was ~18 vs ~40.
    expect(buttonHeight).toBeCloseTo(stripHeight, 0);

    // And the "+" sits in the middle of it.
    expect(Math.abs(offsetY)).toBeLessThan(CENTRE_TOLERANCE_PX);
    expect(Math.abs(offsetX)).toBeLessThan(CENTRE_TOLERANCE_PX);
  });
});
