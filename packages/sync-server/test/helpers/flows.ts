/** Test flows shared by the W2 suites: a capturing mailbox and signed-in accounts. */
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import type { EmailSender } from '../../src';
import { PREFIX, makeServer, newCreds, signupBody, type Creds, type TestServer } from './server';

export interface Mailbox extends EmailSender { sent: Array<{ to: string; subject: string; text: string; html?: string }> }

export function mailbox(): Mailbox {
  const sent: Mailbox['sent'] = [];
  return { sent, send: async (m) => { sent.push(m); } };
}

/** The one-time token in the last mail's link (`#token=...`). */
export function tokenIn(m: { text: string }): string {
  const hit = /#token=([A-Za-z0-9_-]{43})/.exec(m.text);
  if (!hit) throw new Error('no token link in mail');
  return hit[1];
}

export function makeMailServer(over: Parameters<typeof makeServer>[0] = {}): TestServer & { mail: Mailbox } {
  const mail = mailbox();
  return { ...makeServer({ email: mail, ...over }), mail };
}

export interface Account { c: Creds; token: string; auth: { Authorization: string } }

/** Signs up (desktop style, bearer token) and, unless `verify` is false, verifies through the mailed link. */
export async function account(t: TestServer & { mail: Mailbox }, verify = true, email?: string): Promise<Account> {
  const c = newCreds(email);
  const res = await request(t.app).post(`${PREFIX}/signup`).send(signupBody(c, true));
  expect(res.status).toBe(201);
  if (verify) {
    const m = t.mail.sent.filter((x) => x.to === c.email && /Confirm/.test(x.subject)).pop()!;
    const v = await request(t.app).post(`${PREFIX}/verify-email`).send({ token: tokenIn(m) });
    expect(v.status).toBe(204);
  }
  return { c, token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` } };
}

export const rid = (): string => randomBytes(16).toString('hex');
export const blob = (n: number): string => randomBytes(n).toString('base64url');

/** Padded length the real RecordCipher produces for `jsonLen` bytes of JSON. */
export function paddedLen(jsonLen: number): number {
  const bucket = jsonLen <= 64 * 1024 ? 1024 : 16384;
  return Math.ceil((4 + jsonLen) / bucket) * bucket;
}

/** A b64url blob with the real v1 envelope shape (version byte 1, 33 + padded bytes) for `jsonLen` bytes of JSON. */
export const sealed = (jsonLen = 10): string => {
  const b = randomBytes(33 + paddedLen(jsonLen));
  b[0] = 1;
  return b.toString('base64url');
};
