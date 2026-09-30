/**
 * downloadFile: one file of an asset (task 0090, design.md §4.2). Internal to the
 * asset module (not exported from index.ts).
 *
 * Resume, retry with backoff, streaming SHA-256, size guards, atomic commit. The
 * partial is always re-hashed before a resume (hasher state is never persisted), and
 * a 200 answer to a ranged request means "full body from byte 0".
 */

import { AssetError, isAssetError } from './types';
import type {
  AssetFile,
  AssetFileRef,
  AssetManifest,
  IAssetStore,
  IAssetTransport,
  IHasher,
  IPartialFile,
  TransportResponse,
} from './types';
import { parseSidecar } from './manifest';

export interface DownloadEnv {
  transport: IAssetTransport;
  createHasher: () => IHasher;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  log: (message: string, detail?: unknown) => void;
  /** Retries per file for retryable failures (attempts = maxRetries + 1). */
  maxRetries: number;
  /** Backoff before retry n (1-based); the last value repeats. */
  retryDelaysMs: readonly number[];
  /** <= 0 disables the stall timeout. */
  stallTimeoutMs: number;
  /**
   * Called on a store `quota` failure with the bytes still needed; resolves true when
   * something was freed (then the write is retried once).
   */
  onQuota?: (needBytes: number) => Promise<boolean>;
}

export type DownloadPhase = 'downloading' | 'verifying' | 'committing';

export interface DownloadCtx {
  /** The job signal. Abort keeps the partial bytes and throws `aborted`. */
  signal: AbortSignal;
  /** Bytes of THIS file held so far (absolute, resumed bytes included; drops to 0 on a reset). */
  onBytes(held: number): void;
  onPhase(phase: DownloadPhase): void;
  /** Retry attempt of the current file (0 on the first try). */
  onAttempt(attempt: number): void;
}

export interface DownloadResult {
  /** Digest of the bytes now committed (computed even when unverified). */
  sha256: string;
  size: number;
}

/** Appends `download=1` so the service worker never intercepts the manager's own requests. */
export function withDownloadParam(url: string): string {
  const hash = url.indexOf('#');
  const base = hash < 0 ? url : url.slice(0, hash);
  const frag = hash < 0 ? '' : url.slice(hash);
  return `${base}${base.includes('?') ? '&' : '?'}download=1${frag}`;
}

/** Start offset of `Content-Range: bytes <start>-<end>/<total>`, or null when unparseable. */
export function parseContentRangeStart(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

/** Strong ETag, else Last-Modified, else null. */
export function validatorOf(res: TransportResponse): string | null {
  const etag = res.headers.etag;
  if (etag && !/^W\//i.test(etag)) return etag;
  return res.headers.lastModified ?? null;
}

export function toAssetError(e: unknown): AssetError {
  if (isAssetError(e)) return e as AssetError;
  return new AssetError('storage', e instanceof Error ? e.message : String(e));
}

function aborted(): AssetError {
  return new AssetError('aborted', 'Aborted');
}

function isRetryable(e: AssetError): boolean {
  return e.retryable || e.code === 'network';
}

async function hashAll(source: AsyncIterable<Uint8Array>, hasher: IHasher): Promise<number> {
  let n = 0;
  for await (const chunk of source) {
    hasher.update(chunk);
    n += chunk.length;
  }
  return n;
}

/**
 * Each `next()` races a stall timer and the abort signal. A stall aborts the attempt
 * (`attemptCtl`) and throws a retryable `network` error.
 */
async function* guardBody(
  body: AsyncIterable<Uint8Array>,
  stallMs: number,
  attemptCtl: AbortController,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const it = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      if (signal.aborted) throw aborted();
      const next = it.next();
      next.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const timeout = new Promise<never>((_, reject) => {
        if (stallMs > 0) timer = setTimeout(() => reject(new AssetError('network', `No data for ${stallMs} ms`, true)), stallMs);
      });
      const abortP = new Promise<never>((_, reject) => {
        onAbort = () => reject(aborted());
        signal.addEventListener('abort', onAbort, { once: true });
      });
      let result: IteratorResult<Uint8Array>;
      try {
        result = await Promise.race([next, timeout, abortP]);
      } catch (e) {
        if (isAssetError(e) && (e as AssetError).code === 'network') attemptCtl.abort();
        throw e;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
      if (result.done) return;
      yield result.value;
    }
  } finally {
    const ret = it.return?.();
    if (ret) ret.catch(() => undefined);
  }
}

function statusError(status: number): AssetError {
  if (status === 404 || status === 410) return new AssetError('not-found', `HTTP ${status}`, false, status);
  const retryable = status === 408 || status === 429 || status >= 500;
  return new AssetError('http', `HTTP ${status}`, retryable, status);
}

async function backoff(env: DownloadEnv, attempt: number, signal: AbortSignal): Promise<void> {
  const delays = env.retryDelaysMs;
  const ms = delays.length ? delays[Math.min(attempt - 1, delays.length - 1)] : 0;
  await env.sleep(ms, signal);
  if (signal.aborted) throw aborted();
}

/**
 * The expected digest of a file: `file.sha256`, else the `<url>.sha256` sidecar
 * (retried like a download). `undefined` = install unverified (only `allowUnverified`).
 */
export async function resolveExpectedSha(
  file: AssetFile,
  manifest: Pick<AssetManifest, 'allowUnverified'>,
  env: DownloadEnv,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (file.sha256) return file.sha256.toLowerCase();
  const url = `${file.url}.sha256`;
  let attempt = 0;
  let text: string | null = null;
  for (;;) {
    if (signal.aborted) throw aborted();
    try {
      text = await env.transport.getText(url, signal);
      break;
    } catch (e) {
      if (signal.aborted) throw aborted();
      const err = toAssetError(e);
      if (!isRetryable(err) || attempt >= env.maxRetries) throw err;
      attempt++;
      await backoff(env, attempt, signal);
    }
  }
  const sha = text == null ? null : parseSidecar(text);
  if (sha) return sha;
  if (manifest.allowUnverified) return undefined;
  throw new AssetError('unverifiable', `No SHA-256 for ${file.path}: no digest in the manifest and no readable sidecar`);
}

/**
 * Download one file into the store and commit it. `expectedSha` undefined = unverified.
 * Throws AssetError. On `aborted` and on retry exhaustion the partial bytes are kept;
 * on `integrity` / `size-mismatch` they are discarded.
 */
export async function downloadFile(
  store: IAssetStore,
  ref: AssetFileRef,
  expectedSha: string | undefined,
  env: DownloadEnv,
  ctx: DownloadCtx,
): Promise<DownloadResult> {
  const signal = ctx.signal;
  const expected = expectedSha?.toLowerCase();
  const knownSize = ref.size > 0;
  if (signal.aborted) throw aborted();

  let partial: IPartialFile = await store.openPartial(ref);
  let ended = false; // discard()/commit()/abort-close done: never close() it again
  const discard = async (): Promise<void> => {
    ended = true;
    await partial.discard();
  };

  // Crash recovery / legacy cache / same-URL upgrade: a committed file that already verifies.
  if (expected && (await store.exists(ref))) {
    const existing = await store.read(ref);
    if (existing) {
      const h = env.createHasher();
      const size = await hashAll(existing, h);
      if (h.digestHex() === expected && (!knownSize || size === ref.size)) {
        await discard();
        ctx.onBytes(size);
        return { sha256: expected, size };
      }
    }
    // else leave it: it may be the installed old version; commit() replaces it atomically later.
  }

  let hasher = env.createHasher();
  const rehash = async (): Promise<void> => {
    hasher = env.createHasher();
    if (partial.size > 0) await hashAll(partial.read(), hasher);
  };

  try {
    if (knownSize && partial.size > ref.size) await partial.reset(null);
    await rehash();
    ctx.onBytes(partial.size);

    let attempt = 0;
    let got416 = false;
    let quotaRetried = false;
    ctx.onAttempt(0);

    for (;;) {
      const attemptCtl = new AbortController();
      const relay = (): void => attemptCtl.abort();
      signal.addEventListener('abort', relay, { once: true });
      try {
        const start = partial.size;
        if (knownSize && start === ref.size) break; // all bytes already held

        const res = await env.transport.get({
          url: withDownloadParam(ref.url),
          rangeStart: start > 0 ? start : undefined,
          ifRange: start > 0 ? partial.validator ?? undefined : undefined,
          signal: attemptCtl.signal,
        });

        if (res.status === 200) {
          if (start > 0) {
            // The server ignored Range, or the entity changed (If-Range): full body from byte 0.
            await partial.reset(validatorOf(res));
            hasher = env.createHasher();
            ctx.onBytes(0);
          } else if (partial.validator == null) {
            await partial.reset(validatorOf(res));
          }
        } else if (res.status === 206) {
          const s = parseContentRangeStart(res.headers.contentRange);
          if (s !== start) {
            await partial.reset(null);
            hasher = env.createHasher();
            ctx.onBytes(0);
            attempt++;
            ctx.onAttempt(attempt);
            if (attempt > env.maxRetries) {
              throw new AssetError('http', `Unexpected Content-Range "${res.headers.contentRange ?? ''}"`, false, 206);
            }
            continue; // counts as an attempt, no sleep
          }
        } else if (res.status === 416) {
          if (got416) throw new AssetError('http', 'HTTP 416 after a reset', false, 416);
          got416 = true;
          await partial.reset(null);
          hasher = env.createHasher();
          ctx.onBytes(0);
          continue;
        } else {
          throw statusError(res.status);
        }

        for await (const chunk of guardBody(res.body, env.stallTimeoutMs, attemptCtl, signal)) {
          if (knownSize && partial.size + chunk.length > ref.size) {
            await discard();
            throw new AssetError('size-mismatch', `${ref.path}: more than the declared ${ref.size} bytes`);
          }
          await partial.append(chunk);
          hasher.update(chunk);
          ctx.onBytes(partial.size);
        }
        break;
      } catch (e) {
        if (ended) throw e;
        if (signal.aborted) {
          ended = true;
          await partial.close(); // keep the bytes for a later resume
          throw aborted();
        }
        const err = toAssetError(e);
        if (err.code === 'quota' && env.onQuota && !quotaRetried) {
          quotaRetried = true;
          if (await env.onQuota(Math.max(1, knownSize ? ref.size - partial.size : 1))) continue;
          throw err;
        }
        if (!isRetryable(err) || attempt >= env.maxRetries) throw err;
        attempt++;
        ctx.onAttempt(attempt);
        await partial.close();
        await backoff(env, attempt, signal);
        // Re-open and re-hash: nothing is assumed about a closed partial.
        partial = await store.openPartial(ref);
        await rehash();
        ctx.onBytes(partial.size);
      } finally {
        signal.removeEventListener('abort', relay);
        attemptCtl.abort();
      }
    }

    ctx.onPhase('verifying');
    if (knownSize && partial.size !== ref.size) {
      const got = partial.size;
      await discard();
      throw new AssetError('size-mismatch', `${ref.path}: expected ${ref.size} bytes, got ${got}`);
    }
    const sha = hasher.digestHex();
    if (expected && sha !== expected) {
      await discard();
      throw new AssetError('integrity', `${ref.path}: SHA-256 mismatch (expected ${expected}, got ${sha})`);
    }

    ctx.onPhase('committing');
    const size = partial.size;
    try {
      await partial.commit();
    } catch (e) {
      const err = toAssetError(e);
      if (err.code === 'quota' && env.onQuota && !quotaRetried && (await env.onQuota(Math.max(1, size)))) {
        await partial.commit();
      } else {
        throw err;
      }
    }
    ended = true;
    return { sha256: sha, size };
  } catch (e) {
    if (!ended) {
      ended = true;
      try {
        await partial.close();
      } catch (closeErr) {
        env.log('partial close failed', closeErr);
      }
    }
    throw toAssetError(e);
  }
}
