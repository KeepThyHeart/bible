/**
 * The default `IAudioLocator`: the URL scheme of the published audio tree.
 *
 *   {base}/v1/{module}/index.json
 *   {base}/v1/{module}/{narrator}/{rev}/{book}/{ccc}.json      (chapter manifest, immutable)
 *   {base}/v1/{module}/{narrator}/{rev}/{book}/{ccc}.ogg|.mp3  (audio, immutable, Range)
 *
 * `base` is `/audio` (this site, which serves or proxies the tree) or an https
 * origin the operator opted in to. A different host or layout is a different
 * `IAudioLocator`; nothing else in the app builds an audio URL.
 */

import type { ChapterManifest, ChapterRef, IAudioLocator, ManifestFile } from '@bible/core/browser';

const seg = (s: string | number): string => encodeURIComponent(String(s));

export class CdnAudioLocator implements IAudioLocator {
  private readonly base: string;

  /** `base` is used as given, without a trailing slash. */
  constructor(base: string) {
    this.base = base.replace(/\/+$/, '');
  }

  indexUrl(moduleAbbr: string): string {
    return `${this.base}/v1/${seg(moduleAbbr)}/index.json`;
  }

  manifestUrl(ref: ChapterRef, narratorId: string, rev: string): string {
    const ccc = String(ref.chapter).padStart(3, '0');
    return `${this.base}/v1/${seg(ref.moduleAbbr)}/${seg(narratorId)}/${seg(rev)}/${ref.book}/${ccc}.json`;
  }

  fileUrl(manifest: ChapterManifest, file: ManifestFile): string {
    // `path` is validated as relative and free of `..`; encode each segment anyway.
    const path = file.path.split('/').map(seg).join('/');
    return `${this.base}/v1/${seg(manifest.module)}/${seg(manifest.narrator)}/${seg(manifest.rev)}/${path}`;
  }
}
