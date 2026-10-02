/**
 * `IManifestSource` over HTTP JSON: the translation index and chapter manifests
 * as published in the audio tree.
 *
 * Behaviour that matters:
 * - A 404 means "no recording", answered as `null`, never as an error. With no
 *   recordings published anywhere (the starting state) every lookup is a 404.
 * - Whatever comes back is validated. A proxy answering 200 with an HTML page,
 *   or a build with a bad manifest, is reported as "no recording" (and logged)
 *   rather than reaching the player.
 * - Chapter manifests are immutable (the revision is in the URL), so they are
 *   served from the asset cache first. The index is not immutable: the network
 *   wins, and the last good copy is the fallback when offline.
 * - Index lookups are shared for a minute, so the Play button, the resolver and
 *   the provider asking in quick succession cost one request.
 */

import { validateAudioIndex, validateChapterManifest } from '@bible/core/browser';
import type {
  AudioError,
  AudioNarrator,
  ChapterManifest,
  ChapterRef,
  IAssetCache,
  IAudioLocator,
  IManifestSource,
  TranslationAudioIndex,
} from '@bible/core/browser';

const INDEX_TTL_MS = 60_000;

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export function networkError(message: string): AudioError {
  return { code: 'network', message, retryable: true };
}

export function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError'
    || (err as { code?: string } | null)?.code === 'aborted';
}

export class HttpManifestSource implements IManifestSource {
  private readonly indexMemo = new Map<string, { at: number; value: Promise<TranslationAudioIndex | null> }>();

  constructor(
    private readonly locator: IAudioLocator,
    private readonly cache?: IAssetCache,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * The lookup is shared between callers, so it runs on its own signal: one
   * caller cancelling (the user moved on) must not fail the others. The file is
   * a few hundred bytes; callers check their own signal after the await.
   */
  translationIndex(moduleAbbr: string, _signal?: AbortSignal): Promise<TranslationAudioIndex | null> {
    const memo = this.indexMemo.get(moduleAbbr);
    if (memo && this.now() - memo.at < INDEX_TTL_MS) return memo.value;
    const value = this.loadIndex(moduleAbbr, new AbortController().signal);
    const entry = { at: this.now(), value };
    this.indexMemo.set(moduleAbbr, entry);
    // Do not memoize a failure (offline, aborted): the next caller should retry.
    value.catch(() => {
      if (this.indexMemo.get(moduleAbbr) === entry) this.indexMemo.delete(moduleAbbr);
    });
    return value;
  }

  async chapter(ref: ChapterRef, narrator: AudioNarrator, signal: AbortSignal): Promise<ChapterManifest | null> {
    const url = this.locator.manifestUrl(ref, narrator.id, narrator.rev);
    const cached = await this.cache?.get(url).catch(() => undefined);
    let body: unknown;
    if (cached) {
      body = await cached.json().catch(() => undefined);
    } else {
      const res = await this.get(url, signal);
      if (res === null) return null;
      // Keep the raw response for offline use only once it has parsed and validated.
      body = await res.clone().json().catch(() => undefined);
      const check = validateChapterManifest(body);
      if (check.ok && this.matches(check.value!, ref, narrator)) {
        void this.cache?.put(url, res).catch(() => {});
        return check.value!;
      }
      this.reject(url, check.errors);
      return null;
    }
    const check = validateChapterManifest(body);
    if (check.ok && this.matches(check.value!, ref, narrator)) {
      void this.cache?.touch(url).catch(() => {});
      return check.value!;
    }
    this.reject(url, check.errors);
    return null;
  }

  private async loadIndex(moduleAbbr: string, signal: AbortSignal): Promise<TranslationAudioIndex | null> {
    const url = this.locator.indexUrl(moduleAbbr);
    let res: Response | null;
    try {
      res = await this.get(url, signal);
    } catch (err) {
      if (isAbort(err)) throw err;
      // Offline (or the server is down): fall back to the last index we saw.
      const cached = await this.cache?.get(url).catch(() => undefined);
      if (!cached) throw err;
      const check = validateAudioIndex(await cached.json().catch(() => undefined));
      return check.ok ? check.value! : null;
    }
    if (res === null) return null;
    const body = await res.clone().json().catch(() => undefined);
    const check = validateAudioIndex(body);
    if (!check.ok || check.value!.module.toLowerCase() !== moduleAbbr.toLowerCase()) {
      this.reject(url, check.ok ? ['module does not match the request'] : check.errors);
      return null;
    }
    void this.cache?.put(url, res).catch(() => {});
    return check.value!;
  }

  /** GET; null for 404/410, a thrown network error for any other failure. */
  private async get(url: string, signal: AbortSignal): Promise<Response | null> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { signal });
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw err;
      throw networkError('Could not reach the audio server.');
    }
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw networkError(`The audio server answered ${res.status}.`);
    return res;
  }

  private matches(m: ChapterManifest, ref: ChapterRef, narrator: AudioNarrator): boolean {
    return m.book === ref.book
      && m.chapter === ref.chapter
      && m.module.toLowerCase() === ref.moduleAbbr.toLowerCase()
      && m.narrator === narrator.id;
  }

  private reject(url: string, errors: string[]): void {
    console.warn(`[audio] ignoring invalid document ${url}: ${errors.slice(0, 3).join('; ') || 'does not match the request'}`);
  }
}
