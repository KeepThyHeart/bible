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
  if (deleted) {
    if (o.blob !== null) v.bad('a deleted record carries no blob');
    return { id: o.id, baseSeq: baseSeq as number | null, deleted, blob: null };
  }
  if (typeof o.blob !== 'string' || o.blob.length === 0) v.bad('a live record needs a blob');
  if (o.blob.length > MAX_BLOB_CHARS) throw new ApiHttpError(413, 'too_large', 'Record too large');
  const bytes = b64urlToBytes(o.blob);
  if (!bytes) v.bad('invalid blob encoding');
  if (bytes.length > Sync.LIMITS.maxRecordBytes) throw new ApiHttpError(413, 'too_large', 'Record too large');
  return { id: o.id, baseSeq: baseSeq as number | null, deleted, blob: o.blob };
}

export function recordRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { store, opts } = ctx;

  r.get('/changes', requireSession(ctx), handler((req, res) => {
    const { account } = authOf(res);
    const since = queryInt(req.query.since, 'since', 0, 0);
    const limit = Math.min(queryInt(req.query.limit, 'limit', Sync.LIMITS.maxPullLimit, 1), Sync.LIMITS.maxPullLimit);
    const rows = store.records.changes(account.id, since, limit + 1);
    const more = rows.length > limit;
    const records = more ? rows.slice(0, limit) : rows;
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
    const result = store.records.push(account.id, recs, quota);
    if ('error' in result) throw new ApiHttpError(413, 'quota_exceeded', 'Storage quota exceeded');
    res.json(result);
  }));

  return r;
}
