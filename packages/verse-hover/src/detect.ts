import type { LocalePack, Ref } from './types';

/** Single-chapter books: "Jude 5" means verse 5. */
const SINGLE = new Set([31, 57, 63, 64, 65]);

export const PRESETS = { strict: 80, normal: 60, loose: 40 };

interface Entry { book: number; full: boolean }

export interface Detector {
  detect(text: string): Ref[];
  pack: LocalePack;
}

export interface DetectOptions {
  /** Minimum score 0..100, or a preset name. Default 'normal'. */
  threshold?: number | keyof typeof PRESETS;
  /** Reject chapter-only references. */
  requireVerse?: boolean;
  /** Normalised aliases never linked. */
  ignore?: string[];
  /** Translation abbreviations recognised as a version suffix. */
  translations?: string[];
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\./g, '').replace(/\s+/g, ' ').trim();

/** Candidate: name chunk (max 5 words, optional 1/2/3 prefix), chapter, optional :verse, optional range. */
const W = "\\p{L}[\\p{L}\\p{M}.'\u2019]*";
const N = '(\\d{1,3})(?!\\d)';
const RANGE = '\\s?[-\u2013\u2014]\\s?';
const CANDIDATE = new RegExp(
  `(?<![\\p{L}\\p{N}])((?:[123]\\s?)?${W}(?:[ \u00a0]${W}){0,4})\\s?${N}` +
    `(?:\\s?:\\s?${N}(?:${RANGE}${N}(?:\\s?:\\s?${N})?)?|${RANGE}${N})?(?![\\p{L}\\p{N}%]|:\\d)`,
  'gu',
);
/** After an accepted reference: "; 6:23", ", 18", ", 18-20", "; 5". */
const CONT = new RegExp(
  `^\\s?([;,])\\s?${N}(?:\\s?:\\s?${N}(?:${RANGE}${N})?|${RANGE}${N})?(?![\\p{L}\\p{N}%])`,
  'u',
);

export function createDetector(packs: LocalePack | LocalePack[], chapters: string, opts: DetectOptions = {}): Detector {
  const list = Array.isArray(packs) ? packs : [packs];
  const counts = chapters.split(',').map(Number);
  const thr = typeof opts.threshold === 'number' ? opts.threshold : PRESETS[opts.threshold || 'normal'] ?? 60;
  const ignore = new Set((opts.ignore || []).map(fold));
  const trs = (opts.translations || []).map((t) => t.toUpperCase());

  const maps = list.map((pack) => {
    const map = new Map<string, Entry>();
    const keys = Object.keys(pack.ord).sort((a, b) => b.length - a.length);
    const norm = (s: string) => {
      s = fold(s);
      for (const k of keys) if (s.startsWith(k + ' ')) return pack.ord[k] + s.slice(k.length + 1).replace(/\s+/g, ' ');
      return s.replace(/^([123])\s(?=\D)/, '$1');
    };
    pack.names.split('\n').forEach((line, i) => {
      const [full, abbr] = line.split('|');
      map.set(norm(pack.books[i]), { book: i + 1, full: true });
      if (full) for (const k of full.split(',')) k && map.set(k, { book: i + 1, full: true });
      if (abbr) for (const k of abbr.split(',')) k && !map.has(k) && map.set(k, { book: i + 1, full: false });
    });
    return {
      map,
      norm,
      amb: new Set(pack.ambiguous),
      units: new RegExp('^\\s?' + pack.units, 'iu'),
      cues: new RegExp(pack.cues, 'iu'),
    };
  });

  function lookup(chunk: string): { start: number; e: Entry; key: string; m: (typeof maps)[0] } | null {
    // Try the longest suffix first ("see song of solomon" -> "song of solomon"), then shorter ones.
    const starts = [0];
    for (let i = 0; i < chunk.length; i++) if (chunk[i] === ' ' || chunk[i] === '\u00a0') starts.push(i + 1);
    for (const start of starts) {
      for (const m of maps) {
        const key = m.norm(chunk.slice(start));
        const e = m.map.get(key);
        if (e) return { start, e, key, m };
      }
    }
    return null;
  }

  function version(text: string, at: number): { tr: string; end: number } | null {
    if (!trs.length) return null;
    const m = /^\s?(\(|\[)?([A-Za-z][A-Za-z0-9]{1,7})(\)|\])?/.exec(text.slice(at, at + 14));
    if (!m) return null;
    const tr = m[2].toUpperCase();
    if (!trs.includes(tr)) return null;
    if (!m[1] && m[2] !== tr) return null; // bare suffix must be written in capitals ("John 3:16 ASV")
    return { tr, end: at + m[0].length };
  }

  const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));

  function detect(text: string): Ref[] {
    const out: Ref[] = [];
    if (text.length < 3 || !/\d/.test(text)) return out;
    CANDIDATE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CANDIDATE.exec(text))) {
      const hit = lookup(m[1]);
      if (!hit) { CANDIDATE.lastIndex = m.index + 1; continue; }
      const { e, key, m: lm } = hit;
      const start = m.index + hit.start;
      const name = m[1].slice(hit.start);
      let ch = num(m[2])!;
      let v = num(m[3]);
      let ec: number | undefined;
      let ev: number | undefined;
      if (m[6] !== undefined) ec = num(m[6]); // chapter range "1-3"
      else if (m[4] !== undefined) {
        if (m[5] !== undefined) { ec = num(m[4]); ev = num(m[5]); } // "3:16-4:2"
        else ev = num(m[4]);
      }
      let end = m.index + m[0].length;
      if (lm.units.test(text.slice(end))) { CANDIDATE.lastIndex = m.index + 1; continue; }
      if (v === undefined && SINGLE.has(e.book)) { v = ch; ch = 1; if (ec !== undefined) { ev = ec; ec = undefined; } }
      if (ch < 1 || ch > counts[e.book - 1] || (ec !== undefined && (ec < ch || ec > counts[e.book - 1]))) { CANDIDATE.lastIndex = m.index + 1; continue; }
      if (ev !== undefined && ec === undefined && ev <= (v as number)) {
        ev = undefined; // descending range: link the first verse only
        end = m.index + m[0].replace(/\s?[-\u2013\u2014]\s?\d+(?:\s?:\s?\d+)?$/, '').length;
      }

      // Score.
      const base = key.replace(/^\d/, '');
      const ambiguous = lm.amb.has(base) || base.replace(/\s/g, '').length < 2;
      let s = ambiguous ? 15 : e.full ? 50 : 40;
      if (!ambiguous && !e.full && m[1].endsWith('.')) s += 5;
      s += /\p{Lu}/u.test(name) ? 10 : -25;
      s += v !== undefined ? 35 : 15;
      if (lm.cues.test(text.slice(Math.max(0, start - 14), start))) s += 10;
      if (s < thr || (opts.requireVerse && v === undefined) || ignore.has(key)) { CANDIDATE.lastIndex = m.index + 1; continue; }

      const ref: Ref = { book: e.book, chapter: ch, start, end, score: s };
      if (v !== undefined) ref.verse = v;
      if (ec !== undefined) ref.endChapter = ec;
      if (ev !== undefined) ref.endVerse = ev;
      const ver = version(text, end);
      if (ver) { ref.tr = ver.tr; ref.end = ver.end; end = ver.end; }
      out.push(ref);

      // Continuations inherit the book (and chapter): "Rom 3:23; 6:23, 25".
      let prev = ref;
      for (;;) {
        const c = CONT.exec(text.slice(end));
        if (!c) break;
        const a = num(c[2])!, b = num(c[3]), c2 = num(c[4]), r2 = num(c[5]);
        let cch: number, cv: number | undefined, cec: number | undefined, cev: number | undefined;
        if (b !== undefined) { cch = a; cv = b; cev = c2; } // "6:23" / "6:23-25"
        else if (c[1] === ',' && prev.verse !== undefined) { cch = prev.chapter; cv = a; cev = r2; } // ", 18" / ", 18-20"
        else if (c[1] === ';' || prev.verse === undefined) { if (c[1] === ',') break; cch = a; cec = r2; } // "; 6"
        else break;
        if (cch < 1 || cch > counts[e.book - 1]) break;
        const tail = text.slice(end + c[0].length);
        if (lm.units.test(tail)) break;
        if (cev !== undefined && cev <= (cv as number)) cev = undefined;
        const cr: Ref = { book: e.book, chapter: cch, start: end + c[0].search(/\d/), end: end + c[0].length, score: s };
        if (cv !== undefined) cr.verse = cv;
        if (cec !== undefined && cec > cch) cr.endChapter = cec;
        if (cev !== undefined) cr.endVerse = cev;
        out.push(cr);
        prev = cr;
        end = cr.end;
        CANDIDATE.lastIndex = end;
      }
      CANDIDATE.lastIndex = Math.max(CANDIDATE.lastIndex, end);
      if (prev === ref) CANDIDATE.lastIndex = end;
    }
    return out;
  }

  return { detect, pack: list[0] };
}
