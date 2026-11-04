/** Device detection and model/variant choice (design section 3). */

import type { SpeechDevice, SpeechPrefs, WhisperModelId, WhisperVariant } from '../types';

/** The slice of `navigator` that detection reads (all optional so tests can fake it). */
export interface NavigatorLike {
  gpu?: {
    requestAdapter(): Promise<{ features?: { has(name: string): boolean } } | null>;
  };
  deviceMemory?: number;
  hardwareConcurrency?: number;
  userAgentData?: { mobile?: boolean };
  userAgent?: string;
}

export interface SpeechEnv {
  /** Result of `detectDevice`. */
  device: SpeechDevice;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  /** Phone-class device (UA-CH mobile, or a coarse primary pointer). */
  mobile?: boolean;
}

/** `webgpu` when an adapter with `shader-f16` is available, else `wasm`. Never throws. */
export async function detectDevice(nav: NavigatorLike | undefined = globalThis.navigator): Promise<SpeechDevice> {
  try {
    const adapter = await nav?.gpu?.requestAdapter();
    if (adapter?.features?.has('shader-f16')) return 'webgpu';
  } catch {
    /* fall through to wasm */
  }
  return 'wasm';
}

export function isMobile(nav: NavigatorLike | undefined = globalThis.navigator): boolean {
  if (nav?.userAgentData?.mobile) return true;
  try {
    return !!globalThis.matchMedia?.('(pointer: coarse)').matches && /Mobi|Android|iPhone/i.test(nav?.userAgent ?? '');
  } catch {
    return false;
  }
}

export async function detectEnv(nav: NavigatorLike | undefined = globalThis.navigator): Promise<SpeechEnv> {
  return {
    device: await detectDevice(nav),
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
    mobile: isMobile(nav),
  };
}

export function isLowEnd(env: SpeechEnv): boolean {
  return (
    (env.deviceMemory !== undefined && env.deviceMemory <= 4) ||
    (env.hardwareConcurrency !== undefined && env.hardwareConcurrency <= 4) ||
    !!env.mobile
  );
}

export function chooseModel(
  prefs: SpeechPrefs,
  env: SpeechEnv,
): { model: WhisperModelId; variant: WhisperVariant; device: SpeechDevice } {
  const device: SpeechDevice = prefs.device === 'auto' ? env.device : prefs.device;
  const model: WhisperModelId = prefs.model !== 'auto' ? prefs.model : device === 'wasm' && isLowEnd(env) ? 'tiny' : 'base';
  return { model, variant: device === 'webgpu' ? 'f16' : 'q8', device };
}

/** WASM thread count: 1 unless cross-origin isolated. */
export function wasmThreads(crossOriginIsolated: boolean, hardwareConcurrency: number | undefined): number {
  return crossOriginIsolated ? Math.max(1, Math.min(4, (hardwareConcurrency ?? 2) - 1)) : 1;
}
