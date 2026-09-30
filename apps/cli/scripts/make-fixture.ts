/**
 * Build a minimal module-shaped SQLite file for the compile probe to open.
 *
 * CI has no module library, and shipping a real one as a fixture would mean
 * committing tens of megabytes. This writes just enough for `src/smoke.ts` to
 * exercise the two things it cares about: that `bun:sqlite` opens a file
 * read-only, and that an FTS5 `MATCH` runs.
 *
 * It is not a substitute for a real module and nothing else should read it.
 *
 * Run:  bun run scripts/make-fixture.ts <out.db>
 */
import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';

const out = process.argv[2];
if (!out) {
  process.stderr.write('usage: bun run scripts/make-fixture.ts <out.db>\n');
  process.exit(2);
}

rmSync(out, { force: true });

const db = new Database(out, { create: true });
db.run('CREATE VIRTUAL TABLE bible_verse_fts USING fts5(text_plain)');
db.run("INSERT INTO bible_verse_fts (text_plain) VALUES ('Now faith is the substance of things hoped for')");
db.run("INSERT INTO bible_verse_fts (text_plain) VALUES ('For we walk by faith, not by sight')");
db.close();

process.stdout.write(`wrote ${out}\n`);
