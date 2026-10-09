/**
 * In-test model of the sync server's account routes (packages/sync-server/src/routes/account.ts) behind the
 * SyncApiClient surface. Not a test file. Every request body is recorded (JSON) so tests can scan for secrets.
 * Rules mirrored from the real server: prelogin is stable for unknown emails; signup for a taken address answers
 * like a new one (orchestrator decision); login/recover give 401 for an unknown email or wrong key; PUT keys checks
 * currentAuthKey (403) except from a recovery session, which may only set a password and must replace the spent
 * recovery code in the same request, after which every session is dropped; rotate keeps every old epoch.
 */
import { b64urlEncode } from '../../../Crypto';
import type { KdfParamsJson } from '../../../Crypto';
import type {
  ApiErrorCode, DeleteAccountRequest, KeysRequest, LoginRequest, PreloginRequest, RecoverRequest, ResetConfirmRequest,
  SessionResponse, SignupRequest,
} from '../../../Sync/api';
import type { KeysetWire } from '../../../Sync/crypto/keys';
import type { SyncApiClient } from '../../../Sync/engine/SyncApiClient';
import { SyncHttpError } from '../../../Sync/engine/ISyncTransport';
import { FLOOR } from '../crypto/fixtures';

export interface FakeAccount {
  id: string; email: string; kdf: KdfParamsJson; authKey: string; recoveryAuthKey: string;
  wrappedAkPassword: string; wrappedAkRecovery: string; wrappedIdk: string; keysets: KeysetWire[]; currentEpoch: number;
  devices: Map<string, string>;
}
interface Session { token: string; accountId: string; kind: 'normal' | 'recovery' }

const fail = (status: number, error: ApiErrorCode): never => {
  throw new SyncHttpError(status, { error });
};

/** The shared server state; each client gets its own `api(...)` view with its own "cookie". */
export class FakeServer {
  readonly accounts = new Map<string, FakeAccount>();      // by email
  readonly sessions = new Map<string, Session>();
  readonly bodies: Array<{ route: string; json: string; raw: unknown }> = [];
  readonly resetTokens = new Map<string, string>();         // token -> email
  private n = 0;

  byId(id: string): FakeAccount | undefined {
    return [...this.accounts.values()].find((a) => a.id === id);
  }

  /** A SyncApiClient-shaped object; `wantToken` sessions get a token, others the "cookie" of this view. */
  api(bearer?: () => Promise<string | null>): SyncApiClient & { cookie: string | null } {
    const srv = this;
    const view = { cookie: null as string | null };
    const presented = async () => (bearer ? await bearer() : view.cookie);
    const record = (route: string, body?: unknown) => {
      srv.bodies.push({ route, json: body === undefined ? '' : JSON.stringify(body), raw: body });
    };
    const session = async (): Promise<Session> => {
      const t = await presented();
      const s = t ? srv.sessions.get(t) : undefined;
      return s ?? fail(401, 'unauthorized');
    };
    const issue = (a: FakeAccount, kind: Session['kind'], device: { id: string; nameSealed: string }, wantToken?: boolean,
    ): SessionResponse => {
      a.devices.set(device.id, device.nameSealed);
      const token = `tok${++srv.n}`;
      srv.sessions.set(token, { token, accountId: a.id, kind });
      if (!wantToken) view.cookie = token;
      return {
        accountId: a.id, emailVerified: true,
        wrappedAk: kind === 'recovery' ? a.wrappedAkRecovery : a.wrappedAkPassword,
        wrappedRecordIdKey: a.wrappedIdk, keysets: a.keysets.map((k) => ({ ...k })), currentEpoch: a.currentEpoch,
        ...(wantToken ? { token } : {}),
      };
    };
    const dropAll = (accountId: string, except?: string) => {
      for (const [t, s] of srv.sessions) if (s.accountId === accountId && t !== except) srv.sessions.delete(t);
    };

    const api = {
      async info() { record('info'); return { apiVersion: 1 as const, signupOpen: true, quotaBytes: 1, minKdf: { m: FLOOR.m, t: FLOOR.t }, minAge: 13 }; },
      async prelogin(r: PreloginRequest) {
        record('prelogin', r);
        const a = srv.accounts.get(r.email.toLowerCase());
        const fake: KdfParamsJson = { id: 'argon2id', v: 19, ...FLOOR, salt: b64urlEncode(new Uint8Array(16).fill(9)) };
        return { kdf: a ? a.kdf : fake };
      },
      async signup(r: SignupRequest) {
        record('signup', r);
        const email = r.email.toLowerCase();
        if (srv.accounts.has(email)) {
          // Same success shape as a new account; no session is created (the owner gets an email instead).
          return { accountId: r.accountId, emailVerified: false, wrappedAk: r.material.wrappedAkPassword,
            wrappedRecordIdKey: r.material.wrappedRecordIdKey, keysets: r.material.keysets, currentEpoch: r.material.currentEpoch };
        }
        const m = r.material;
        const a: FakeAccount = {
          id: r.accountId, email, kdf: m.kdf, authKey: m.authKey, recoveryAuthKey: m.recoveryAuthKey,
          wrappedAkPassword: m.wrappedAkPassword, wrappedAkRecovery: m.wrappedAkRecovery, wrappedIdk: m.wrappedRecordIdKey,
          keysets: m.keysets, currentEpoch: m.currentEpoch, devices: new Map(),
        };
        srv.accounts.set(email, a);
        return issue(a, 'normal', r.device, r.wantToken);
      },
      async login(r: LoginRequest) {
        record('login', r);
        const a = srv.accounts.get(r.email.toLowerCase());
        if (!a || a.authKey !== r.authKey) fail(401, 'unauthorized');
        return issue(a!, 'normal', r.device, r.wantToken);
      },
      async recover(r: RecoverRequest) {
        record('recover', r);
        const a = srv.accounts.get(r.email.toLowerCase());
        if (!a || a.recoveryAuthKey !== r.recoveryAuthKey) fail(401, 'unauthorized');
        return issue(a!, 'recovery', r.device, r.wantToken);
      },
      async logout() {
        record('logout');
        const t = await presented();
        if (t) srv.sessions.delete(t);
        view.cookie = null;
      },
      async verifyEmail() { throw new Error('unused'); },
      async reset() { throw new Error('unused'); },
      async resetConfirm(r: ResetConfirmRequest & { accountId?: string }) {
        record('resetConfirm', r);
        const email = srv.resetTokens.get(r.token) ?? fail(400, 'bad_request');
        srv.resetTokens.delete(r.token);
        const old = srv.accounts.get(email)!;
        dropAll(old.id);
        const m = r.material;
        const a: FakeAccount = {
          id: r.accountId ?? fail(400, 'bad_request'), email, kdf: m.kdf, authKey: m.authKey,
          recoveryAuthKey: m.recoveryAuthKey, wrappedAkPassword: m.wrappedAkPassword, wrappedAkRecovery: m.wrappedAkRecovery,
          wrappedIdk: m.wrappedRecordIdKey, keysets: m.keysets, currentEpoch: m.currentEpoch, devices: new Map(),
        };
        srv.accounts.set(email, a);
        return issue(a, 'normal', r.device, r.wantToken);
      },
      async account() {
        record('account');
        const a = srv.byId((await session()).accountId)!;
        return { email: a.email, emailVerified: true, bytesUsed: 0, quotaBytes: 1, createdAt: '2026-01-01T00:00:00Z', recordCount: 0 };
      },
      async keys(r: KeysRequest) {
        record('keys', r);
        const s = await session();
        const a = srv.byId(s.accountId)!;
        const recovery = s.kind === 'recovery';
        if (recovery && r.kind !== 'password') fail(403, 'forbidden');
        if (!recovery && r.currentAuthKey !== a.authKey) fail(403, 'forbidden');
        if (r.kind === 'password') {
          if (recovery && (!r.recoveryAuthKey || !r.wrappedAkRecovery)) fail(400, 'bad_request');
          if (typeof r.signOutOthers !== 'boolean') fail(400, 'bad_request');
          Object.assign(a, { kdf: r.kdf, authKey: r.authKey, wrappedAkPassword: r.wrappedAkPassword });
          if (recovery) {
            Object.assign(a, { recoveryAuthKey: r.recoveryAuthKey, wrappedAkRecovery: r.wrappedAkRecovery });
            dropAll(a.id);
            view.cookie = null;
          } else if (r.signOutOthers) dropAll(a.id, s.token);
        } else if (r.kind === 'recovery') {
          Object.assign(a, { recoveryAuthKey: r.recoveryAuthKey, wrappedAkRecovery: r.wrappedAkRecovery });
        } else {
          const m = r.material;
          if (m.currentEpoch <= a.currentEpoch) fail(400, 'bad_request');
          for (const k of a.keysets) if (!m.keysets.some((n) => n.epoch === k.epoch)) fail(400, 'bad_request');
          Object.assign(a, {
            kdf: m.kdf, authKey: m.authKey, recoveryAuthKey: m.recoveryAuthKey, wrappedAkPassword: m.wrappedAkPassword,
            wrappedAkRecovery: m.wrappedAkRecovery, wrappedIdk: m.wrappedRecordIdKey, keysets: m.keysets,
            currentEpoch: m.currentEpoch,
          });
          dropAll(a.id, s.token);
        }
      },
      async devices() { throw new Error('unused'); },
      async revokeDevice() { throw new Error('unused'); },
      async exportAll() { throw new Error('unused'); },
      async deleteAccount(r: DeleteAccountRequest) {
        record('deleteAccount', r);
        const a = srv.byId((await session()).accountId)!;
        if (r.authKey !== a.authKey) fail(403, 'forbidden');
        dropAll(a.id);
        srv.accounts.delete(a.email);
      },
      transport() { throw new Error('unused'); },
    };
    return Object.assign(view, api) as unknown as SyncApiClient & { cookie: string | null };
  }
}
