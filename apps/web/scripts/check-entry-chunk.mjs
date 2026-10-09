// Fails when the entry chunk's static import graph contains a module that must
// stay lazy. Reads dist/.vite/chunk-report.json (written by build/chunkReport.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export const FORBIDDEN = [
  /^src\/apps\//,
  /^src\/DesktopApp\.tsx$/,
  /^src\/MobileApp\.tsx$/,
  /^src\/stores\/(bible|search|commentary|study|dictionary)Store\.ts$/,
  /^src\/offline\//,
  /^src\/search\/BrowserSearchProvider\.ts$/,
  // Feature modules: only the manifest, the binding and what the boot probe needs
  // may be in the entry; everything else loads on activation (task 0123).
  /^src\/modules\/downloads\/(?!(manifest|binding)\.ts$)/,
  /^src\/modules\/present\/(?!(manifest|binding|runtime)\.ts$|lib\/(controlLink|sessionKey)\.ts$)/,
  /^src\/modules\/(timeline|genealogy|quiz|similar|xref-graph|measures|keyword-marks)\/(?!(manifest|binding)\.ts$)/,
  /^src\/modules\/word-study\/(?!(manifest|binding)\.ts$)/,
  /^src\/modules\/audio\/(?!(manifest|binding)\.ts$)/,
  /^src\/modules\/notifications\/(?!(manifest|binding)\.ts$)/,
  // Games: only the manifest, the binding and the (import-free) runtime sink.
  /^src\/modules\/games\/(?!(manifest|binding|runtime)\.ts$)/,
];

/**
 * The Games phone page (`games/play.html`) must load no reader code: its static
 * graph may hold the games client and shared libraries, nothing of the reading
 * app (task 0115).
 */
export const PHONE_ENTRY_FORBIDDEN = [
  /^src\/apps\//,
  /^src\/DesktopApp\.tsx$/,
  /^src\/MobileApp\.tsx$/,
  /^src\/stores\//,
  /^src\/offline\//,
  /^src\/search\//,
  /^src\/host\//,
  /^src\/i18n\.ts$/,
  /^src\/modules\/(?!games\/)/,
];

/** @returns {{ok: boolean, entry: string|null, offenders: {chunk: string, module: string}[], error?: string}} */
export function checkReport(report, entryHtml = 'index.html', forbidden = FORBIDDEN) {
  const chunks = report.chunks ?? [];
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const entry = chunks.find((c) => c.isEntry && c.facadeModuleId && c.facadeModuleId.endsWith(entryHtml));
  if (!entry) return { ok: false, entry: null, offenders: [], error: `no entry chunk (facade ${entryHtml}) in report` };
  const seen = new Set();
  const offenders = [];
  const stack = [entry.fileName];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const c = byFile.get(f);
    if (!c) continue;
    for (const m of c.modules) {
      if (forbidden.some((re) => re.test(m))) offenders.push({ chunk: f, module: m });
    }
    stack.push(...(c.imports ?? []));
  }
  return { ok: offenders.length === 0, entry: entry.fileName, offenders };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const path = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../dist/.vite/chunk-report.json');
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`check-entry-chunk: cannot read ${path}: ${e.message}`);
    process.exit(2);
  }
  const r = checkReport(report);
  if (r.error) {
    console.error(`check-entry-chunk: ${r.error}`);
    process.exit(2);
  }
  if (!r.ok) {
    console.error(`check-entry-chunk FAILED: entry chunk ${r.entry} statically pulls in ${r.offenders.length} forbidden module(s):`);
    for (const o of r.offenders) console.error(`  ${o.module}  (in ${o.chunk})`);
    process.exit(1);
  }
  const phone = checkReport(report, 'games/play.html', PHONE_ENTRY_FORBIDDEN);
  if (phone.error) {
    console.error(`check-entry-chunk: ${phone.error}`);
    process.exit(2);
  }
  if (!phone.ok) {
    console.error(`check-entry-chunk FAILED: the games phone page ${phone.entry} statically pulls in ${phone.offenders.length} reader module(s):`);
    for (const o of phone.offenders) console.error(`  ${o.module}  (in ${o.chunk})`);
    process.exit(1);
  }
  console.log(`check-entry-chunk OK (entry ${r.entry}; games phone page ${phone.entry})`);
}
