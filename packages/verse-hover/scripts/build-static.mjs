// Node twin of `php verse-hover.php build-static`. Output is byte-identical to the PHP generator.
// node scripts/build-static.mjs --db=bible_kjv.db --out=bible-data [--gzip] [--no-plain] [--no-formatting] [--force-license]
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const WS = new RegExp('[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+');
const ABBR_RE = /^[A-Za-z0-9_-]{1,16}$/;

/** Same logic as vh_license_allowed() in php/verse-hover.php. */
export function licenseAllowed(spdx) {
  const s = String(spdx ?? '').trim().toLowerCase();
  if (s === '') return false;
  if (/(^|[^a-z0-9])nc($|[^a-z0-9])/.test(s)) return false;
  const flat = s.replace(/[-_\s]+/g, ' ').trim();
  if (flat.includes('public domain')) return true;
  const allow = ['public domain', 'pd', 'cc0', 'cc-by-4.0', 'cc-by-sa', 'gpl', 'lgpl', 'mit', 'apache', 'unlicense', 'cc-by-3.0'];
  const esc = (a) => a.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
  return allow.some((a) => new RegExp('(^|[^a-z0-9])' + esc(a) + '($|[^a-z0-9])').test(s));
}

function verse(text, formatting, withFormatting) {
  let heading = null;
  let para = false;
  let spans = [];
  if (typeof formatting === 'string' && formatting !== '') {
    let fd = null;
    try { fd = JSON.parse(formatting); } catch { fd = null; }
    if (fd && typeof fd === 'object' && !Array.isArray(fd)) {
      const b = fd.block;
      if (b && typeof b === 'object' && !Array.isArray(b)) {
        if (typeof b.heading === 'string' && b.heading !== '') heading = b.heading;
        if (b.paragraph_start === true) para = true;
      }
      if (Array.isArray(fd.spans)) spans = fd.spans;
    }
  }
  if (!withFormatting || spans.length === 0) return [text, heading, para];
  const w = text.split(WS).filter(Boolean);
  const n = w.length;
  const cls = new Array(n).fill('');
  for (const s of spans) {
    if (!s || typeof s !== 'object' || typeof s.type !== 'string' || s.type === ''
      || !Number.isInteger(s.start) || !Number.isInteger(s.end)) continue;
    const c = s.type[0];
    for (let i = Math.max(s.start, 0); i <= s.end && i < n; i++) cls[i] += c;
  }
  const segs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const t = (i ? ' ' : '') + w[i];
    if (cls[i] !== '') {
      if (cur !== null && segs[cur][0] === cls[i]) segs[cur][1] += t;
      else { segs.push([cls[i], t]); cur = segs.length - 1; }
    } else {
      const last = segs.length - 1;
      if (last >= 0 && typeof segs[last] === 'string') segs[last] += t;
      else segs.push(t);
      cur = null;
    }
  }
  return [segs, heading, para];
}

function slice(k, rows, n, withFormatting) {
  const v = [];
  const h = {};
  let hasH = false;
  const p = [];
  let first = 0;
  rows.forEach((r, idx) => {
    const num = r.verse_id % 1000;
    if (idx === 0) first = num;
    const [val, heading, para] = verse(String(r.text), r.formatting, withFormatting);
    v.push(val);
    if (heading !== null) { h[num] = heading; hasH = true; }
    if (withFormatting && para) p.push(num);
  });
  const o = { k, f: first, v, n };
  if (hasH) o.h = h;
  if (p.length) o.p = p;
  return o;
}

function manifest(m, counts) {
  return {
    abbr: String(m.abbreviation), name: String(m.full_name), lang: String(m.language_code), dir: String(m.text_direction),
    copyright: m.copyright === null ? null : String(m.copyright),
    license: m.license_spdx === null ? null : String(m.license_spdx),
    versification: String(m.versification),
    sha: m.content_sha256 === null ? null : String(m.content_sha256),
    counts,
  };
}

export function buildStatic(dbPath, outDir, opt = {}) {
  const gzip = !!opt.gzip;
  const plain = !opt['no-plain'];
  const fmt = !opt['no-formatting'];
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const meta = db.prepare('SELECT abbreviation, full_name, language_code, text_direction, copyright, license_spdx, versification, content_sha256 FROM module_info LIMIT 1').get();
  if (!meta) throw new Error('module_info is empty');
  const abbr = String(meta.abbreviation);
  if (!ABBR_RE.test(abbr)) throw new Error('Unsafe abbreviation: ' + abbr);
  const stats = { abbr, files: 0, bytes: 0, gzbytes: 0 };
  const dir = outDir.replace(/[\\/]+$/, '') + '/' + abbr;
  const write = (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    if (plain) { writeFileSync(path, data); stats.files++; stats.bytes += Buffer.byteLength(data); }
    if (gzip) {
      const gz = gzipSync(data, { level: 9 });
      writeFileSync(path + '.gz', gz); stats.files++; stats.gzbytes += gz.length;
    }
  };
  const sel = db.prepare('SELECT verse_id, text, formatting FROM bible_verse WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id');
  for (let b = 1; b <= 66; b++) {
    const groups = new Map();
    for (const r of sel.all(b * 1000000, b * 1000000 + 999999)) {
      const k = Math.floor(r.verse_id / 1000);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const [k, grp] of groups) write(`${dir}/${b}/${k % 1000}.json`, JSON.stringify(slice(k, grp, grp.length, fmt)));
  }
  const counts = Array.from({ length: 66 }, () => []);
  for (const r of db.prepare('SELECT verse_id / 1000 AS k, COUNT(*) AS n FROM bible_verse GROUP BY k ORDER BY k').all()) {
    const b = Math.floor(r.k / 1000), c = r.k % 1000;
    if (b < 1 || b > 66 || c < 1) continue;
    const a = counts[b - 1];
    for (let i = a.length; i < c; i++) a[i] = 0;
    a[c - 1] = r.n;
  }
  mkdirSync(dir, { recursive: true });
  const mf = JSON.stringify(manifest(meta, counts));
  writeFileSync(dir + '/manifest.json', mf);
  stats.files++; stats.bytes += Buffer.byteLength(mf);
  const indexPath = outDir.replace(/[\\/]+$/, '') + '/index.json';
  let index = [];
  if (existsSync(indexPath)) {
    try {
      const old = JSON.parse(readFileSync(indexPath, 'utf8'));
      if (Array.isArray(old)) {
        for (const e of old) {
          if (e && typeof e === 'object' && 'abbr' in e && 'name' in e && 'lang' in e && e.abbr !== abbr) {
            index.push({ abbr: String(e.abbr), name: String(e.name), lang: String(e.lang) });
          }
        }
      }
    } catch { /* ignore */ }
  }
  index.push({ abbr, name: String(meta.full_name), lang: String(meta.language_code) });
  index.sort((a, b) => (a.abbr < b.abbr ? -1 : a.abbr > b.abbr ? 1 : 0));
  writeFileSync(indexPath, JSON.stringify(index));
  stats.files++;
  db.close();
  return stats;
}

function main(argv) {
  const o = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(a);
    if (!m) { console.error('Unexpected argument: ' + a); return 1; }
    o[m[1]] = m[2] === undefined ? true : m[2];
  }
  const usage = 'Usage: node scripts/build-static.mjs --db=FILE --out=DIR [--gzip] [--no-plain] [--no-formatting] [--force-license]';
  if (typeof o.db !== 'string' || !o.db || typeof o.out !== 'string' || !o.out) { console.error(usage); return 1; }
  if (o['no-plain'] && !o.gzip) { console.error('--no-plain requires --gzip'); return 1; }
  try {
    const db = new Database(o.db, { readonly: true, fileMustExist: true });
    const m = db.prepare('SELECT license_spdx FROM module_info LIMIT 1').get();
    db.close();
    if (!licenseAllowed(m && m.license_spdx) && !o['force-license']) {
      console.error(`Refusing to build: license "${m && m.license_spdx != null ? m.license_spdx : ''}" is not public domain or open. Use --force-license only if you have the right to publish this text.`);
      return 2;
    }
    const s = buildStatic(o.db, o.out, o);
    console.log(`${s.abbr}: ${s.files} files, ${s.bytes} bytes plain${o.gzip ? `, ${s.gzbytes} bytes gzip` : ''}`);
    return 0;
  } catch (e) {
    console.error('Error: ' + e.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
