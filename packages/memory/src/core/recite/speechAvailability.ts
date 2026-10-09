/**
 * Whether reciting aloud can run, and why not. Probed through `api.speech`
 * (ungated `status()`), cached for 30 s, refreshed by settings and start.
 */

import { kitFor } from '@bible/core/recite';
import type { ILanguageKit } from '@bible/core/recite';
import type { ISpeechApi } from '@bible/core/speech';
import type { SpeechAvailability, SpeechPermission } from '../types';
import { LOOP } from './config';

export interface SpeechHost {
  speech?: ISpeechApi;
}

const EMPTY = { missingPermissions: [] as SpeechPermission[], engineLabel: '', onDevice: false, handsFree: false };

let cache: { api: ISpeechApi | undefined; at: number; value: SpeechAvailability } | null = null;

export function resetProbeCache(): void {
  cache = null;
}

export function isUnknownRpc(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unknown rpc method/i.test(msg);
}

export async function probeSpeech(
  api: SpeechHost,
  now: number,
  opts: { force?: boolean } = {},
): Promise<SpeechAvailability> {
  if (!opts.force && cache && cache.api === api.speech && now - cache.at < LOOP.probeCacheMs && now >= cache.at) {
    return cache.value;
  }
  const value = await probeOnce(api);
  cache = { api: api.speech, at: now, value };
  return value;
}

async function probeOnce(api: SpeechHost): Promise<SpeechAvailability> {
  if (!api.speech) return { state: 'host-too-old', ...EMPTY };
  let st;
  try {
    st = await api.speech.status();
  } catch (err) {
    return { state: isUnknownRpc(err) ? 'host-too-old' : 'unavailable', ...EMPTY };
  }
  const missing: SpeechPermission[] = [];
  if (!st.granted.listen) missing.push('speech:listen');
  if (!st.granted.speak) missing.push('speech:speak');
  const handsFree = st.granted.speak && st.speak !== 'unavailable';
  const base = { engineLabel: st.engineLabel, onDevice: st.onDevice, handsFree };
  if (!st.granted.listen) {
    return { state: 'permission-missing', missingPermissions: missing, ...base, handsFree: false };
  }
  const state =
    st.listen === 'unavailable' ? 'unavailable' : st.listen === 'needs-download' ? 'needs-download' : 'ready';
  return { state, missingPermissions: missing.filter((p) => p !== 'speech:speak' || !handsFree), ...base };
}

/** The user-facing reason a state cannot start a recitation. */
export function unavailableMessage(a: SpeechAvailability): string {
  switch (a.state) {
    case 'ready':
      return '';
    case 'needs-download':
      return 'The speech model needs to be downloaded first. Open Preferences > Speech.';
    case 'unavailable':
      return 'Speech recognition is not available on this device.';
    case 'permission-missing':
      return 'Scripture Memory needs microphone access (the speech:listen permission) to listen while you recite. Grant it under Preferences > Extensions > Scripture Memory.';
    case 'unsupported-language':
      return 'Reciting aloud does not support this Bible translation’s language yet.';
    case 'host-too-old':
      return 'This version of the app does not support speech. Update it to recite aloud.';
  }
}

// -- module language -> kit ----------------------------------------------------

export interface ModuleHost {
  bible: { listModules(): Promise<{ id: string; abbreviation: string; language?: string }[]> };
}

let modules: Map<string, string | undefined> | null = null;

export function resetModuleCache(): void {
  modules = null;
}

/** Modules whose language the host may not report but which are known to be English. */
const WELL_KNOWN_ENGLISH = new Set(['KJV', 'WEB']);

/** Language tag of a Bible module (by abbreviation or id); undefined when unknown. */
export async function moduleLanguage(api: ModuleHost, moduleId: string): Promise<string | undefined> {
  if (!modules) {
    const list = await api.bible.listModules();
    modules = new Map();
    for (const m of list) {
      modules.set(m.abbreviation, m.language);
      modules.set(m.id, m.language);
    }
  }
  const lang = modules.get(moduleId);
  if (lang) return lang;
  return WELL_KNOWN_ENGLISH.has(moduleId.toUpperCase()) ? 'en' : undefined;
}

/** The language kit for a module, or null (unsupported language). An unknown language is unsupported (never silently English). */
export async function moduleKit(api: ModuleHost, moduleId: string): Promise<ILanguageKit | null> {
  const lang = await moduleLanguage(api, moduleId);
  return lang ? kitFor(lang) : null;
}
