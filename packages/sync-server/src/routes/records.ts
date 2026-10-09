/**
 * Record sync (contracts §7, W2-C): GET changes?since=&limit= | POST push. Records are opaque encrypted blobs;
 * the server never looks inside. Every query is scoped by the session's account id. Recovery sessions are
 * refused by `requireSession`. Pulling is allowed for unverified accounts; pushing is not.
 */
import { Router } from 'express';
import { Sync } from '@bible/core';
import { ApiHttpError, authOf, handler, requireSession, type ServerContext } from '../http';
import { b64urlToBytes } from '../auth/tokens';
import * as v from '../auth/validate';

const HEX32 = /^[0-9a-f]{32}$/;
/** Longest b64url string whose decoded length can still be <= maxRecordBytes (cheap pre-check before decoding). */
const MAX_BLOB_CHARS = Math.ceil((Sync.LIMITS.maxRecordBytes * 4) / 3) + 4;

/** /changes stops adding records once this many blob bytes are in the page (`more: true` says there is more). */
const MAX_PULL_BYTES = 8 * 1024 * 1024;

/**
 * Accepted v1 envelope sizes, from Sync/crypto/RecordCipher.ts: blob = 0x01 | u32 epoch | nonce 12 | ct(padded) | tag 16,
 * i.e. 33 + padded, where padded is a multiple of 1024 up to 66560 (json <= 64 KiB: 4 + json rounded up to 1024),
 * or a multiple of 16384 from 81920 up to 1 MiB (json > 64 KiB). Anything else was not made by a real client.
 */
const BLOB_OVERHEAD = 33;
const SMALL_PADDED_MAX = 66560;
const LARGE_PADDED_MAX = 1024 * 1024;

export function isV1BlobShape(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes[0] !== 1) return false;
  const padded = bytes.length - BLOB_OVERHEAD;
  if (padded < 1024 || padded > LARGE_PADDED_MAX) return false;
  return padded <= SMALL_PADDED_MAX ? padded % 1024 === 0 : padded % 16384 === 0;
}

function queryInt(raw: unknown, what: string, fallback: number, min: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) v.bad(`invalid ${what}`);
  const n = Number(raw);
  if (n < min) v.bad(`invalid ${what}`);
  return n;
}

function parsePushRecord(raw: unknown): Sync.PushRecord {
  const o = v.obj(raw, 'record');
  if (typeof o.id !== 'string' || !HEX32.test(o.id)) v.bad('invalid record id');
  const baseSeq = o.baseSeq;
  if (baseSeq !== null && !(typeof baseSeq === 'number' && Number.isSafeInteger(baseSeq) && baseSeq >= 0)) {
    v.bad('invalid baseSeq');
  }
  const deleted = v.bool(o.deleted, 'deleted');
  // Live records and tombstones alike carry a sealed blob (a tombstone is a sealed record with a deleted marker).
  if (typeof o.blob !== 'string' || o.blob.length === 0) v.bad(deleted ? 'a deleted record needs a blob' : 'a live record needs a blob');
  if (o.blob.length > MAX_BLOB_CHARS) throw new ApiHttpError(413, 'too_large', 'Record too large');
  const bytes = b64urlToBytes(o.blob);
  if (!bytes) v.bad('invalid blob encoding');
  if (bytes.length > Sync.LIMITS.maxRecordBytes) throw new ApiHttpError(413, 'too_large', 'Record too large');
  if (!isV1BlobShape(bytes)) v.bad('invalid blob');
  return { id: o.id, baseSeq: baseSeq as number | null, deleted, blob: o.blob };
}

export function recordRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { store, opts } = ctx;

  r.get('/changes', requireSession(ctx), handler((req, res) => {
    const { account } = authOf(res);
    const since = queryInt(req.query.since, 'since', 0, 0);
    const limit = Math.min(queryInt(req.query.limit, 'limit', Sync.LIMITS.maxPullLimit, 1), Sync.LIMITS.maxPullLimit);
    const { records, more } = store.records.changesPage(account.id, since, limit, MAX_PULL_BYTES);
    const body: Sync.PullResponse = {
      records, next: records.length > 0 ? records[records.length - 1].seq : since, more,
    };
    res.json(body);
  }));

  r.post('/push', requireSession(ctx), handler((req, res) => {
    const { account } = authOf(res);
    if (!account.emailVerified) {
      throw new ApiHttpError(403, 'email_unverified', 'Verify your email address to sync');
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > Sync.LIMITS.maxPushBodyBytes) {
      throw new ApiHttpError(413, 'too_large', 'Request body too large');
    }
    const body = v.obj(req.body);
    if (!Array.isArray(body.records)) v.bad('records must be an array');
    if (body.records.length > Sync.LIMITS.maxPushRecords) {
      throw new ApiHttpError(413, 'too_large', `At most ${Sync.LIMITS.maxPushRecords} records per push`);
    }
    const seen = new Set<string>();
    const recs = (body.records as unknown[]).map((raw) => {
      const rec = parsePushRecord(raw);
      if (seen.has(rec.id)) v.bad('duplicate record id in one push');
      seen.add(rec.id);
      return rec;
    });
    const quota = account.quotaBytes ?? opts.quotaBytes;
    const result = store.records.push(account.id, recs, quota, opts.maxRecordsPerAccount);
    if ('error' in result) throw new ApiHttpError(413, 'quota_exceeded', 'Storage quota exceeded');
    res.json(result);
  }));

  return r;
}
