/** Where files go: `<out>/v1/{module}/{narrator}/{rev}/{book}/{ccc}.(json|ogg|mp3)`. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const FORMAT_INFO = {
  opus: { ext: 'ogg', codec: 'opus', mime: 'audio/ogg; codecs=opus' },
  mp3: { ext: 'mp3', codec: 'mp3', mime: 'audio/mpeg' },
} as const;
export type AudioFormat = keyof typeof FORMAT_INFO;

export const ccc = (chapter: number): string => String(chapter).padStart(3, '0');

export interface LayoutRef { out: string; module: string; narrator: string; rev: string }

export const translationDir = (out: string, module: string): string => join(out, 'v1', module);
export const indexPath = (out: string, module: string): string => join(translationDir(out, module), 'index.json');
export const revDir = (l: LayoutRef): string => join(translationDir(l.out, l.module), l.narrator, l.rev);
export const manifestPath = (l: LayoutRef, book: number, chapter: number): string => join(revDir(l), String(book), `${ccc(chapter)}.json`);
/** The `path` a manifest records: relative to the rev directory. */
export const relativeAudioPath = (book: number, chapter: number, format: AudioFormat): string => `${book}/${ccc(chapter)}.${FORMAT_INFO[format].ext}`;
export const audioPath = (l: LayoutRef, book: number, chapter: number, format: AudioFormat): string => join(revDir(l), relativeAudioPath(book, chapter, format));

/** Write to a temp name beside the target, then rename: an interrupted run never leaves a half file. */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** The temp name to give an encoder, to `commitTemp` afterwards. */
export function tempPathFor(path: string): string {
  return `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function commitTemp(tmp: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await rename(tmp, path);
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

export async function readJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return undefined; }
}
