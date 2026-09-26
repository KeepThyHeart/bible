/**
 * The `audio` block of the site configuration.
 *
 * The operator writes it in `site-config.json`; the server normalizes it with
 * `parseAudioSiteConfig` and sends the result to the client in `/api/config`,
 * which runs the same function again on what it receives. Both sides therefore
 * agree on defaults, and a hand-edited config that names a broken engine or a
 * voice with a path that leaves its directory loses that entry instead of
 * taking the feature (or the server) down.
 *
 * Nothing here decides what is *available*: a listed voice is only a promise
 * that its files exist under the engine's `assetBase`. The engines and the
 * recorded provider report actual availability at run time.
 */

import type { AudioSiteConfig, TtsEngineConfig, TtsVoiceConfig } from './types';

export const DEFAULT_AUDIO_BASE = '/audio';

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** `/path` on this origin, or an absolute http(s) URL. Trailing slashes are dropped. */
function normalizeBase(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().replace(/\/+$/, '');
  if (v === '') return null;
  if (/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//') && !/\s/.test(v)) return v;
  return null;
}

function isSafeRelativePath(p: string): boolean {
  if (p === '' || p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return false;
  return !p.split(/[\\/]/).some(seg => seg === '..');
}

function parseVoice(raw: unknown): TtsVoiceConfig | null {
  if (!isObject(raw)) return null;
  const { id, label, language, files } = raw;
  if (typeof id !== 'string' || !id || typeof language !== 'string' || !language) return null;
  if (!Array.isArray(files) || files.length === 0) return null;
  if (!files.every(f => typeof f === 'string' && isSafeRelativePath(f))) return null;
  const voice: TtsVoiceConfig = {
    id,
    label: typeof label === 'string' && label ? label : id,
    language,
    files: files as string[],
  };
  if (raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'high') voice.quality = raw.quality;
  if (typeof raw.downloadBytes === 'number' && raw.downloadBytes >= 0) voice.downloadBytes = raw.downloadBytes;
  if (typeof raw.license === 'string') voice.license = raw.license;
  if (typeof raw.sampleUrl === 'string') voice.sampleUrl = raw.sampleUrl;
  return voice;
}

function parseEngine(raw: unknown, base: string): TtsEngineConfig | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  if (raw.enabled === false) return null;
  const assetBase = normalizeBase(raw.assetBase) ?? `${base}/tts/${raw.id}`;
  const seen = new Set<string>();
  const voices: TtsVoiceConfig[] = [];
  for (const v of Array.isArray(raw.voices) ? raw.voices : []) {
    const voice = parseVoice(v);
    if (voice && !seen.has(voice.id)) {
      seen.add(voice.id);
      voices.push(voice);
    }
  }
  const engine: TtsEngineConfig = { id: raw.id, enabled: true, assetBase, voices };
  if (isObject(raw.defaultVoices)) {
    const defaults: Record<string, string> = {};
    for (const [lang, id] of Object.entries(raw.defaultVoices)) {
      if (typeof id === 'string' && seen.has(id)) defaults[lang] = id;
    }
    if (Object.keys(defaults).length > 0) engine.defaultVoices = defaults;
  }
  return engine;
}

/**
 * Normalize the raw `audio` block. Never throws; anything unusable is dropped.
 *
 * Defaults: recordings are served from `/audio` on this origin, the recorded
 * channel is on, and no TTS engine is enabled (an engine needs its runtime and
 * voice files hosted first, which only the operator can arrange).
 */
export function parseAudioSiteConfig(raw: unknown): AudioSiteConfig {
  const block = isObject(raw) ? raw : {};
  const base = normalizeBase(block.base) ?? DEFAULT_AUDIO_BASE;
  const tts = isObject(block.tts) ? block.tts : {};
  const engines: TtsEngineConfig[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(tts.engines) ? tts.engines : []) {
    const engine = parseEngine(e, base);
    if (engine && !seen.has(engine.id)) {
      seen.add(engine.id);
      engines.push(engine);
    }
  }
  return { base, recorded: block.recorded !== false, engines };
}

/**
 * Origins other than the page's own that the configuration points at, for the
 * server's Content-Security-Policy (`media-src` and `connect-src`). Empty in
 * the default, same-origin setup, which is what keeps the strict policy strict.
 */
export function audioExternalOrigins(cfg: AudioSiteConfig): string[] {
  const origins = new Set<string>();
  const add = (url: string) => {
    const m = /^(https?:\/\/[^/]+)/i.exec(url);
    if (m) origins.add(m[1].toLowerCase());
  };
  add(cfg.base);
  for (const e of cfg.engines) add(e.assetBase);
  return Array.from(origins);
}
