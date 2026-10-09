/** A sync server mounted in an Express app over an in-memory DB, plus fake (shape-valid) key material. */
import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import type { Sync } from '@bible/core';
import { createSyncServer, type SyncServer, type SyncServerOptions } from '../../src';
import { TestSql } from './sql';

export const PREFIX = '/api/sync/v1';
export const ORIGIN = 'https://bible.example';

const b64 = (n: number): string => randomBytes(n).toString('base64url');

export interface Clock { t: number; now: () => number; advance(ms: number): void }

export function clock(start = 1_800_000_000_000): Clock {
  const c: Clock = { t: start, now: () => c.t, advance: (ms) => { c.t += ms; } };
  return c;
}

export interface TestServer {
  app: express.Express;
  server: SyncServer;
  sql: TestSql;
  clock: Clock;
  logs: Array<{ level: string; msg: string; meta?: object }>;
  agent: () => request.Agent;
}

export function makeServer(over: Partial<SyncServerOptions> = {}): TestServer {
  const sql = new TestSql();
  const c = clock();
  const logs: TestServer['logs'] = [];
  const server = createSyncServer({
    sql, serverSecret: new Uint8Array(32).fill(7), publicUrl: 'https://bible.example',
    email: { send: async () => {} }, allowedOrigins: [ORIGIN], now: c.now,
    log: (level, msg, meta) => { logs.push({ level, msg, meta }); },
    ...over,
  });
  const app = express();
  app.set('trust proxy', true);
  app.use(PREFIX, server.router);
  return { app, server, sql, clock: c, logs, agent: () => request.agent(app) };
}

export function kdf(): Sync.KdfParamsJson {
  return { id: 'argon2id', v: 19, m: 65536, t: 3, p: 1, salt: b64(16) };
}

export interface Creds { email: string; accountId: string; material: Sync.AccountKeyMaterial; device: Sync.DeviceWire }

export function newCreds(email = `user${randomBytes(4).toString('hex')}@example.com`): Creds {
  return {
    email,
    accountId: randomBytes(16).toString('hex'),
    material: {
      kdf: kdf(), authKey: b64(32), wrappedAkPassword: b64(60), recoveryAuthKey: b64(32), wrappedAkRecovery: b64(60),
      wrappedRecordIdKey: b64(60), keysets: [{ epoch: 0, wrappedDataKey: b64(60) }], currentEpoch: 0,
    },
    device: newDevice(),
  };
}

export function newDevice(): Sync.DeviceWire {
  return { id: randomBytes(8).toString('hex'), nameSealed: b64(40) };
}

export function signupBody(c: Creds, wantToken = false): Sync.SignupRequest {
  return {
    email: c.email, accountId: c.accountId, material: c.material, device: c.device,
    consent: { terms: true, ageConfirmed: true }, ...(wantToken ? { wantToken } : {}),
  };
}

export { b64 };
