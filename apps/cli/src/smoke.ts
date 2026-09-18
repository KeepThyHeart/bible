/**
 * Compile probe for the single-file build.
 *
 * The point of building the executable before anything is written into it is
 * to find out whether `bun build --compile` survives the three things the real
 * app depends on. A hello-world binary proves none of them:
 *
 *   1. `@bible/core` loads — the barrel pulls the whole Data layer, so if this
 *      import resolves under `--compile`, every later import does.
 *   2. `bun:sqlite` opens a real module read-only and FTS5 MATCH works.
 *   3. An embedded asset survives compilation and is readable from the binary,
 *      which is how the trimmed KJV is shipped.
 *
 * This is a probe, not a deliverable. `BunSql implements ISql` belongs to
 * `data/BunSql.ts` and is deliberately not written here; this file talks to `bun:sqlite`
 * directly so it cannot pre-empt that design.
 *
 * Run:  bun run src/smoke.ts [path-to-module.db]
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { VerseIdHelper } from '@bible/core';

import probeAsset from './assets/embed-probe.txt' with { type: 'file' };
import { VERSION } from './version';

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

/** 1. `@bible/core` resolves and its pure helpers work. */
function checkCore(): void {
  try {
    const john316 = VerseIdHelper.calculate(43, 3, 16);
    const parsed = VerseIdHelper.parse(john316);
    const ok =
      john316 === 43003016 &&
      parsed.bookNumber === 43 &&
      parsed.chapter === 3 &&
      parsed.verse === 16;
    record('@bible/core loads', ok, `VerseIdHelper.calculate(43,3,16) = ${john316}`);
  } catch (e) {
    record('@bible/core loads', false, String(e));
  }
}

/** 3. An embedded file is readable from inside the compiled executable. */
async function checkEmbeddedAsset(): Promise<void> {
  try {
    const text = (await Bun.file(probeAsset).text()).trim();
    record('embedded asset', text === 'embed-probe-ok', `read ${text.length} bytes: "${text}"`);
  } catch (e) {
    record('embedded asset', false, String(e));
  }
}

/**
 * 2. `bun:sqlite` opens a module read-only and runs an FTS5 query.
 *
 * Module discovery is `data/modules.ts`'s job; this takes an explicit path, falling back
 * to the checkout's `data/modules` only so the probe is runnable from a checkout.
 *
 * The fallback resolves against `import.meta.dir`, which inside a compiled
 * binary points into the embedded virtual filesystem rather than at the
 * checkout — so it correctly finds nothing there. That is worth knowing: a
 * compiled `bible` cannot reach a data file by a path relative to itself.
 * The build must *embed* the trimmed KJV, and discovery must resolve every other
 * module from an absolute path it discovers at runtime.
 */
function resolveProbeDb(argPath: string | undefined): string | undefined {
  if (argPath) return existsSync(argPath) ? argPath : undefined;

  const fallback = join(
    import.meta.dir,
    '..',
    '..',
    '..',
    'data',
    'modules',
    'bible_kjv.db',
  );
  return existsSync(fallback) ? fallback : undefined;
}

function checkSqlite(dbPath: string): void {
  let db: Database | undefined;
  try {
    // Read-only, and never create. DesignSpec §3.2: module trees are never written to.
    db = new Database(dbPath, { readonly: true, create: false });

    const version = db
      .query<{ v: string }, []>('SELECT sqlite_version() AS v')
      .get();
    record('bun:sqlite opens read-only', true, `SQLite ${version?.v ?? '?'} — ${dbPath}`);

    // Find the FTS5 table from the schema rather than assuming a name; the
    // module format has both a v1 and a v2 shape.
    const fts = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%fts5%' ORDER BY name",
      )
      .all();

    if (fts.length === 0) {
      record('FTS5 MATCH', false, 'no fts5 table in this module');
      return;
    }

    const table = fts[0]!.name;
    // Identifiers cannot be bound as parameters. This one comes from
    // sqlite_master, not from user input, and is checked against a strict
    // identifier pattern before interpolation.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      record('FTS5 MATCH', false, `refusing to interpolate table name "${table}"`);
      return;
    }

    const hits = db
      .query<{ n: number }, [string]>(
        `SELECT count(*) AS n FROM "${table}" WHERE "${table}" MATCH ?`,
      )
      .get('faith');

    record(
      'FTS5 MATCH',
      typeof hits?.n === 'number' && hits.n > 0,
      `${table} MATCH 'faith' → ${hits?.n ?? 0} rows`,
    );
  } catch (e) {
    record('bun:sqlite', false, String(e));
  } finally {
    db?.close();
  }
}

async function main(): Promise<number> {
  process.stdout.write(`bible compile probe — v${VERSION}\n`);
  process.stdout.write(`  bun      ${Bun.version}\n`);
  // In a compiled binary `Bun.main` is a path inside the embedded virtual
  // filesystem: `/$bunfs/...` on POSIX, `B:/~BUN/...` on Windows. Testing for
  // those prefixes is the check; `existsSync` is not, because Bun's virtual
  // filesystem answers it truthfully for paths that are not on disk.
  const compiled = /^(\/\$bunfs\/|B:[\\/]~BUN[\\/])/i.test(Bun.main);
  process.stdout.write(`  compiled ${compiled ? 'yes' : 'no'}\n\n`);

  checkCore();
  await checkEmbeddedAsset();

  const dbPath = resolveProbeDb(process.argv[2]);
  if (dbPath) {
    checkSqlite(dbPath);
  } else {
    record('bun:sqlite', false, 'no module .db found — pass one as the first argument');
  }

  for (const c of checks) {
    process.stdout.write(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(28)} ${c.detail}\n`);
  }

  const failed = checks.filter((c) => !c.ok).length;
  process.stdout.write(
    `\n${checks.length - failed}/${checks.length} checks passed\n`,
  );
  return failed === 0 ? 0 : 1;
}

process.exit(await main());
