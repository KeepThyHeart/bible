/**
 * Non-secret sync settings (task 0150 M3, subtask A): `<userData>/sync/accounts.json`, written atomically with mode 0600.
 *
 * Holds the server URL, the "ask for the password at each launch" choice, this install's sync device id (16 hex, made
 * once and never changed), and the remembered account email and signed-in flag (so a launch knows to show "locked"
 * when the keys are not available). No key, password or token is ever stored here.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';

export interface StoredSyncSettings {
  v: 1;
  /** '' until the user sets one. */
  serverUrl: string;
  askPasswordEachLaunch: boolean;
  /** 16 lowercase hex chars. */
  deviceId: string;
  email: string | null;
  signedIn: boolean;
}

export type SyncSettingsPatch = Partial<Pick<StoredSyncSettings, 'serverUrl' | 'askPasswordEachLaunch' | 'email' | 'signedIn'>>;

export interface SyncSettingsStore {
  get(): StoredSyncSettings;
  update(patch: SyncSettingsPatch): StoredSyncSettings;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_URL_LENGTH = 2048;

/**
 * Validate and normalise a server URL. Returns the URL without a trailing slash, or null when it is not acceptable:
 * https only (http only for localhost, 127.0.0.1 and [::1]), no credentials, no query, no fragment. '' is accepted
 * as "no server" and returned as ''.
 */
export function normalizeServerUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return '';
  if (text.length > MAX_URL_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.username !== '' || u.password !== '') return null;
  if (u.search !== '' || u.hash !== '' || text.includes('?') || text.includes('#')) return null;
  if (u.protocol === 'http:') {
    if (!LOOPBACK_HOSTS.has(u.hostname)) return null;
  } else if (u.protocol !== 'https:') {
    return null;
  }
  if (u.hostname === '') return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
}

const HEX16 = /^[0-9a-f]{16}$/;

function defaults(deviceId: string): StoredSyncSettings {
  return { v: 1, serverUrl: '', askPasswordEachLaunch: false, deviceId, email: null, signedIn: false };
}

function parse(text: string, makeId: () => string): { value: StoredSyncSettings; changed: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { value: defaults(makeId()), changed: true };
  }
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const url = normalizeServerUrl(o.serverUrl);
  const deviceId = typeof o.deviceId === 'string' && HEX16.test(o.deviceId) ? o.deviceId : makeId();
  const value: StoredSyncSettings = {
    v: 1,
    serverUrl: url ?? '',
    askPasswordEachLaunch: o.askPasswordEachLaunch === true,
    deviceId,
    email: typeof o.email === 'string' && o.email !== '' ? o.email : null,
    signedIn: o.signedIn === true,
  };
  return { value, changed: url === null || deviceId !== o.deviceId };
}

function writeAtomic(file: string, value: StoredSyncSettings): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
}

/** File-backed store. The device id is created on first read and persisted at once. */
export function createSyncSettingsStore(file: string, makeId: () => string = () => randomBytes(8).toString('hex')): SyncSettingsStore {
  let cached: StoredSyncSettings | null = null;
  const load = (): StoredSyncSettings => {
    if (cached) return cached;
    let text: string | null = null;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      text = null;
    }
    const { value, changed } = text === null ? { value: defaults(makeId()), changed: true } : parse(text, makeId);
    if (changed) {
      try { writeAtomic(file, value); } catch { /* read-only folder: keep in memory */ }
    }
    cached = value;
    return value;
  };
  return {
    get: () => ({ ...load() }),
    update(patch) {
      const next: StoredSyncSettings = { ...load(), ...patch, v: 1 };
      writeAtomic(file, next);
      cached = next;
      return { ...next };
    },
  };
}
