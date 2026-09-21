/**
 * An extension panel's declared pop-out size has to survive the trip from
 * `ui.registerPanelType` to the `window:detach-pane` payload.
 *
 * Nothing on that path enumerates the definition's fields - the main-process
 * bridge forwards the whole def to the renderer, and the store keeps the whole
 * def - which is exactly why the field can be added without touching either.
 * That is also why it needs pinning: the moment some layer starts copying
 * named fields instead, the size disappears with no error and every extension
 * panel quietly reverts to 900x700.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { declaredPanelWindowSize } from './panelWindowSize';
import { useExtensionUiStore } from './extensionUiStore';

/** A def as an extension would register it, plus the size field. */
function defWithSize(size: unknown): Record<string, unknown> {
  return {
    id: 'session',
    title: 'Memory Session',
    uiEntry: 'panel.html',
    defaultWindowSize: size,
  };
}

describe('declaredPanelWindowSize', () => {
  it('reads a declared size off the panel type definition', () => {
    expect(declaredPanelWindowSize(defWithSize({ width: 480, height: 900 }))).toEqual({
      width: 480,
      height: 900,
    });
  });

  it('returns undefined when the panel declared nothing', () => {
    // Distinguishable from a declared 900x700 on purpose: the main process
    // substitutes the pane defaults and should not have to guess whether it is
    // looking at a real preference.
    expect(
      declaredPanelWindowSize({ id: 'session', title: 'x', uiEntry: 'panel.html' }),
    ).toBeUndefined();
  });

  it('returns undefined for a definition that is missing or not an object', () => {
    // The lookup misses whenever the extension has been deactivated since the
    // panel was opened; `undefined` there must mean "no preference", not throw.
    for (const bad of [undefined, null, 'nope', 7]) {
      expect(declaredPanelWindowSize(bad)).toBeUndefined();
    }
  });

  it('drops non-numeric dimensions instead of forwarding them', () => {
    expect(declaredPanelWindowSize(defWithSize({ width: '480', height: NaN }))).toBeUndefined();
    expect(declaredPanelWindowSize(defWithSize({ width: Infinity }))).toBeUndefined();
    expect(declaredPanelWindowSize(defWithSize(null))).toBeUndefined();
    expect(declaredPanelWindowSize(defWithSize({}))).toBeUndefined();
  });

  it('carries a partial declaration through', () => {
    // Width-only is a real case: a narrow side panel that is happy with
    // whatever height the host picks.
    expect(declaredPanelWindowSize(defWithSize({ width: 420 }))).toEqual({ width: 420 });
    expect(declaredPanelWindowSize(defWithSize({ height: 420 }))).toEqual({ height: 420 });
  });

  it('does NOT clamp - that is the main process\'s job', () => {
    // Deliberate: the renderer is not the trust boundary. If this ever starts
    // clamping, `resolveDetachedWindowSize` must stay the authority anyway,
    // because anything reaching the IPC channel bypasses this module entirely.
    expect(declaredPanelWindowSize(defWithSize({ width: 30000, height: 1 }))).toEqual({
      width: 30000,
      height: 1,
    });
  });
});

describe('the store round-trip', () => {
  beforeEach(() => {
    useExtensionUiStore.setState({ panelTypes: [] });
  });

  it('keeps the declared size on the def the pop-out path reads', () => {
    // `addPanelType` is what `extensionRendererBridge` calls with the def the
    // main-process bridge forwarded. DockviewTabRenderer then finds the entry
    // by (extensionId, panelTypeId) and reads its `def`.
    useExtensionUiStore
      .getState()
      .addPanelType(
        'ext.bible-app.memory',
        defWithSize({ width: 520, height: 840 }) as never,
      );

    const registered = useExtensionUiStore
      .getState()
      .panelTypes.find(
        (p) => p.extensionId === 'ext.bible-app.memory' && p.panelTypeId === 'session',
      );

    expect(registered).toBeDefined();
    expect(declaredPanelWindowSize(registered?.def)).toEqual({ width: 520, height: 840 });
  });

  it('yields no preference for a panel type that was never registered', () => {
    const registered = useExtensionUiStore
      .getState()
      .panelTypes.find((p) => p.panelTypeId === 'gone');

    expect(declaredPanelWindowSize(registered?.def)).toBeUndefined();
  });
});
