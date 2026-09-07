/**
 * Warms the e2e server before the first spec runs.
 *
 * Opening a module database is lazy and the first read of a chapter faults tens
 * of MB of SQLite off disk. With the workers all starting at once, that cost
 * used to land inside whichever tests ran first, failing them on timeouts that
 * had nothing to do with what they were testing and passing on the next run.
 *
 * Unlike `prepareData.ts`, this can talk to the server: `webServer` is started
 * during plugin setup, which finishes before global setup begins.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'http://localhost:3100';

interface FixtureConfig {
  modules?: { bibles?: { modules?: Record<string, { active: boolean }> } };
}

/** Bible abbreviations the fixture config makes visible. */
function activeBibles(): string[] {
  const fixturePath = join(import.meta.dirname, 'fixtures', 'site-config.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as FixtureConfig;
  return Object.entries(fixture.modules?.bibles?.modules ?? {})
    .filter(([, entry]) => entry.active)
    .map(([abbr]) => abbr);
}

/** Request a URL and discard the body; a failure here is not worth failing the run over. */
async function warm(path: string): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    await res.arrayBuffer();
  } catch {
    // The specs themselves will report the problem far more clearly.
  }
}

export default async function globalSetup(): Promise<void> {
  const bibles = activeBibles();

  await warm('/api/modules');
  await warm('/api/books');

  // Genesis 1 is what every spec lands on, John 1 and 3 are where they navigate.
  // Workers start together, so an unwarmed first read is one queue every test in
  // the opening wave waits behind.
  const CHAPTERS: Array<[number, number]> = [[1, 1], [43, 1], [43, 3]];

  for (const abbr of bibles) {
    for (const [book, chapter] of CHAPTERS) {
      await warm(`/api/bible/${abbr}/${book}/${chapter}`);
    }
  }

  // The right pane asks for these as soon as a chapter is on screen.
  for (const [book, chapter] of CHAPTERS) {
    await warm(`/api/commentary/availability/${book}/${chapter}`);
    await warm(`/api/study/overview/${book}/${chapter}`);
  }
}
