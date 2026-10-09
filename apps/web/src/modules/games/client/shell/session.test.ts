// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession, RoomSession } from './session.js';
import {
  OWNER_SESSION_CUTOFF_MS,
  clearOwnerSession,
  clearSession,
  lastOwnedRoom,
  lastRoom,
  loadOwnerSession,
  loadSession,
  rememberedName,
  saveOwnerSession,
  saveSession,
  touchOwnerSession,
} from './session.js';

const SESSION: RoomSession = { code: 'QK7P', playerId: 'p-1', token: 't-abc', name: 'Miriam' };
const OWNER_SESSION: OwnerSession = { code: 'QK7P', ownerToken: 'o-abc', displayToken: 'd-abc' };

let restore: (() => void) | null = null;

/**
 * A window that refuses storage: private mode, blocked cookies, some embedded
 * webviews. Reading the property is what throws, not just get and set.
 */
function refuseStorage(): void {
  const own = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('storage is disabled in this context');
    },
  });
  restore = () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    if (own) Object.defineProperty(globalThis, 'localStorage', own);
  };
}

/** A window with storage that is out of room: reads work, writes throw. */
function fillStorage(): void {
  const own = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded');
    },
    removeItem: () => undefined,
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => full });
  restore = () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    if (own) Object.defineProperty(globalThis, 'localStorage', own);
  };
}

describe('room sessions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('gives back the identity that was stored for a room', () => {
    saveSession(SESSION);
    expect(loadSession('QK7P')).toEqual(SESSION);
  });

  it('has nothing for a room this device never joined', () => {
    saveSession(SESSION);
    expect(loadSession('ZZZZ')).toBeNull();
  });

  it('rejoins as the same player after a reload', async () => {
    saveSession(SESSION);

    // A reload is a fresh module on top of the same storage.
    vi.resetModules();
    const reloaded = await import('./session.js');

    expect(reloaded.loadSession('QK7P')?.token).toBe('t-abc');
    expect(reloaded.loadSession('QK7P')?.playerId).toBe('p-1');
    expect(reloaded.lastRoom()).toBe('QK7P');
    expect(reloaded.rememberedName()).toBe('Miriam');
  });

  it('forgets the room when the player leaves it', () => {
    saveSession(SESSION);
    clearSession('QK7P');

    expect(loadSession('QK7P')).toBeNull();
    expect(lastRoom()).toBeNull();
  });

  it('keeps the name after the room is forgotten', () => {
    saveSession(SESSION);
    clearSession('QK7P');

    expect(rememberedName()).toBe('Miriam');
  });

  it('ignores a value some other tab left half written', () => {
    localStorage.setItem('bible-games:session:QK7P', '{"playerId": "p-1"');

    expect(loadSession('QK7P')).toBeNull();
  });

  it('ignores a stored value that is missing a token', () => {
    localStorage.setItem('bible-games:session:QK7P', JSON.stringify({ playerId: 'p-1' }));

    expect(loadSession('QK7P')).toBeNull();
  });

  it('plays on when the browser refuses storage altogether', () => {
    refuseStorage();

    expect(() => saveSession(SESSION)).not.toThrow();
    expect(loadSession('QK7P')).toBeNull();
    expect(lastRoom()).toBeNull();
    expect(rememberedName()).toBe('');
    expect(() => clearSession('QK7P')).not.toThrow();
  });

  it('plays on when there is no room left to store anything', () => {
    fillStorage();

    expect(() => saveSession(SESSION)).not.toThrow();
    expect(loadSession('QK7P')).toBeNull();
  });
});

describe('owner sessions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    restore?.();
    restore = null;
    vi.useRealTimers();
  });

  it('gives back a session just saved', () => {
    saveOwnerSession(OWNER_SESSION);
    expect(loadOwnerSession('QK7P')).toEqual(OWNER_SESSION);
    expect(lastOwnedRoom()).toBe('QK7P');
  });

  it('is still there right up to the cutoff', () => {
    saveOwnerSession(OWNER_SESSION);
    vi.setSystemTime(OWNER_SESSION_CUTOFF_MS);
    expect(loadOwnerSession('QK7P')).toEqual(OWNER_SESSION);
  });

  it('goes stale once the cutoff has passed with nothing touching it', () => {
    saveOwnerSession(OWNER_SESSION);
    vi.setSystemTime(OWNER_SESSION_CUTOFF_MS + 1);
    expect(loadOwnerSession('QK7P')).toBeNull();
  });

  it('never goes stale while something keeps touching it, however long that spans', () => {
    saveOwnerSession(OWNER_SESSION);
    // Touched every hour for two full days — well past the cutoff measured
    // from creation, but never once past it measured from the last touch.
    for (let hour = 1; hour <= 48; hour += 1) {
      vi.setSystemTime(hour * 60 * 60 * 1000);
      touchOwnerSession('QK7P');
    }
    expect(loadOwnerSession('QK7P')).toEqual(OWNER_SESSION);
  });

  it('treats a session saved before touchedAt existed as freshly touched, not stale', () => {
    localStorage.setItem(
      'bible-games:owner:QK7P',
      JSON.stringify({ ownerToken: 'o-abc', displayToken: 'd-abc' })
    );
    expect(loadOwnerSession('QK7P')).toEqual(OWNER_SESSION);
  });

  it('does nothing when asked to touch a session that was never saved', () => {
    expect(() => touchOwnerSession('ZZZZ')).not.toThrow();
    expect(loadOwnerSession('ZZZZ')).toBeNull();
  });

  it('forgets the room when the host closes it', () => {
    saveOwnerSession(OWNER_SESSION);
    clearOwnerSession('QK7P');

    expect(loadOwnerSession('QK7P')).toBeNull();
    expect(lastOwnedRoom()).toBeNull();
  });

  it('plays on when the browser refuses storage altogether', () => {
    refuseStorage();

    expect(() => saveOwnerSession(OWNER_SESSION)).not.toThrow();
    expect(loadOwnerSession('QK7P')).toBeNull();
    expect(() => touchOwnerSession('QK7P')).not.toThrow();
  });
});
