import type { Ref } from './types';

/** Compact id kept in data-vh-ref: book*1e6+chapter*1e3+verse, or book*1e3+chapter for a whole chapter. */
export function encodeRef(r: Ref): string {
  const id = (c: number, v?: number) => (v === undefined ? r.book * 1e3 + c : r.book * 1e6 + c * 1e3 + v);
  const a = id(r.chapter, r.verse);
  const eC = r.endChapter ?? r.chapter;
  const b = r.endVerse !== undefined ? id(eC, r.endVerse) : r.endChapter !== undefined ? id(eC, r.verse === undefined ? undefined : 999) : a;
  return a === b ? '' + a : `${a}-${b}`;
}

function one(n: number): { book: number; chapter: number; verse?: number } {
  return n < 1e6 ? { book: Math.floor(n / 1e3), chapter: n % 1e3 } : { book: Math.floor(n / 1e6), chapter: Math.floor((n % 1e6) / 1e3), verse: n % 1e3 };
}

export function decodeRef(s: string): Ref | null {
  const m = /^(\d{4,8})(?:-(\d{4,8}))?$/.exec(s.trim());
  if (!m) return null;
  const a = one(+m[1]);
  const r: Ref = { book: a.book, chapter: a.chapter, start: 0, end: 0, score: 100 };
  if (a.verse !== undefined) r.verse = a.verse;
  if (m[2]) {
    const b = one(+m[2]);
    if (b.book === a.book) {
      if (b.chapter !== a.chapter) r.endChapter = b.chapter;
      if (b.verse !== undefined && !(b.verse === 999 && a.verse === undefined)) r.endVerse = b.verse;
    }
  }
  return r.book >= 1 && r.book <= 66 ? r : null;
}

export function refText(r: Ref, book: string): string {
  const v = (c: number, x?: number) => (x === undefined ? '' + c : `${c}:${x}`);
  let s = `${book} ${v(r.chapter, r.verse)}`;
  if (r.endChapter !== undefined) s += `–${v(r.endChapter, r.endVerse === 999 ? undefined : r.endVerse)}`;
  else if (r.endVerse !== undefined) s += `–${r.endVerse}`;
  return s;
}

/** Placeholders for linkUrl; every value is URL-encoded and only http(s) or relative URLs survive. */
export function linkFor(tpl: string | undefined, r: Ref, tr: string, bookName: string, text: string): string | null {
  if (!tpl) return null;
  const vals: Record<string, unknown> = {
    version: tr, book: r.book, bookName, chapter: r.chapter, verse: r.verse ?? '',
    endChapter: r.endChapter ?? '', endVerse: r.endVerse === 999 ? '' : r.endVerse ?? '', ref: text,
  };
  const out = tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(vals[k] ?? '')));
  try {
    const u = new URL(out, location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? out : null;
  } catch {
    return null;
  }
}
