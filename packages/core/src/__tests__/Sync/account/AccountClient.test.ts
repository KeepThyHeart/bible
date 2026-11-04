/** AccountClient (contracts 0063 §9, W3-B) against an in-test server model; every request body is scanned for secrets. */
import { describe, expect, it, vi } from 'vitest';
import {
  b64urlEncode, deterministicRandom, hexEncode, hkdfSha256, utf8Encode,
} from '../../../Crypto';
import type { KdfParams } from '../../../Crypto';
import {
  AccountClient, AccountError, UNSEALED_DEVICE_NAME, WeakPasswordError, loadSyncToken,
} from '../../../Sync/account/AccountClient';
import type { AccountClientDeps } from '../../../Sync/account/AccountClient';
import { openDeviceName } from '../../../Sync/crypto/keys';
import type { UnlockedAccount } from '../../../Sync/crypto/keys';
import { LABELS } from '../../../Sync/crypto/labels';
import { MemorySecretStore, serializeUnlocked } from '../../../Sync/engine/ISecretStore';
import type { SyncStatus, SyncStatusStore } from '../../../Sync/engine/SyncStatus';
import { FLOOR } from '../crypto/fixtures';
import { FakeServer } from './fakeServer';

const EMAIL = 'alice.reader@example.org';
const PW = 'Velvet-otter-lantern-93 quietly';
const PW2 = 'Granite parsnip orbit 7 cascade';
const PW3 = 'Mossy-violin harbour 41 tundra';
const CONSENT = { terms: true, ageConfirmed: true } as const;

function statusStore(): SyncStatusStore {
  let s: SyncStatus = { state: 'signed-out', pending: 0, opaque: 0 };
  const ls = new Set<() => void>();
  return {
    getSnapshot: () => s,
    subscribe: (l) => { ls.add(l); return () => ls.delete(l); },
    set: (p) => { s = { ...s, ...p }; ls.forEach((l) => l()); },
  };
}

/** Everything that must never reach the server, in raw byte or string form. */
class Secrets {
  readonly bytes: Uint8Array[] = [];
  readonly strings: string[] = [];
  addUnlocked(u: UnlockedAccount | null): void {
    if (!u) return;
    this.bytes.push(u.accountKey.slice(), u.recordIdKey.slice(), ...[...u.dataKeys.values()].map((k) => k.slice()));
  }
}

/** Fast stand-in for Argon2id (HKDF of the password under the salt) that records each call and its KEK. */
function fakeKdf(secrets: Secrets) {
  return vi.fn(async (password: string, params: KdfParams): Promise<Uint8Array> => {
    const master = await hkdfSha256(utf8Encode(password), params.salt, 'test-argon2-stand-in', 32);
    secrets.bytes.push(await hkdfSha256(master, new Uint8Array(0), LABELS.kek, 32));   // the KEK
    secrets.bytes.push(master.slice());
    return master;
  });
}

const std64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

function assertNoSecrets(server: FakeServer, secrets: Secrets): void {
  expect(server.bodies.length).toBeGreaterThan(0);
  const walk = (v: unknown): void => {
    expect(ArrayBuffer.isView(v) || v instanceof ArrayBuffer).toBe(false);
    if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  for (const { route, json, raw } of server.bodies) {
    walk(raw);
    for (const s of secrets.strings) {
      expect(json.includes(s), `${route} leaks a password/code`).toBe(false);
      expect(json.toLowerCase().includes(s.toLowerCase().replace(/-/g, '')), `${route} leaks a code`).toBe(false);
    }
    for (const b of secrets.bytes) {
      for (const enc of [b64urlEncode(b), std64(b).replace(/=+$/, ''), hexEncode(b), latin1(b)]) {
        expect(json.includes(enc), `${route} leaks key bytes`).toBe(false);
      }
    }
  }
}

function setup(over: Partial<AccountClientDeps> = {}, server = new FakeServer(), secrets = new Secrets()) {
  const store = new MemorySecretStore();
  const status = statusStore();
  const kdf = fakeKdf(secrets);
  const deps: AccountClientDeps = {
    api: server.api(), secrets: store, status, kdf, deviceId: '0123456789abcdef', deviceName: () => 'Test laptop',
    random: deterministicRandom(1), kdfCost: FLOOR, ...over,
  };
  const client = new AccountClient(deps);
  return { client, server, secrets, store, status, kdf, deps };
}

/** A second device on the same server. */
function device2(server: FakeServer, secrets: Secrets, over: Partial<AccountClientDeps> = {}) {
  return setup({ deviceId: 'fedcba9876543210', random: deterministicRandom(201), ...over }, server, secrets);
}

async function signedUp(over: Partial<AccountClientDeps> = {}) {
  const t = setup(over);
  t.secrets.strings.push(PW, PW2, PW3);
  const { recoveryCode } = await t.client.signUp(EMAIL, PW, CONSENT);
  t.secrets.strings.push(recoveryCode);
  t.secrets.addUnlocked(t.client.unlocked);
  return { ...t, recoveryCode };
}

describe('signUp', () => {
  it('sends only wrapped keys, stores the unlocked account, sets status, seals the device name', async () => {
    const onUnlocked = vi.fn();
    const t = await signedUp({ onUnlocked });
    const u = t.client.unlocked!;
    expect(u).not.toBeNull();
    expect(t.status.getSnapshot()).toMatchObject({ state: 'idle', accountEmail: EMAIL });
    expect(await t.store.get('sync.unlocked')).toEqual(serializeUnlocked(u));
    expect(onUnlocked).toHaveBeenCalledWith(u);
    const a = t.server.accounts.get(EMAIL)!;
    expect(await openDeviceName(u, '0123456789abcdef', a.devices.get('0123456789abcdef')!)).toBe('Test laptop');
    expect(t.recoveryCode).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    assertNoSecrets(t.server, t.secrets);
  });

  it('rejects a weak password before Argon2 and before any request', async () => {
    const t = setup();
    const err = await t.client.signUp(EMAIL, 'password1', CONSENT).catch((e) => e);
    expect(err).toBeInstanceOf(WeakPasswordError);
    expect(err.score).toBeLessThan(3);
    expect(err.feedback.length).toBeGreaterThan(0);
    expect(t.kdf).not.toHaveBeenCalled();
    expect(t.server.bodies).toHaveLength(0);
    // Email parts count as weak material too.
    await expect(t.client.signUp(EMAIL, 'alicereader2024', CONSENT)).rejects.toBeInstanceOf(WeakPasswordError);
    expect(t.kdf).not.toHaveBeenCalled();
  });

  it('honours minStrength', async () => {
    const t = setup({ minStrength: 0 });
    await expect(t.client.signUp(EMAIL, 'password1', CONSENT)).resolves.toHaveProperty('recoveryCode');
  });

  it('a taken address looks like success locally; the owner keeps their account', async () => {
    const t = await signedUp();
    const before = { ...t.server.accounts.get(EMAIL)! };
    const other = device2(t.server, t.secrets);
    await expect(other.client.signUp(EMAIL, PW2, CONSENT)).resolves.toHaveProperty('recoveryCode');
    expect(other.status.getSnapshot().state).toBe('idle');
    expect(t.server.accounts.get(EMAIL)!.authKey).toBe(before.authKey);
    // The impostor holds no session: its first authenticated call fails.
    await expect(other.deps.api.account()).rejects.toMatchObject({ status: 401 });
  });
});

describe('signIn', () => {
  it('signs in on a second device and unlocks the same keys', async () => {
    const t = await signedUp();
    const d2 = device2(t.server, t.secrets);
    await d2.client.signIn(EMAIL, PW);
    const u = d2.client.unlocked!;
    expect(hexEncode(u.accountKey)).toBe(hexEncode(t.client.unlocked!.accountKey));
    expect(d2.status.getSnapshot()).toMatchObject({ state: 'idle', accountEmail: EMAIL });
    expect(t.server.accounts.get(EMAIL)!.devices.get('fedcba9876543210')).toBe(UNSEALED_DEVICE_NAME);
    assertNoSecrets(t.server, t.secrets);
  });

  it('wrong password -> typed auth error, nothing stored', async () => {
    const t = await signedUp();
    const d2 = device2(t.server, t.secrets);
    const err = await d2.client.signIn(EMAIL, PW2).catch((e) => e);
    expect(err).toBeInstanceOf(AccountError);
    expect(err.code).toBe('invalid_credentials');
    expect(d2.client.unlocked).toBeNull();
    expect(await d2.store.get('sync.unlocked')).toBeNull();
    assertNoSecrets(t.server, t.secrets);
  });

  it('damaged wrapped keys -> damaged_keys with a fixed message', async () => {
    const t = await signedUp();
    const a = t.server.accounts.get(EMAIL)!;
    const w = a.wrappedAkPassword;
    a.wrappedAkPassword = w.slice(0, 20) + (w[20] === 'A' ? 'B' : 'A') + w.slice(21);
    const d2 = device2(t.server, t.secrets);
    const err = await d2.client.signIn(EMAIL, PW).catch((e) => e);
    expect(err).toMatchObject({ name: 'AccountError', code: 'damaged_keys', message: 'Wrong password or damaged keys' });
    expect(err.cause).toBeUndefined();
  });

  it('refuses server KDF params below the floor before Argon2', async () => {
    const t = await signedUp();
    t.server.accounts.get(EMAIL)!.kdf = { ...t.server.accounts.get(EMAIL)!.kdf, m: 1024, t: 1 };
    const d2 = device2(t.server, t.secrets);
    const err = await d2.client.signIn(EMAIL, PW).catch((e) => e);
    expect(err).toMatchObject({ code: 'unsafe_kdf' });
    expect(d2.kdf).not.toHaveBeenCalled();
    expect(t.server.bodies.filter((b) => b.route === 'login')).toHaveLength(0);
  });

  it('desktop: stores the bearer token, which later requests present', async () => {
    const server = new FakeServer();
    const store = new MemorySecretStore();
    const t = setup({ wantToken: true, secrets: store, api: server.api(() => loadSyncToken(store)) }, server);
    t.secrets.strings.push(PW);
    await t.client.signUp(EMAIL, PW, CONSENT);
    const token = await loadSyncToken(store);
    expect(token).toMatch(/^tok\d+$/);
    await expect(t.deps.api.account()).resolves.toMatchObject({ email: EMAIL });
    // The token never travels in a body.
    expect(t.server.bodies.some((b) => b.json.includes(token!))).toBe(false);
  });
});

describe('resume', () => {
  it('a remembered device resumes from the secret store without the server', async () => {
    const t = await signedUp();
    const onUnlocked = vi.fn();
    const n = t.server.bodies.length;
    const again = new AccountClient({ ...t.deps, status: statusStore(), onUnlocked });
    const u = await again.resume();
    expect(u && hexEncode(u.accountKey)).toBe(hexEncode(t.client.unlocked!.accountKey));
    expect(again.unlocked).toBe(u);
    expect(onUnlocked).toHaveBeenCalledWith(u);
    expect(t.server.bodies.length).toBe(n);
  });

  it('nothing stored -> null and locked', async () => {
    const t = setup();
    expect(await t.client.resume()).toBeNull();
    expect(t.status.getSnapshot().state).toBe('locked');
  });

  it('a damaged blob is deleted -> null and locked', async () => {
    const t = setup();
    await t.store.set('sync.unlocked', new Uint8Array([9, 9, 9]));
    await t.store.set('sync.token', utf8Encode('tok'));
    expect(await t.client.resume()).toBeNull();
    expect(t.status.getSnapshot().state).toBe('locked');
    expect(await t.store.get('sync.unlocked')).toBeNull();
    expect(await t.store.get('sync.token')).toBeNull();
  });

  it('R1 L11a: a store that throws on read (undecryptable value) -> secrets deleted, null and locked', async () => {
    const t = await signedUp();
    await t.store.set('sync.token', utf8Encode('tok'));
    const broken = Object.assign(Object.create(t.store) as MemorySecretStore, {
      get: async () => { throw new Error('cannot decrypt'); },
    });
    const del = vi.spyOn(t.store, 'delete');
    const again = new AccountClient({ ...t.deps, secrets: broken, status: t.status });
    expect(await again.resume()).toBeNull();
    expect(t.status.getSnapshot().state).toBe('locked');
    expect(del.mock.calls.map((c) => c[0]).sort()).toEqual(['sync.token', 'sync.unlocked']);
    expect(await t.store.get('sync.unlocked')).toBeNull();
    expect(again.unlocked).toBeNull();
  });
});

describe('key epoch rollback (R1 M4)', () => {
  it('a server naming an older epoch as current after a rotation is refused as damaged_keys', async () => {
    const t = await signedUp();
    await t.client.rotateKeys(PW);
    t.secrets.addUnlocked(t.client.unlocked);
    t.server.tamperSession = (res) => ({ ...res, currentEpoch: 0 });   // keysets {0,1}, current 0
    const d2 = device2(t.server, t.secrets);
    await expect(d2.client.signIn(EMAIL, PW)).rejects.toMatchObject({ code: 'damaged_keys' });
    expect(d2.client.unlocked).toBeNull();
    t.server.tamperSession = undefined;
    await d2.client.signIn(EMAIL, PW);
    expect(d2.client.unlocked!.currentEpoch).toBe(1);
  });

  it('after a resume that saw epoch 1, a login offering only epoch 0 fails as damaged_keys', async () => {
    const t = await signedUp();
    await t.client.rotateKeys(PW);
    t.secrets.addUnlocked(t.client.unlocked);
    const again = new AccountClient({ ...t.deps, status: statusStore() });
    const u = await again.resume();
    expect([...u!.dataKeys.keys()]).toEqual([0, 1]);
    // The server drops epoch 1 (the remaining epoch-0 wrap is genuine: rotation re-wrapped it under the new account key).
    t.server.tamperSession = (res) => ({ ...res, keysets: res.keysets.filter((k) => k.epoch === 0), currentEpoch: 0 });
    await expect(again.signIn(EMAIL, PW)).rejects.toMatchObject({ code: 'damaged_keys' });
    // The stored keys were not replaced by the rolled-back set.
    expect(await t.store.get('sync.unlocked')).toEqual(serializeUnlocked(u!));
    // A fresh client with the same store (no account in memory) refuses it too.
    const fresh = new AccountClient({ ...t.deps, status: statusStore() });
    await expect(fresh.signIn(EMAIL, PW)).rejects.toMatchObject({ code: 'damaged_keys' });
  });
});

describe('signOut and deleteAccount', () => {
  it('wipes secrets, logs out, and calls onWipe only when asked', async () => {
    const onWipe = vi.fn(async () => {});
    const onSignedOut = vi.fn();
    const t = await signedUp({ onWipe, onSignedOut });
    await t.client.signOut({ wipeLocal: false });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(onWipe).not.toHaveBeenCalled();
    expect(t.client.unlocked).toBeNull();
    expect(await t.store.get('sync.unlocked')).toBeNull();
    expect(t.status.getSnapshot().state).toBe('signed-out');
    expect(t.server.sessions.size).toBe(0);

    await t.client.signIn(EMAIL, PW);
    await t.client.signOut({ wipeLocal: true });
    expect(onWipe).toHaveBeenCalledTimes(1);
    expect(await t.store.get('sync.unlocked')).toBeNull();
    assertNoSecrets(t.server, t.secrets);
  });

  it('signs out locally even when the server is unreachable', async () => {
    const t = await signedUp();
    (t.deps.api as { logout: () => Promise<void> }).logout = async () => { throw new TypeError('fetch failed'); };
    await t.client.signOut({ wipeLocal: false });
    expect(t.client.unlocked).toBeNull();
    expect(t.status.getSnapshot().state).toBe('signed-out');
  });

  it('deleteAccount sends the auth key (not the password) and wipes', async () => {
    const onWipe = vi.fn(async () => {});
    const t = await signedUp({ onWipe });
    await expect(t.client.deleteAccount(PW2)).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(t.server.accounts.has(EMAIL)).toBe(true);
    await t.client.deleteAccount(PW);
    expect(t.server.accounts.has(EMAIL)).toBe(false);
    expect(onWipe).toHaveBeenCalledTimes(1);
    expect(await t.store.get('sync.unlocked')).toBeNull();
    assertNoSecrets(t.server, t.secrets);
  });
});

describe('password, recovery code and key changes', () => {
  it('changePassword verifies the current password and keeps the same account key', async () => {
    const t = await signedUp();
    await expect(t.client.changePassword(PW3, PW2, false)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(t.client.changePassword(PW, 'password1', false)).rejects.toBeInstanceOf(WeakPasswordError);
    await t.client.changePassword(PW, PW2, true);
    const d2 = device2(t.server, t.secrets);
    await expect(d2.client.signIn(EMAIL, PW)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await d2.client.signIn(EMAIL, PW2);
    expect(hexEncode(d2.client.unlocked!.accountKey)).toBe(hexEncode(t.client.unlocked!.accountKey));
    assertNoSecrets(t.server, t.secrets);
  });

  it('after resume, the email is fetched from the server for changePassword', async () => {
    const t = await signedUp();
    const again = new AccountClient({ ...t.deps, status: statusStore() });
    await again.resume();
    await again.changePassword(PW, PW2, false);
    expect(t.server.bodies.some((b) => b.route === 'account')).toBe(true);
  });

  it('flows that need keys refuse when signed out', async () => {
    const t = setup();
    await expect(t.client.changePassword(PW, PW2, false)).rejects.toMatchObject({ code: 'not_signed_in' });
    await expect(t.client.rotateKeys(PW)).rejects.toMatchObject({ code: 'not_signed_in' });
  });

  it('regenerateRecoveryCode replaces the old code', async () => {
    const t = await signedUp();
    const { recoveryCode } = await t.client.regenerateRecoveryCode(PW);
    t.secrets.strings.push(recoveryCode);
    expect(recoveryCode).not.toBe(t.recoveryCode);
    const d2 = device2(t.server, t.secrets);
    await expect(d2.client.signInWithRecoveryCode(EMAIL, t.recoveryCode, PW2)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await d2.client.signInWithRecoveryCode(EMAIL, recoveryCode, PW2);
    assertNoSecrets(t.server, t.secrets);
  });

  it('rotateKeys sets the re-encrypt flag, advances the epoch and persists the new keys', async () => {
    const onUnlocked = vi.fn();
    const t = await signedUp({ onUnlocked });
    const before = t.client.unlocked!;
    expect(t.client.needsReencrypt).toBe(false);
    const { recoveryCode } = await t.client.rotateKeys(PW);
    t.secrets.strings.push(recoveryCode);
    t.secrets.addUnlocked(t.client.unlocked);
    const after = t.client.unlocked!;
    expect(after.currentEpoch).toBe(before.currentEpoch + 1);
    expect(hexEncode(after.accountKey)).not.toBe(hexEncode(before.accountKey));
    expect(hexEncode(after.recordIdKey)).toBe(hexEncode(before.recordIdKey));
    expect(t.client.needsReencrypt).toBe(true);
    expect(await t.store.get('sync.unlocked')).toEqual(serializeUnlocked(after));
    expect(onUnlocked).toHaveBeenLastCalledWith(after);
    expect(t.client.consumeReencrypt()).toBe(true);
    expect(t.client.needsReencrypt).toBe(false);
    // Another device follows with the same password and gets both epochs.
    const d2 = device2(t.server, t.secrets);
    await d2.client.signIn(EMAIL, PW);
    expect([...d2.client.unlocked!.dataKeys.keys()]).toEqual([0, 1]);
    assertNoSecrets(t.server, t.secrets);
  });
});

describe('signInWithRecoveryCode (end to end against the server model)', () => {
  it('recover -> new password + new code in one PUT keys -> normal session; old code and password stop working', async () => {
    const t = await signedUp();
    const d2 = device2(t.server, t.secrets);
    // Lower case with spaces: the code is normalised.
    const typed = t.recoveryCode.toLowerCase().replace(/-/g, ' ');
    const { recoveryCode } = await d2.client.signInWithRecoveryCode(EMAIL, typed, PW2);
    t.secrets.strings.push(recoveryCode);
    expect(recoveryCode).not.toBe(t.recoveryCode);
    expect(hexEncode(d2.client.unlocked!.accountKey)).toBe(hexEncode(t.client.unlocked!.accountKey));
    expect(d2.status.getSnapshot()).toMatchObject({ state: 'idle', accountEmail: EMAIL });

    const keys = t.server.bodies.filter((b) => b.route === 'keys').map((b) => b.raw as Record<string, unknown>);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kind: 'password', signOutOthers: true });
    expect(keys[0].recoveryAuthKey).toEqual(expect.any(String));
    expect(keys[0].wrappedAkRecovery).toEqual(expect.any(String));
    // The final normal sign-in carries the real sealed device name.
    const a = t.server.accounts.get(EMAIL)!;
    expect(await openDeviceName(d2.client.unlocked!, 'fedcba9876543210', a.devices.get('fedcba9876543210')!)).toBe('Test laptop');
    // Device 1's session was dropped by the recovery.
    await expect(t.deps.api.account()).rejects.toMatchObject({ status: 401 });
    // Only one session remains, a normal one.
    expect([...t.server.sessions.values()].map((s) => s.kind)).toEqual(['normal']);

    const d3 = setup({ deviceId: '1111222233334444' }, t.server, t.secrets);
    await expect(d3.client.signInWithRecoveryCode(EMAIL, t.recoveryCode, PW3)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(d3.client.signIn(EMAIL, PW)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await d3.client.signIn(EMAIL, PW2);
    await device2(t.server, t.secrets).client.signInWithRecoveryCode(EMAIL, recoveryCode, PW3);
    assertNoSecrets(t.server, t.secrets);
  });

  it('rejects a malformed code and a weak new password before any request', async () => {
    const t = await signedUp();
    const n = t.server.bodies.length;
    const d2 = device2(t.server, t.secrets);
    await expect(d2.client.signInWithRecoveryCode(EMAIL, 'ABCD-1234', PW2)).rejects.toMatchObject({ code: 'invalid_recovery_code' });
    await expect(d2.client.signInWithRecoveryCode(EMAIL, t.recoveryCode, 'password1')).rejects.toBeInstanceOf(WeakPasswordError);
    expect(t.server.bodies.length).toBe(n);
    expect(d2.kdf).not.toHaveBeenCalled();
  });

  it('desktop: the recovery token is used for PUT keys and then replaced by the normal session token', async () => {
    const server = new FakeServer();
    const s1 = new MemorySecretStore();
    const t = setup({ wantToken: true, secrets: s1, api: server.api(() => loadSyncToken(s1)) }, server);
    const { recoveryCode } = await t.client.signUp(EMAIL, PW, CONSENT);
    const s2 = new MemorySecretStore();
    const d2 = device2(server, t.secrets, { wantToken: true, secrets: s2, api: server.api(() => loadSyncToken(s2)) });
    await d2.client.signInWithRecoveryCode(EMAIL, recoveryCode, PW2);
    const token = await loadSyncToken(s2);
    expect(server.sessions.get(token!)?.kind).toBe('normal');
  });
});

describe('startOver', () => {
  it('creates new keys under a new account id, sends it with the reset token, and flags re-encryption', async () => {
    const t = await signedUp();
    const oldId = t.client.unlocked!.accountId;
    t.server.resetTokens.set('reset-token-1', EMAIL);
    const d2 = device2(t.server, t.secrets);
    await expect(d2.client.startOver('reset-token-1', 'password1')).rejects.toBeInstanceOf(WeakPasswordError);
    const { recoveryCode } = await d2.client.startOver('reset-token-1', PW3);
    t.secrets.strings.push(recoveryCode);
    t.secrets.addUnlocked(d2.client.unlocked);
    expect(d2.client.unlocked!.accountId).not.toBe(oldId);
    expect(d2.client.needsReencrypt).toBe(true);
    const d3 = setup({ deviceId: '1111222233334444' }, t.server, t.secrets);
    await d3.client.signIn(EMAIL, PW3);
    expect(hexEncode(d3.client.unlocked!.accountKey)).toBe(hexEncode(d2.client.unlocked!.accountKey));
    assertNoSecrets(t.server, t.secrets);
  });
});

describe('real Argon2id at the floor', () => {
  it('sign-up and sign-in work end to end without a kdf override', async () => {
    const server = new FakeServer();
    const t = setup({ kdf: undefined }, server);
    await t.client.signUp(EMAIL, PW, CONSENT);
    const d2 = device2(server, t.secrets, { kdf: undefined });
    await d2.client.signIn(EMAIL, PW);
    expect(hexEncode(d2.client.unlocked!.accountKey)).toBe(hexEncode(t.client.unlocked!.accountKey));
    const login = server.bodies.find((b) => b.route === 'login')!;
    expect(login.json.includes(PW)).toBe(false);
  }, 90_000);
});

describe('serialisation of flows', () => {
  it('a sign-out issued during a sign-in runs after it', async () => {
    const t = await signedUp();
    await t.client.signOut({ wipeLocal: false });
    const p1 = t.client.signIn(EMAIL, PW);
    const p2 = t.client.signOut({ wipeLocal: false });
    await Promise.all([p1, p2]);
    expect(t.client.unlocked).toBeNull();
    expect(t.status.getSnapshot().state).toBe('signed-out');
  });
});
