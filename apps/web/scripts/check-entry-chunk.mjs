// Fails when the entry chunk's static import graph contains a module that must
// stay lazy. Reads dist/.vite/chunk-report.json (written by build/chunkReport.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export const FORBIDDEN = [
  /^src\/apps\//,
  /^src\/DesktopApp\.tsx$/,
  /^src\/MobileApp\.tsx$/,
  /^src\/stores\/(bible|search|commentary|study|dictionary|follow|present)Store\.ts$/,
];

/** @returns {{ok: boolean, entry: string|null, offenders: {chunk: string, module: string}[], error?: string}} */
export function checkReport(report) {
  const chunks = report.chunks ?? [];
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const entry = chunks.find((c) => c.isEntry && c.facadeModuleId && c.facadeModuleId.endsWith('index.html'));
  if (!entry) return { ok: false, entry: null, offenders: [], error: 'no entry chunk (facade index.html) in report' };
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
      if (FORBIDDEN.some((re) => re.test(m))) offenders.push({ chunk: f, module: m });
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
  console.log(`check-entry-chunk OK (entry ${r.entry})`);
}
