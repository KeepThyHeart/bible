/**
 * The content tool: check authored files, import them, and say what the
 * library now holds.
 *
 * Content is the part of this project a person writes by hand, at length, often
 * late, and the failure it must never have is the quiet one — a file that
 * imports without complaint and puts a broken question, or a reference to a
 * verse the module does not carry, on a screen in front of a group.
 *
 * So `check` is a first-class verb rather than a flag. It imports into a
 * throwaway in-memory database, which means it runs exactly the validation the
 * real import runs, sees exactly the pool the real import would produce, and
 * cannot touch the content database whatever it finds. It then does the one
 * thing the importer itself cannot: it opens the installed Bible module and
 * confirms every curated verse exists there and is long enough to ask about.
 * The importer is module-blind on purpose — authored content outlives any one
 * translation — so that check belongs out here.
 *
 * After the import, every check and import runs the content validator over
 * what the database now holds: quotations against the verses they cite, clues
 * and prompts that give their answer away, wrong answers the matcher would
 * credit. The importer judges a row's shape; the validator judges whether it
 * is true.
 *
 * `generate` rebuilds the questions in `content/generated/` from the facts in
 * `content/source/`. It writes nothing at all if any source item is unusable,
 * because a generator that silently drops a saying produces a batch that looks
 * complete and is not.
 *
 * Exit codes matter: anything rejected exits non-zero, so this can gate a
 * deployment rather than merely inform one.
 *
 * Usage:
 *   pnpm --filter @bible/web run games:content -- generate
 *   pnpm --filter @bible/web run games:content -- check  <file or directory...>
 *   pnpm --filter @bible/web run games:content -- import <file or directory...>
 *   pnpm --filter @bible/web run games:content -- stats
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  ContentLibrary,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  formatImportReport,
  importContent,
  importCsv,
} from '../content/index.js';
import type { ImportReport } from '../content/index.js';
import { generate } from '../content/generator/generate.js';
import { readSources } from '../content/generator/sources.js';
import type { RawSources } from '../content/generator/sources.js';
import { formatFindings, validateContent } from '../content/validate.js';
import { formatRef } from '../../../../src/modules/games/shared/verseId.js';

/** A verse this short is a memory test, not a question. Matches the games' floor. */
const MIN_POOL_WORDS = 8;

/** Where the generator reads its facts, and where it writes the questions made from them. */
const CONTENT_SRC = join(import.meta.dirname, '..', 'content-src');
const SOURCE_DIR = join(CONTENT_SRC, 'source');
const GENERATED_DIR = join(CONTENT_SRC, 'generated');

/** One file per list, each holding a key of the same name: `people.json` holds `people`. */
const SOURCE_LISTS = ['people', 'places', 'sayings', 'timelines', 'board'] as const;

function usage(): never {
  console.error(
    [
      'Usage:',
      '  pnpm --filter @bible/web run games:content -- generate           rebuild content/generated from content/source',
      '  pnpm --filter @bible/web run games:content -- check  <path...>   validate against the module, write nothing',
      '  pnpm --filter @bible/web run games:content -- import <path...>   validate, then write',
      '  pnpm --filter @bible/web run games:content -- stats              what the library holds now',
      '',
      'A directory stands for the .csv and .json files directly inside it.',
    ].join('\n')
  );
  process.exit(2);
}

/**
 * Directories expanded to the content files directly inside them, in name
 * order. A shell on Windows does not expand `*.json` on an author's behalf, and
 * naming a directory is what an author means anyway.
 */
function expandPaths(paths: readonly string[]): string[] {
  return paths.flatMap((path) => {
    if (!statSync(path).isDirectory()) return [path];
    return readdirSync(path)
      .filter((name) => ['.csv', '.json'].includes(extname(name).toLowerCase()))
      .sort()
      .map((name) => join(path, name));
  });
}

function runGenerate(): number {
  const raw: RawSources = {};
  for (const name of SOURCE_LISTS) {
    const path = join(SOURCE_DIR, `${name}.json`);
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    raw[name] = parsed[name];
  }

  const { sources, problems } = readSources(raw);
  for (const problem of problems) {
    console.log(`  [${problem.kind}] ${problem.item}: ${problem.detail}`);
  }
  if (problems.length > 0) {
    console.log(`FAILED: ${problems.length} unusable items in ${SOURCE_DIR}, nothing written`);
    return 1;
  }

  mkdirSync(GENERATED_DIR, { recursive: true });
  for (const file of generate(sources)) {
    const payload = {
      _comment: `Built from ${SOURCE_DIR} by \`pnpm --filter @bible/web run games:content -- generate\`. Edit the sources, not this file.`,
      questions: file.questions,
      sets: file.sets,
      orderedLists: file.orderedLists,
    };
    writeFileSync(join(GENERATED_DIR, file.name), `${JSON.stringify(payload, null, 2)}\n`);
    console.log(
      `${file.name}: ${file.questions.length} questions, ${file.sets.length} sets, ` +
        `${file.orderedLists.length} ordered lists`
    );
  }
  console.log('ok');
  return 0;
}

/**
 * One file, read as whatever its extension says it is. A CSV of verses and a
 * CSV of questions look nothing alike, so the importer tells them apart on its
 * own rather than making an author remember a flag.
 */
function importFile(library: ContentLibrary, file: string): ImportReport {
  const text = readFileSync(file, 'utf8');
  return extname(file).toLowerCase() === '.csv'
    ? importCsv(library.db, text)
    : importContent(library.db, JSON.parse(text) as unknown);
}

/**
 * The check the importer cannot make: does this verse exist in the Bible module
 * that will be on the server, and is there enough of it to ask about?
 *
 * A missing verse is the serious one — the pool would hand a game a reference
 * it cannot show. A short verse is reported too, because it will be drawn,
 * found unusable and silently redrawn, which reads to a host as a game that
 * ignores its own settings.
 */
function moduleProblems(library: ContentLibrary): string[] {
  const module = library.translation();
  if (module === null) {
    return ['no Bible module is installed, so no reference was verified'];
  }

  const problems: string[] = [];
  for (const record of library.db.findCuratedVerses()) {
    const verse = module.verse(record.verseId);
    if (verse === null) {
      problems.push(`${formatRef(record.verseId)} is not in the ${module.info.abbreviation} module`);
      continue;
    }
    const words =
      verse.wordCount ?? verse.text.split(/\s+/u).filter((word) => word.length > 0).length;
    if (words < MIN_POOL_WORDS) {
      problems.push(`${formatRef(record.verseId)} has ${words} words, too few for most games`);
    }
  }
  return problems;
}

/**
 * The pool at a glance, by tier and by section. These are the numbers that say
 * whether curation is finished: a tier holding four verses will repeat itself
 * inside one game, and a tier that is all epistles will feel like one.
 */
function printStats(library: ContentLibrary): void {
  const verses = library.db.findCuratedVerses();
  console.log(`curated verses: ${verses.length}`);
  for (let tier = MIN_DIFFICULTY; tier <= MAX_DIFFICULTY; tier += 1) {
    const inTier = verses.filter((verse) => verse.difficulty === tier);
    if (inTier.length === 0) continue;
    const sections = new Map<string, number>();
    for (const verse of inTier) sections.set(verse.section, (sections.get(verse.section) ?? 0) + 1);
    const spread = [...sections.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([section, count]) => `${section} ${count}`)
      .join(', ');
    console.log(`  tier ${tier}: ${String(inTier.length).padStart(4)}  (${spread})`);
  }

  console.log(
    `questions: ${library.db.findQuestions().length}   ` +
      `prompt cards: ${library.db.findPromptCards().length}   ` +
      `ordered lists: ${library.db.listOrderedLists().length}`
  );
}

function run(): number {
  const [command, ...paths] = process.argv.slice(2);
  if (command === undefined) usage();
  if (command === 'generate') return runGenerate();
  if (command !== 'check' && command !== 'import' && command !== 'stats') usage();
  if (command !== 'stats' && paths.length === 0) usage();
  const files = expandPaths(paths);

  // A check builds its own library over the same modules and a database that
  // exists only for the length of this process.
  const library =
    command === 'check' ? ContentLibrary.open({ contentPath: ':memory:' }) : ContentLibrary.open();

  if (command === 'stats') {
    printStats(library);
    library.close();
    return 0;
  }

  let rejected = 0;
  for (const file of files) {
    const report = importFile(library, file);
    rejected += report.rejected.length;
    console.log(`${basename(file)}: ${formatImportReport(report)}`);
  }

  const problems = moduleProblems(library);
  for (const problem of problems) console.log(`  ${problem}`);

  const findings = validateContent(library.db, library.translation());
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  if (findings.length > 0) {
    console.log(`content checks: ${errors} errors, ${findings.length - errors} warnings`);
    console.log(formatFindings(findings));
  }

  printStats(library);
  library.close();

  const failed = rejected > 0 || problems.length > 0 || errors > 0;
  console.log(failed ? 'FAILED' : command === 'check' ? 'ok, nothing written' : 'ok');
  return failed ? 1 : 0;
}

process.exit(run());
