/**
 * Writing one chapter (audio files, then the manifest) and deciding whether an existing
 * chapter is still good.
 *
 * Order matters for resume: audio files are written first, each under a temp name and
 * renamed; the manifest goes last. A manifest on disk therefore means its audio is whole.
 */

import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CHAPTER_MANIFEST_SCHEMA,
  validateChapterManifest,
  type AudioBuildInfo,
  type ChapterManifest,
  type ManifestFile,
} from './core';
import { encodePcm, type EncodeOptions } from './encode';
import {
  FORMAT_INFO,
  audioPath,
  commitTemp,
  manifestPath,
  readJson,
  revDir,
  relativeAudioPath,
  sha256File,
  tempPathFor,
  writeFileAtomic,
  type AudioFormat,
  type LayoutRef,
} from './layout';
import type { RenderedChapter } from './render';

export interface ChapterIdent { book: number; chapter: number }

export class ManifestInvalidError extends Error {}

/** Build and validate the manifest, encoding and renaming the audio files first. */
export async function writeChapter(
  layout: LayoutRef,
  id: ChapterIdent,
  rendered: RenderedChapter,
  textHash: string,
  build: AudioBuildInfo,
  formats: readonly AudioFormat[],
  enc: EncodeOptions,
): Promise<ChapterManifest> {
  const files: ManifestFile[] = [];
  const written: string[] = [];
  const staged: Array<{ tmp: string; final: string }> = [];
  try {
    // 1. Encode every format to a temp name; nothing existing is touched yet.
    for (const format of formats) {
      const final = audioPath(layout, id.book, id.chapter, format);
      const tmp = tempPathFor(final);
      await mkdir(dirname(final), { recursive: true });
      staged.push({ tmp, final });
      await encodePcm(rendered.pcm, rendered.sampleRate, format, tmp, enc);
      const info = FORMAT_INFO[format];
      files.push({
        codec: info.codec,
        mime: info.mime,
        path: relativeAudioPath(id.book, id.chapter, format),
        bytes: (await stat(tmp)).size,
        sha256: await sha256File(tmp),
      });
    }
    const manifest: ChapterManifest = {
      schema: CHAPTER_MANIFEST_SCHEMA,
      module: layout.module,
      book: id.book,
      chapter: id.chapter,
      narrator: layout.narrator,
      rev: layout.rev,
      textHash,
      duration: rendered.duration,
      files,
      ...(rendered.intro ? { intro: rendered.intro } : {}),
      verses: rendered.verses,
      build,
    };
    const check = validateChapterManifest(manifest);
    if (!check.ok) throw new ManifestInvalidError(`The manifest for ${id.book}.${id.chapter} is invalid: ${check.errors.join('; ')}`);
    // 2. Retire the old manifest first, so no manifest ever describes audio that was replaced.
    await rm(manifestPath(layout, id.book, id.chapter), { force: true });
    for (const st of staged) { await commitTemp(st.tmp, st.final); written.push(st.final); }
    await writeFileAtomic(manifestPath(layout, id.book, id.chapter), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } catch (e) {
    // Leave nothing that looks finished: audio without its manifest is invisible to the player and to resume.
    for (const p of written) await rm(p, { force: true });
    for (const st of staged) await rm(st.tmp, { force: true });
    throw e;
  }
}

export interface ResumeCheck { ok: boolean; reason?: string; manifest?: ChapterManifest }

const sameBuild = (a: AudioBuildInfo | undefined, b: AudioBuildInfo): boolean =>
  !!a && a.engine === b.engine && a.voice === b.voice && (a.model ?? '') === (b.model ?? '') && a.rate === b.rate && a.gapMs === b.gapMs && a.introGapMs === b.introGapMs;

/**
 * A chapter can be skipped when its manifest exists and validates, its text hash and build
 * settings match, and every file it lists is on disk with the recorded size. The formats
 * wanted are also required: asking for MP3 after an Opus-only run renders again.
 */
export async function checkExisting(
  layout: LayoutRef,
  id: ChapterIdent,
  textHash: string,
  build: AudioBuildInfo,
  formats: readonly AudioFormat[],
): Promise<ResumeCheck> {
  const raw = await readJson(manifestPath(layout, id.book, id.chapter));
  if (raw === undefined) return { ok: false, reason: 'no manifest' };
  const v = validateChapterManifest(raw);
  if (!v.ok || !v.value) return { ok: false, reason: 'manifest does not validate' };
  const m = v.value;
  if (m.module !== layout.module || m.narrator !== layout.narrator || m.rev !== layout.rev || m.book !== id.book || m.chapter !== id.chapter) {
    return { ok: false, reason: 'manifest identity differs' };
  }
  if (m.textHash !== textHash) return { ok: false, reason: 'text changed' };
  if (!sameBuild(m.build, build)) return { ok: false, reason: 'engine, voice or settings changed' };
  for (const format of formats) {
    const want = relativeAudioPath(id.book, id.chapter, format);
    if (!m.files.some(f => f.path === want)) return { ok: false, reason: `no ${format} file` };
  }
  for (const f of m.files) {
    try {
      const s = await stat(join(revDir(layout), f.path));
      if (s.size !== f.bytes) return { ok: false, reason: `${f.path} has the wrong size` };
    } catch {
      return { ok: false, reason: `${f.path} is missing` };
    }
  }
  return { ok: true, manifest: m };
}
