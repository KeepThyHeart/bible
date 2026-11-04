/** Piper voice files: the same ones `fetch:piper` downloads, from rhasspy/piper-voices. */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AudioCredit } from '../core';
import { ensureDownloaded } from './download';

export const PIPER_VOICES_BASE = process.env.PIPER_VOICES_BASE || 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

const VOICE_ID = /^([a-z]{2,3})_([A-Za-z]+)-(.+)-(x_low|low|medium|high)$/;

export function isPiperVoiceId(id: string): boolean { return VOICE_ID.test(id); }

/** `en_US-amy-medium` to `en/en_US/amy/medium/en_US-amy-medium` (names may contain underscores). */
export function piperVoicePath(id: string): string {
  const m = VOICE_ID.exec(id);
  if (!m) throw new Error(`"${id}" is not a Piper voice id (expected e.g. en_US-amy-medium)`);
  const [, lang, region, name, quality] = m;
  return `${lang}/${lang}_${region}/${name}/${quality}/${id}`;
}

export interface PiperVoiceFiles { onnx: string; json: string; card: string }

export function piperVoiceUrls(id: string, base = PIPER_VOICES_BASE): { onnx: string; json: string; card: string } {
  const p = piperVoicePath(id);
  const dir = p.slice(0, p.lastIndexOf('/'));
  return { onnx: `${base}/${p}.onnx`, json: `${base}/${p}.onnx.json`, card: `${base}/${dir}/MODEL_CARD` };
}

export async function ensurePiperVoice(cacheDir: string, id: string, log?: (m: string) => void): Promise<PiperVoiceFiles> {
  const u = piperVoiceUrls(id);
  const dir = join(cacheDir, 'piper', 'voices');
  const [onnx, json] = await Promise.all([
    ensureDownloaded(u.onnx, join(dir, `${id}.onnx`), log),
    ensureDownloaded(u.json, join(dir, `${id}.onnx.json`), log),
  ]);
  const card = await ensureDownloaded(u.card, join(dir, `${id}.MODEL_CARD`), log).catch(() => '');
  return { onnx, json, card };
}

/** The voice's licence as its MODEL_CARD states it; "See URL" or nothing becomes a pointer to the card. */
export function creditFromModelCard(id: string, card: string): AudioCredit {
  const url = piperVoiceUrls(id).card;
  const dataset = /^\*\s*URL:\s*(\S+)/im.exec(card)?.[1];
  const license = /^\*\s*License:\s*(.+)$/im.exec(card)?.[1]?.trim();
  const useful = license && !/^see\b/i.test(license) ? license : undefined;
  return {
    name: `Piper voice ${id}`,
    license: useful ?? 'see MODEL_CARD',
    url,
    ...(dataset ? { attribution: `Dataset: ${dataset}` } : {}),
  };
}

export async function readCard(path: string): Promise<string> {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}
