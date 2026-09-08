/**
 * The rule deciding whether a group may be collapsed, isolated from dockview.
 *
 * The live behaviour (a group actually going to zero width, surviving a session
 * round-trip, and losing to a preset applied afterwards) is covered against a
 * real dockview in `services/__tests__/layoutPresetIntegration.test.ts`. What is
 * worth pinning down here is the boundary: collapsing must never be able to
 * empty the workbench.
 */
import { describe, it, expect } from 'vitest';
import { canCollapseGroup } from './useLayoutStore';

describe('canCollapseGroup', () => {
  it('allows collapsing while another group stays visible', () => {
    expect(canCollapseGroup(['a', 'b'], [], 'a')).toBe(true);
    expect(canCollapseGroup(['a', 'b', 'c'], ['c'], 'a')).toBe(true);
  });

  it('refuses to collapse the last visible group', () => {
    expect(canCollapseGroup(['a', 'b'], ['b'], 'a')).toBe(false);
    expect(canCollapseGroup(['a', 'b', 'c'], ['b', 'c'], 'a')).toBe(false);
  });

  it('refuses when there is only one group at all', () => {
    expect(canCollapseGroup(['a'], [], 'a')).toBe(false);
  });

  it('refuses a group that is already collapsed', () => {
    expect(canCollapseGroup(['a', 'b', 'c'], ['a'], 'a')).toBe(false);
  });

  it('refuses a group the workbench does not have', () => {
    // A stale id from a disposed group - dockview would silently do nothing.
    expect(canCollapseGroup(['a', 'b'], [], 'gone')).toBe(false);
  });

  it('ignores collapsed ids that no longer name a live group', () => {
    // Leftovers from a previous workbench must not count towards "how much is
    // still visible", or a stale entry could block a legitimate collapse.
    expect(canCollapseGroup(['a', 'b'], ['stale'], 'a')).toBe(true);
  });
});
