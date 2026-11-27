/**
 * The desktop has no site config: the main process describes what it serves (`getInfo`) and the
 * renderer parses that with the shared parser, allowing only the app's own `kth-audio` scheme.
 */
import { parseAudioSiteConfig, type AudioSiteConfig } from '@bible/core/browser';
import type { DesktopAudioInfo } from '../../../../electron/modules/audio/types';
import { audioClient } from './audioClient';

export interface DesktopAudioConfig {
  config: AudioSiteConfig;
  /** Bytes of the Piper runtime plus the pronunciation overlay (for the download gate). */
  runtimeBytes: number;
  recordingsBase: string | null;
}

export function parseDesktopAudioInfo(info: DesktopAudioInfo): DesktopAudioConfig {
  return {
    config: parseAudioSiteConfig(info.audio, { allowSchemes: ['kth-audio'] }),
    runtimeBytes: info.runtimeBytes,
    recordingsBase: info.recordingsBase,
  };
}

export async function loadDesktopAudioConfig(): Promise<DesktopAudioConfig> {
  return parseDesktopAudioInfo(await audioClient.getInfo());
}

/** Something to play: recordings are on, or at least one engine is enabled. */
export function hasPlayableAudio(c: AudioSiteConfig): boolean {
  return c.recorded || c.engines.length > 0;
}

let runtimeBytes = 0;
/** Bytes of the Piper runtime plus pronunciation overlay, as main last reported (for the download gate). */
export const getDesktopRuntimeBytes = (): number => runtimeBytes;
export const setDesktopRuntimeBytes = (n: number): void => { runtimeBytes = n; };
