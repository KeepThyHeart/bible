/**
 * Hash ownership. The URL hash belongs to Study only while Study is the
 * committed active app; otherwise it belongs to the host (e.g. `#/@present`).
 * While Study does not own it, Study's would-be reader hash is remembered here
 * so Back can restore it. Zero imports: safe in the entry chunk.
 */
let studyOwns = true;
let pending: string | null = null;

export function studyOwnsHash(): boolean {
  return studyOwns;
}

export function setStudyOwnsHash(owns: boolean): void {
  studyOwns = owns;
}

/** Record the reader hash Study would have written. */
export function noteStudyHash(hash: string): void {
  pending = hash;
}

/** Return and clear the remembered reader hash. */
export function takeStudyHash(): string | null {
  const h = pending;
  pending = null;
  return h;
}

let homeProbe: (() => boolean) | null = null;

/** Study registers how to ask whether its home screen (no passage) is showing. */
export function setStudyHomeProbe(probe: (() => boolean) | null): void {
  homeProbe = probe;
}

/** Is Study's home screen showing? Then the reader URL names no passage. */
export function studyShowsHome(): boolean {
  return homeProbe?.() ?? false;
}
