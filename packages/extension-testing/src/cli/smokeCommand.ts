/**
 * `smoke` subcommand — runs the smoke-test suite against an extension root
 * and prints a report. Exported as a pure async function so tests can call
 * it without spawning a subprocess; the `bin` shim binds `process.*`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createSmokeHarness,
  formatJson,
  formatPretty,
  mergeCorpus,
  runSmokeSuite,
  validateUserCorpus,
  DEFAULT_CORPUS,
  CorpusValidationError,
  type SmokeCorpus,
  type UserCorpusFile,
} from '../smoke';
import { ManifestLoadError } from '../smoke/loadManifest';
import { FlagParseError, parseFlags } from './parseFlags';

export interface SmokeCommandContext {
  cwd: string;
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  writeFile: (path: string, contents: string) => Promise<void> | void;
}

export const SMOKE_HELP = `Usage: bible-ext smoke [path] [options]

Run the smoke-test suite against an extension.

Arguments:
  path                    Path to the extension root (default: cwd)

Options:
  --json                  Emit machine-readable JSON envelope instead of pretty report
  --ascii                 Pretty-print without unicode glyphs
  --include-values        Include inputValue/returnValue in JSON output
  --timeout=<ms>          Default per-hook timeout (default: 2000)
  --corpus=<path>         User corpus file (default: <ext>/smoke.corpus.json if present)
  --output=<path>         Write report to file instead of stdout
  -h, --help              Show this help

Exit codes:
  0   all hook invocations passed (or only skipped)
  1   at least one failure, or a setup error
`;

export async function runSmokeCommand(
  argv: readonly string[],
  ctx: SmokeCommandContext,
): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(argv, {
      stringFlags: ['timeout', 'corpus', 'output'],
      booleanFlags: ['json', 'ascii', 'include-values', 'help'],
      aliases: { h: 'help' },
    });
  } catch (err) {
    ctx.stderr(`${(err as FlagParseError).message}\n`);
    ctx.stderr(SMOKE_HELP);
    return 1;
  }

  if (parsed.flags['help']) {
    ctx.stdout(SMOKE_HELP);
    return 0;
  }

  if (parsed.positional.length > 1) {
    ctx.stderr(`smoke: expected at most one path argument, got ${parsed.positional.length}\n`);
    return 1;
  }

  const extensionRoot = resolve(ctx.cwd, parsed.positional[0] ?? '.');
  const timeoutRaw = parsed.flags['timeout'];
  let timeoutMs = 2000;
  if (typeof timeoutRaw === 'string') {
    const n = Number(timeoutRaw);
    if (!Number.isFinite(n) || n <= 0) {
      ctx.stderr(`smoke: --timeout must be a positive number, got "${timeoutRaw}"\n`);
      return 1;
    }
    timeoutMs = n;
  }

  const useJson = parsed.flags['json'] === true;
  const ascii = parsed.flags['ascii'] === true;
  const includeValues = parsed.flags['include-values'] === true;
  const outputPath = typeof parsed.flags['output'] === 'string'
    ? resolve(ctx.cwd, parsed.flags['output'] as string)
    : undefined;

  let corpus: SmokeCorpus = DEFAULT_CORPUS;
  try {
    corpus = loadCorpus(extensionRoot, parsed.flags['corpus'], ctx.cwd);
  } catch (err) {
    ctx.stderr(`smoke: ${(err as Error).message}\n`);
    return 1;
  }

  let harness;
  try {
    harness = createSmokeHarness({ extensionRoot });
  } catch (err) {
    ctx.stderr(formatSetupError(err));
    return 1;
  }

  try {
    await harness.activate();
  } catch (err) {
    ctx.stderr(`smoke: extension activate() failed: ${(err as Error).message}\n`);
    return 1;
  }

  let result;
  try {
    result = await runSmokeSuite({ harness, corpus, timeoutMs });
  } catch (err) {
    ctx.stderr(`smoke: suite execution failed: ${(err as Error).message}\n`);
    await safeDeactivate(harness);
    return 1;
  }
  await safeDeactivate(harness);

  const output = useJson
    ? formatJson(result, { includeValues })
    : formatPretty(result, { ascii });

  if (outputPath) {
    try {
      await ctx.writeFile(outputPath, output.endsWith('\n') ? output : `${output}\n`);
    } catch (err) {
      ctx.stderr(`smoke: could not write --output file: ${(err as Error).message}\n`);
      return 1;
    }
  } else {
    ctx.stdout(output.endsWith('\n') ? output : `${output}\n`);
  }

  return result.totals.failed > 0 ? 1 : 0;
}

function loadCorpus(
  extensionRoot: string,
  corpusFlag: string | boolean | undefined,
  cwd: string,
): SmokeCorpus {
  let corpusPath: string | undefined;
  let required = false;
  if (typeof corpusFlag === 'string') {
    corpusPath = resolve(cwd, corpusFlag);
    required = true;
  } else {
    const defaultPath = resolve(extensionRoot, 'smoke.corpus.json');
    if (existsSync(defaultPath)) corpusPath = defaultPath;
  }
  if (!corpusPath) return DEFAULT_CORPUS;

  if (!existsSync(corpusPath)) {
    if (required) {
      throw new Error(`corpus file not found: ${corpusPath}`);
    }
    return DEFAULT_CORPUS;
  }

  let raw: string;
  try {
    raw = readFileSync(corpusPath, 'utf8');
  } catch (err) {
    throw new Error(`could not read corpus file ${corpusPath}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in corpus file ${corpusPath}: ${(err as Error).message}`);
  }
  let user: UserCorpusFile;
  try {
    user = validateUserCorpus(parsed);
  } catch (err) {
    if (err instanceof CorpusValidationError) {
      const where = err.message;
      throw new Error(`invalid corpus file ${corpusPath}: ${where}`);
    }
    throw err;
  }
  return mergeCorpus(DEFAULT_CORPUS, user);
}

function formatSetupError(err: unknown): string {
  if (err instanceof ManifestLoadError) {
    return `smoke: ${err.message}\n`;
  }
  return `smoke: ${(err as Error).message}\n`;
}

async function safeDeactivate(harness: { deactivate: () => Promise<void> }): Promise<void> {
  try {
    await harness.deactivate();
  } catch {
    // Deactivation errors are non-fatal for the report.
  }
}
