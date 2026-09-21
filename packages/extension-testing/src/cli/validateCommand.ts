/**
 * `validate` subcommand — checks an `extension.json` and the files it points
 * at, without launching a realm.
 *
 * `smoke` already loads the manifest, but it does so on the way to running
 * hooks: an author with a malformed manifest gets a setup error from a command
 * whose job is something else, and an author who only wants to know "is this
 * shippable" pays for a realm boot. Separating them also gives CI a cheap
 * always-run gate — this needs no WASM and no corpus.
 */

import { resolve } from 'node:path';
import { loadManifest, ManifestLoadError } from '../smoke/loadManifest';
import { checkManifestAssets, type AssetIssue } from './manifestAssets';
import { FlagParseError, parseFlags } from './parseFlags';
import type { SmokeCommandContext } from './smokeCommand';

export const VALIDATE_HELP = `Usage: bible-ext validate [path] [options]

Validate an extension manifest and the files it references.

Arguments:
  path                    Path to the extension root (default: cwd)

Options:
  --json                  Emit machine-readable JSON instead of a pretty report
  --skip-assets           Validate the manifest only; do not check that
                          main/icon/uiEntry files exist on disk
  -h, --help              Show this help

Exit codes:
  0   manifest is valid and every referenced file exists
  1   validation failed, or the manifest could not be read
`;

interface ValidateReport {
  ok: boolean;
  extensionRoot: string;
  /** Present only when the manifest parsed and validated. */
  id?: string;
  version?: string;
  manifestErrors: { path: string; code: string; message: string }[];
  assetIssues: AssetIssue[];
}

function emit(ctx: SmokeCommandContext, report: ValidateReport, asJson: boolean): void {
  if (asJson) {
    ctx.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (report.ok) {
    ctx.stdout(`OK  ${report.id}@${report.version}\n`);
    ctx.stdout(`    ${report.extensionRoot}\n`);
    return;
  }

  ctx.stderr(`FAIL  ${report.extensionRoot}\n`);
  if (report.manifestErrors.length > 0) {
    ctx.stderr(`\nManifest (${report.manifestErrors.length}):\n`);
    for (const e of report.manifestErrors) {
      ctx.stderr(`  ${e.path || '/'}  ${e.message}  [${e.code}]\n`);
    }
  }
  if (report.assetIssues.length > 0) {
    ctx.stderr(`\nReferenced files (${report.assetIssues.length}):\n`);
    for (const e of report.assetIssues) {
      ctx.stderr(`  ${e.path}  ${e.message}  [${e.code}]\n`);
    }
  }
  ctx.stderr('\n');
}

export function runValidateCommand(
  argv: readonly string[],
  ctx: SmokeCommandContext,
): number {
  let parsed;
  try {
    parsed = parseFlags(argv, {
      stringFlags: [],
      booleanFlags: ['json', 'skip-assets', 'help'],
      aliases: { h: 'help' },
    });
  } catch (err) {
    ctx.stderr(`${(err as FlagParseError).message}\n`);
    ctx.stderr(VALIDATE_HELP);
    return 1;
  }

  if (parsed.flags['help']) {
    ctx.stdout(VALIDATE_HELP);
    return 0;
  }

  if (parsed.positional.length > 1) {
    ctx.stderr(`validate: expected at most one path argument, got ${parsed.positional.length}\n`);
    return 1;
  }

  const asJson = parsed.flags['json'] === true;
  const extensionRoot = resolve(ctx.cwd, parsed.positional[0] ?? '.');

  let loaded;
  try {
    loaded = loadManifest(extensionRoot);
  } catch (err) {
    const errors =
      err instanceof ManifestLoadError && err.errors.length > 0
        ? err.errors
        : // A read or JSON-parse failure carries no per-field errors; the
          // message is the whole diagnosis, so it becomes the single entry
          // rather than being dropped in favour of an empty list.
          [{ path: '', code: 'manifest.unreadable', message: (err as Error).message }];
    emit(ctx, { ok: false, extensionRoot, manifestErrors: errors, assetIssues: [] }, asJson);
    return 1;
  }

  const assetIssues = parsed.flags['skip-assets']
    ? []
    : checkManifestAssets(loaded.manifest, loaded.extensionRoot);

  const report: ValidateReport = {
    ok: assetIssues.length === 0,
    extensionRoot: loaded.extensionRoot,
    id: loaded.manifest.id,
    version: loaded.manifest.version,
    manifestErrors: [],
    assetIssues,
  };
  emit(ctx, report, asJson);
  return report.ok ? 0 : 1;
}
