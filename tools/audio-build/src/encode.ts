/** PCM to Ogg Opus / MP3 with ffmpeg (a system binary; `--ffmpeg` or `FFMPEG` to point elsewhere). */

import { spawn } from 'node:child_process';
import type { AudioFormat } from './layout';

export interface EncodeOptions {
  ffmpeg: string;
  /** Kilobits per second. */
  opusKbps: number;
  mp3Kbps: number;
}

export const DEFAULT_ENCODE: Omit<EncodeOptions, 'ffmpeg'> = { opusKbps: 32, mp3Kbps: 64 };

/** Rates libopus accepts; anything else is resampled to the next one up (24 kHz for 22.05 kHz voices). */
const OPUS_RATES = [8000, 12000, 16000, 24000, 48000];
const MP3_RATES = [16000, 22050, 24000, 32000, 44100, 48000];

export function targetRate(format: AudioFormat, sampleRate: number): number {
  const allowed = format === 'opus' ? OPUS_RATES : MP3_RATES;
  return allowed.find(r => r >= sampleRate) ?? allowed[allowed.length - 1];
}

export function ffmpegArgs(format: AudioFormat, sampleRate: number, output: string, o: EncodeOptions): string[] {
  const common = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0', '-map_metadata', '-1', '-ac', '1', '-ar', String(targetRate(format, sampleRate))];
  if (format === 'opus') return [...common, '-c:a', 'libopus', '-b:a', `${o.opusKbps}k`, '-application', 'audio', '-vbr', 'on', '-f', 'ogg', output];
  return [...common, '-c:a', 'libmp3lame', '-b:a', `${o.mp3Kbps}k`, '-fflags', '+bitexact', '-write_xing', '1', '-f', 'mp3', output];
}

export class EncodeError extends Error {}

/** Encode mono float PCM to `output` (the caller passes a temp name and renames afterwards). */
export function encodePcm(pcm: Float32Array, sampleRate: number, format: AudioFormat, output: string, o: EncodeOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(o.ffmpeg, ffmpegArgs(format, sampleRate, output, o), { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr += String(d); });
    child.on('error', e => reject(new EncodeError(`Could not run ${o.ffmpeg}: ${e.message}`)));
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new EncodeError(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
    child.stdin.on('error', () => { /* reported through the exit code */ });
    child.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}
