import { describe, expect, it } from 'vitest';
import { isNewer, renderEquivalent } from '../frames';
import type { PresentState } from '../../protocol';

function stateAt(version: number): PresentState {
  return {
    version,
    live: null,
    position: { index: 0, highlight: null },
    display: { fontStep: 5, blanked: false, theme: 'dark' },
    session: { id: 'SESSION000000000', joinCode: 'ABCD2345', joinsLocked: false, viewerCount: 0 },
  };
}

describe('isNewer', () => {
  it('accepts anything when nothing has been received yet', () => {
    expect(isNewer(null, { origin: 'local', state: stateAt(0) })).toBe(true);
    expect(isNewer(null, { origin: 'network', state: stateAt(0) })).toBe(true);
  });

  it('accepts a strictly newer version regardless of origin', () => {
    expect(isNewer(stateAt(3), { origin: 'local', state: stateAt(4) })).toBe(true);
    expect(isNewer(stateAt(3), { origin: 'network', state: stateAt(4) })).toBe(true);
  });

  it('drops anything not newer than what is already held', () => {
    expect(isNewer(stateAt(4), { origin: 'network', state: stateAt(3) })).toBe(false);
    expect(isNewer(stateAt(4), { origin: 'local', state: stateAt(3) })).toBe(false);
  });

  it('lets a network frame win a tie against a local one', () => {
    // The case that matters most: a controller predicted version 5 locally,
    // and the server's real answer to the same change also lands on 5.
    expect(isNewer(stateAt(5), { origin: 'network', state: stateAt(5) })).toBe(true);
  });

  it('never lets a local frame displace one already held at the same version', () => {
    // Whether the one already held came from the network or was itself a
    // local guess, a second local frame at the same version adds nothing.
    expect(isNewer(stateAt(5), { origin: 'local', state: stateAt(5) })).toBe(false);
  });
});

describe('renderEquivalent', () => {
  it('is true for two states with the same version, item, position and display', () => {
    expect(renderEquivalent(stateAt(5), stateAt(5))).toBe(true);
  });

  it('ignores viewerCount, which no viewer displays', () => {
    const withViewers: PresentState = { ...stateAt(5), session: { ...stateAt(5).session, viewerCount: 3 } };
    expect(renderEquivalent(stateAt(5), withViewers)).toBe(true);
  });

  it('is false when the version differs', () => {
    expect(renderEquivalent(stateAt(5), stateAt(6))).toBe(false);
  });

  it('is false when what is live, the position or the display actually differs', () => {
    const rethemed: PresentState = { ...stateAt(5), display: { ...stateAt(5).display, theme: 'light' } };
    expect(renderEquivalent(stateAt(5), rethemed)).toBe(false);

    const repositioned: PresentState = { ...stateAt(5), position: { index: 1, highlight: null } };
    expect(renderEquivalent(stateAt(5), repositioned)).toBe(false);
  });
});
