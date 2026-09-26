/**
 * Decides which provider (and voice) plays a translation.
 *
 * Order of preference, from the design: the user's explicit choice for this
 * translation, else their global choice, when it is usable; otherwise a
 * recording if the translation has one; otherwise the first on-device engine (in
 * the operator's order) that can speak the language; otherwise nothing, and the
 * Play button is disabled. With zero recordings and no engines that last case is
 * the normal one.
 *
 * "Usable" answers come from providers that may hit the network, so they are
 * cached: concurrent callers share one question, a failure is never cached, a
 * "no" expires after five minutes (a recording may have been published; the
 * device may be back online) and a "yes" lasts the session.
 */

import type {
  AudioPrefs,
  AudioSourceChoice,
  AudioVoice,
  IAudioProvider,
  IAudioSourceResolver,
  IRegistry,
  SourceResolution,
} from '@bible/core/browser';
import { RECORDED_PROVIDER_ID } from './RecordedAudioProvider';

export const NEGATIVE_TTL_MS = 5 * 60_000;

export interface ResolverDeps {
  providers: IRegistry<IAudioProvider>;
  /** Enabled TTS engine ids, in the operator's order of preference. */
  engineOrder: string[];
  /** Whether this browser can run the engine (WASM, memory). */
  engineSupported(engineId: string): Promise<boolean>;
  /** The configured default voice for an engine and language subtag. */
  defaultVoice(engineId: string, language: string): string | undefined;
  now?: () => number;
}

const primary = (lang: string): string => lang.toLowerCase().split(/[-_]/)[0];
const engineIdOf = (providerId: string): string => (providerId.startsWith('tts:') ? providerId.slice(4) : providerId);

interface CacheEntry<T> { value: Promise<T>; at: number; settled?: boolean; result?: T }

export class AudioSourceResolver implements IAudioSourceResolver {
  private readonly usableCache = new Map<string, CacheEntry<boolean>>();
  private readonly voicesCache = new Map<string, CacheEntry<AudioVoice[]>>();
  private readonly engineCache = new Map<string, Promise<boolean>>();
  private readonly now: () => number;

  constructor(private readonly deps: ResolverDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Forget cached answers: everything, or one translation's. Call after a download or a config change. */
  invalidate(moduleAbbr?: string): void {
    for (const cache of [this.usableCache, this.voicesCache] as Array<Map<string, CacheEntry<unknown>>>) {
      for (const key of [...cache.keys()]) {
        if (!moduleAbbr || key.split('|')[1] === moduleAbbr) cache.delete(key);
      }
    }
  }

  /** Forget only the "no" answers (the network came back). */
  invalidateNegatives(): void {
    for (const [key, entry] of this.usableCache) if (entry.settled && entry.result === false) this.usableCache.delete(key);
    for (const [key, entry] of this.voicesCache) if (entry.settled && (entry.result?.length ?? 0) === 0) this.voicesCache.delete(key);
  }

  /** Synchronous peek at a cached answer for a translation (for rendering). `undefined`: not known yet. */
  cachedAvailability(moduleAbbr: string, language: string): boolean | undefined {
    let unknown = false;
    for (const p of this.orderedProviders()) {
      const entry = this.usableCache.get(this.key(p, moduleAbbr, language));
      if (!entry || !entry.settled) { unknown = true; continue; }
      if (entry.result === true) return true;
      // An expired "no" is no longer an answer: the caller should ask again.
      if (this.now() - entry.at >= NEGATIVE_TTL_MS) unknown = true;
    }
    return unknown ? undefined : false;
  }

  async resolve(
    moduleAbbr: string,
    language: string,
    prefs: AudioPrefs,
    override?: AudioSourceChoice,
  ): Promise<SourceResolution | null> {
    const want: AudioSourceChoice = override ?? prefs.perTranslation[moduleAbbr]?.source ?? prefs.source;
    let failed = false;
    let notice: string | undefined;

    if (want !== 'auto') {
      const p = this.deps.providers.get(want);
      if (p && await this.usable(p, moduleAbbr, language)) {
        const pick = await this.pickVoice(p, moduleAbbr, language, prefs);
        return { provider: p, voiceId: pick.voiceId, reason: 'preferred', notice: pick.notice };
      }
      failed = true;
      notice = 'audio.notice.preferredUnavailable';
    }

    const recorded = this.deps.providers.get(RECORDED_PROVIDER_ID);
    if (recorded && await this.usable(recorded, moduleAbbr, language)) {
      const pick = await this.pickVoice(recorded, moduleAbbr, language, prefs);
      return { provider: recorded, voiceId: pick.voiceId, reason: failed ? 'fallback' : 'auto-recorded', notice: notice ?? pick.notice };
    }
    for (const id of this.deps.engineOrder) {
      const p = this.deps.providers.get(`tts:${id}`);
      if (p && await this.usable(p, moduleAbbr, language)) {
        const pick = await this.pickVoice(p, moduleAbbr, language, prefs);
        return { provider: p, voiceId: pick.voiceId, reason: failed ? 'fallback' : 'auto-tts', notice: notice ?? pick.notice };
      }
    }
    return null;
  }

  async options(moduleAbbr: string, language: string): Promise<Array<{ provider: IAudioProvider; voices: AudioVoice[] }>> {
    const out: Array<{ provider: IAudioProvider; voices: AudioVoice[] }> = [];
    for (const p of this.orderedProviders()) {
      if (await this.usable(p, moduleAbbr, language)) {
        out.push({ provider: p, voices: await this.voicesOf(p, moduleAbbr, language) });
      }
    }
    return out;
  }

  // -- internals -----------------------------------------------------------

  /** Recorded first, then engines in the operator's order. */
  private orderedProviders(): IAudioProvider[] {
    const list: IAudioProvider[] = [];
    const recorded = this.deps.providers.get(RECORDED_PROVIDER_ID);
    if (recorded) list.push(recorded);
    for (const id of this.deps.engineOrder) {
      const p = this.deps.providers.get(`tts:${id}`);
      if (p) list.push(p);
    }
    return list;
  }

  private key(p: IAudioProvider, moduleAbbr: string, language: string): string {
    return `${p.id}|${moduleAbbr}|${primary(language)}`;
  }

  private fresh<T>(entry: CacheEntry<T> | undefined, keepIf: (r: T) => boolean): entry is CacheEntry<T> {
    if (!entry) return false;
    if (!entry.settled) return true; // in flight: share it
    return keepIf(entry.result as T) || this.now() - entry.at < NEGATIVE_TTL_MS;
  }

  private usable(p: IAudioProvider, moduleAbbr: string, language: string): Promise<boolean> {
    const key = this.key(p, moduleAbbr, language);
    const hit = this.usableCache.get(key);
    if (this.fresh(hit, r => r === true)) return hit.value;
    const entry: CacheEntry<boolean> = { at: this.now(), value: Promise.resolve(false) };
    entry.value = this.computeUsable(p, moduleAbbr, language).then(
      r => { entry.settled = true; entry.result = r; entry.at = this.now(); return r; },
      () => { this.usableCache.delete(key); return false; }, // a failure is not an answer
    );
    this.usableCache.set(key, entry);
    return entry.value;
  }

  private async computeUsable(p: IAudioProvider, moduleAbbr: string, language: string): Promise<boolean> {
    if (p.kind === 'tts') {
      if (!(await this.engineOk(engineIdOf(p.id)))) return false;
      if (!(await p.supports(moduleAbbr, language))) return false;
      return (await this.voicesOf(p, moduleAbbr, language)).length > 0;
    }
    return p.supports(moduleAbbr, language);
  }

  private engineOk(engineId: string): Promise<boolean> {
    let p = this.engineCache.get(engineId);
    if (!p) {
      p = this.deps.engineSupported(engineId).catch(() => false);
      this.engineCache.set(engineId, p);
    }
    return p;
  }

  private voicesOf(p: IAudioProvider, moduleAbbr: string, language: string): Promise<AudioVoice[]> {
    const key = this.key(p, moduleAbbr, language);
    const hit = this.voicesCache.get(key);
    if (this.fresh(hit, r => r.length > 0)) return hit.value;
    const entry: CacheEntry<AudioVoice[]> = { at: this.now(), value: Promise.resolve([]) };
    entry.value = p.voices(moduleAbbr, language).then(
      r => { entry.settled = true; entry.result = r; entry.at = this.now(); return r; },
      () => { this.voicesCache.delete(key); return []; },
    );
    this.voicesCache.set(key, entry);
    return entry.value;
  }

  /** perTranslation voice, then the per-engine/language choice, then the configured default, then the first. */
  private async pickVoice(
    p: IAudioProvider,
    moduleAbbr: string,
    language: string,
    prefs: AudioPrefs,
  ): Promise<{ voiceId?: string; notice?: string }> {
    const voices = await this.voicesOf(p, moduleAbbr, language);
    const ids = new Set(voices.map(v => v.id));
    const engine = engineIdOf(p.id);
    const lang = primary(language);
    const wanted = prefs.perTranslation[moduleAbbr]?.voiceId;
    const candidates = [
      wanted,
      prefs.voiceByEngineLang[`${engine}:${lang}`],
      p.kind === 'tts' ? this.deps.defaultVoice(engine, lang) : undefined,
      voices[0]?.id,
    ];
    const voiceId = candidates.find((c): c is string => !!c && ids.has(c));
    const notice = wanted && !ids.has(wanted) ? 'audio.notice.voiceUnavailable' : undefined;
    return { voiceId, notice };
  }
}
