import { describe, it, expect } from 'vitest';

import { UserGestureTracker, USER_GESTURE_WINDOW_MS } from '../UserGestureTracker';

describe('UserGestureTracker', () => {
  it('has no gesture until granted', () => {
    expect(new UserGestureTracker().hasRecent('ext.a.b')).toBe(false);
  });

  it('counts a gesture for 5 s and not after', () => {
    let now = 1000;
    const t = new UserGestureTracker(() => now);
    t.grant('ext.a.b');
    now += USER_GESTURE_WINDOW_MS;
    expect(t.hasRecent('ext.a.b')).toBe(true);
    now += 1;
    expect(t.hasRecent('ext.a.b')).toBe(false);
  });

  it('is per extension and honours a custom window', () => {
    let now = 0;
    const t = new UserGestureTracker(() => now);
    t.grant('ext.a.b');
    expect(t.hasRecent('ext.c.d')).toBe(false);
    now = 300;
    expect(t.hasRecent('ext.a.b', 200)).toBe(false);
    expect(t.hasRecent('ext.a.b', 400)).toBe(true);
  });

  it('a fresh grant restarts the window; forget clears it', () => {
    let now = 0;
    const t = new UserGestureTracker(() => now);
    t.grant('ext.a.b');
    now = 4000;
    t.grant('ext.a.b');
    now = 8000;
    expect(t.hasRecent('ext.a.b')).toBe(true);
    t.forget('ext.a.b');
    expect(t.hasRecent('ext.a.b')).toBe(false);
  });
});
