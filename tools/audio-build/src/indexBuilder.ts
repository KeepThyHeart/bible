/**
 * `v1/{module}/index.json`, rebuilt from the manifests on disk after a run.
 *
 * `books` lists books whose every chapter is recorded; `chapters` lists the chapters of
 * partially recorded books. Narrators this run did not touch keep their entries exactly.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AUDIO_INDEX_SCHEMA,
  validateAudioIndex,
  validateChapterManifest,
  type AudioNarrator,
  type AudioProvenance,
  type TranslationAudioIndex,
} from './core';
import { indexPath, readJson, writeFileAtomic, revDir } from './layout';

export interface BuiltNarrator {
  id: string;
  label: string;
  language: string;
  rev: string;
  provenance?: AudioProvenance;
}

/** Chapter numbers recorded for one narrator and rev: the manifests that validate and say what their path says. */
export async function scanRecorded(out: string, module: string, narrator: string, rev: string): Promise<Map<number, number[]>> {
  const dir = revDir({ out, module, narrator, rev });
  const found = new Map<number, number[]>();
  let books: string[];
  try { books = await readdir(dir); } catch { return found; }
  for (const b of books) {
    if (!/^\d+$/.test(b)) continue;
    const book = Number(b);
    const names = (await readdir(join(dir, b)).catch(() => [])).filter(n => /^\d{3}\.json$/.test(n));
    for (const name of names) {
      const v = validateChapterManifest(await readJson(join(dir, b, name)));
      const chapter = Number(name.slice(0, 3));
      if (!v.ok || !v.value) continue;
      const m = v.value;
      if (m.book !== book || m.chapter !== chapter || m.module !== module || m.narrator !== narrator || m.rev !== rev) continue;
      const list = found.get(book) ?? [];
      list.push(chapter);
      found.set(book, list);
    }
  }
  for (const list of found.values()) list.sort((a, b) => a - b);
  return found;
}

/** Pure part: split recorded chapters into full books and partial books. */
export function summarizeRecorded(
  recorded: ReadonlyMap<number, readonly number[]>,
  chaptersOfBook: ReadonlyMap<number, readonly number[]>,
): Pick<AudioNarrator, 'books' | 'chapters'> {
  const books: number[] = [];
  const chapters: Record<string, number[]> = {};
  for (const book of [...recorded.keys()].sort((a, b) => a - b)) {
    const have = recorded.get(book)!;
    const all = chaptersOfBook.get(book);
    const complete = !!all && all.length > 0 && all.every(c => have.includes(c));
    if (complete) books.push(book);
    else if (have.length > 0) chapters[String(book)] = [...have];
  }
  return { books, ...(Object.keys(chapters).length > 0 ? { chapters } : {}) };
}

export async function rebuildIndex(opts: {
  out: string;
  module: string;
  built: BuiltNarrator[];
  chaptersOfBook: ReadonlyMap<number, readonly number[]>;
}): Promise<TranslationAudioIndex> {
  const path = indexPath(opts.out, opts.module);
  const raw = await readJson(path);
  const existing = validateAudioIndex(raw);
  if (raw !== undefined && !(existing.ok && existing.value && existing.value.module === opts.module)) {
    throw new Error(`${path} exists but is not a valid audio index for ${opts.module}; not overwriting it (it may hold other narrators). Fix or move it and run again.`);
  }
  const narrators: AudioNarrator[] = existing.ok && existing.value ? [...existing.value.narrators] : [];
  for (const b of opts.built) {
    const recorded = await scanRecorded(opts.out, opts.module, b.id, b.rev);
    const entry: AudioNarrator = {
      id: b.id,
      label: b.label,
      language: b.language,
      rev: b.rev,
      ...summarizeRecorded(recorded, opts.chaptersOfBook),
      ...(b.provenance ? { provenance: b.provenance } : {}),
    };
    const i = narrators.findIndex(n => n.id === b.id);
    if (recorded.size === 0) { if (i >= 0 && narrators[i].rev === b.rev) narrators.splice(i, 1); continue; }
    if (i >= 0) narrators[i] = entry; else narrators.push(entry);
  }
  const index: TranslationAudioIndex = { schema: AUDIO_INDEX_SCHEMA, module: opts.module, narrators };
  const check = validateAudioIndex(index);
  if (!check.ok) throw new Error(`The rebuilt index is invalid: ${check.errors.join('; ')}`);
  await writeFileAtomic(path, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
