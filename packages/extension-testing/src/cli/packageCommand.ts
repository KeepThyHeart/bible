/**
 * `package` subcommand — produces the `.zip` an extension is actually
 * distributed and installed as.
 *
 * The scaffold's `package` script used to be `npm run build && npm pack`, which
 * produces an *npm* tarball: a `.tgz` with everything under `package/`, shaped
 * for a registry install. Nothing in the app can install that. The host's
 * installer takes a `.zip` with `extension.json` at the root (or in a single
 * wrapper directory) - so an author following the scaffold's own script ended
 * up with an artifact that no part of this platform consumes.
 *
 * The archive is validated before it is written: manifest schema, then the
 * files the manifest references. Producing an archive that cannot activate
 * helps nobody, and the failure would otherwise surface on someone else's
 * machine at install time.
 */

import { readdirSync, readFileSync, lstatSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { createZip, type ZipEntry } from './createZip';
import { createIgnoreMatcher, parseIgnoreFile, DEFAULT_IGNORES } from './ignoreRules';
import { checkManifestAssets } from './manifestAssets';
import { loadManifest, ManifestLoadError } from '../smoke/loadManifest';
import { FlagParseError, parseFlags } from './parseFlags';
import type { SmokeCommandContext } from './smokeCommand';

export const PACKAGE_HELP = `Usage: bible-ext package [path] [options]

Build the distributable .zip for an extension.

Arguments:
  path                    Path to the extension root (default: cwd)

Options:
  --out=<dir>             Output directory (default: <path>/build)
  --json                  Emit machine-readable JSON instead of a pretty report
  --skip-validate         Package without validating the manifest first.
                          Produces an archive the app may refuse to install.
  -h, --help              Show this help

Files are excluded via .bibleignore (one pattern per line, # for comments) on
top of a built-in list: node_modules/, .git/, *.zip, *.tgz, *.map.

Exit codes:
  0   archive written
  1   validation failed, or the archive could not be written
`;

interface PackageReport {
  ok: boolean;
  extensionRoot: string;
  outputPath?: string;
  id?: string;
  version?: string;
  fileCount?: number;
  bytes?: number;
  /** SHA-256 of the archive — the digest a catalog entry publishes. */
  sha256?: string;
  errors: { path: string; code: string; message: string }[];
}

/** Walk the tree depth-first, in a stable order, honouring the ignore matcher. */
function collectFiles(root: string, isIgnored: (p: string, dir: boolean) => boolean): string[] {
  const out: string[] = [];

  const walk = (dir: string): void => {
    const names = readdirSync(dir).sort();
    for (const name of names) {
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join('/');
      let stats;
      try {
        // lstat, not stat: stat follows the link and would report the target,
        // so a symlink would be archived as though it were a real file — and a
        // symlinked *directory* would be walked, potentially in a cycle or out
        // of the package root entirely. The installer skips symlinks outright,
        // so the archive should not contain them either.
        stats = lstatSync(full);
      } catch {
        // A dangling link, or a file that vanished mid-walk.
        continue;
      }
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        if (isIgnored(rel, true)) continue;
        walk(full);
        continue;
      }
      if (!stats.isFile()) continue;
      if (isIgnored(rel, false)) continue;
      out.push(rel);
    }
  };

  walk(root);
  return out;
}

function emit(ctx: SmokeCommandContext, report: PackageReport, asJson: boolean): void {
  if (asJson) {
    ctx.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (!report.ok) {
    ctx.stderr(`FAIL  ${report.extensionRoot}\n`);
    for (const e of report.errors) {
      ctx.stderr(`  ${e.path || '/'}  ${e.message}  [${e.code}]\n`);
    }
    ctx.stderr('\n');
    return;
  }
  ctx.stdout(`Packaged ${report.id}@${report.version}\n`);
  ctx.stdout(`  ${report.outputPath}\n`);
  ctx.stdout(`  ${report.fileCount} files, ${report.bytes} bytes\n`);
  ctx.stdout(`  sha256 ${report.sha256}\n`);
}

export function runPackageCommand(
  argv: readonly string[],
  ctx: SmokeCommandContext,
): number {
  let parsed;
  try {
    parsed = parseFlags(argv, {
      stringFlags: ['out'],
      booleanFlags: ['json', 'skip-validate', 'help'],
      aliases: { h: 'help' },
    });
  } catch (err) {
    ctx.stderr(`${(err as FlagParseError).message}\n`);
    ctx.stderr(PACKAGE_HELP);
    return 1;
  }

  if (parsed.flags['help']) {
    ctx.stdout(PACKAGE_HELP);
    return 0;
  }
  if (parsed.positional.length > 1) {
    ctx.stderr(`package: expected at most one path argument, got ${parsed.positional.length}\n`);
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
        : [{ path: '', code: 'manifest.unreadable', message: (err as Error).message }];
    emit(ctx, { ok: false, extensionRoot, errors }, asJson);
    return 1;
  }

  if (parsed.flags['skip-validate'] !== true) {
    const assetIssues = checkManifestAssets(loaded.manifest, loaded.extensionRoot);
    if (assetIssues.length > 0) {
      emit(ctx, { ok: false, extensionRoot: loaded.extensionRoot, errors: assetIssues }, asJson);
      return 1;
    }
  }

  const outDir = resolve(
    loaded.extensionRoot,
    typeof parsed.flags['out'] === 'string' ? parsed.flags['out'] : 'build',
  );

  const ignoreFile = join(loaded.extensionRoot, '.bibleignore');
  const userPatterns = existsSync(ignoreFile)
    ? parseIgnoreFile(readFileSync(ignoreFile, 'utf8'))
    : [];

  // The output directory is excluded when it sits inside the package, so a
  // second run does not archive the first run's archive.
  const outRelative = relative(loaded.extensionRoot, outDir).split(sep).join('/');
  const selfExclusion =
    outRelative.length > 0 && !outRelative.startsWith('..') ? [`${outRelative}/`] : [];

  const isIgnored = createIgnoreMatcher([
    ...DEFAULT_IGNORES,
    ...selfExclusion,
    ...userPatterns,
  ]);

  const files = collectFiles(loaded.extensionRoot, isIgnored);
  if (!files.includes('extension.json')) {
    emit(
      ctx,
      {
        ok: false,
        extensionRoot: loaded.extensionRoot,
        errors: [
          {
            path: '/',
            code: 'package.manifest-excluded',
            message:
              'extension.json is excluded by .bibleignore; an archive without a manifest cannot be installed',
          },
        ],
      },
      asJson,
    );
    return 1;
  }

  const entries: ZipEntry[] = files.map((rel) => ({
    path: rel,
    content: readFileSync(join(loaded.extensionRoot, rel)),
  }));

  let archive: Buffer;
  try {
    archive = createZip(entries);
  } catch (err) {
    emit(
      ctx,
      {
        ok: false,
        extensionRoot: loaded.extensionRoot,
        errors: [{ path: '/', code: 'package.zip-failed', message: (err as Error).message }],
      },
      asJson,
    );
    return 1;
  }

  const outputPath = join(outDir, `${loaded.manifest.id}-${loaded.manifest.version}.zip`);
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outputPath, archive);
  } catch (err) {
    emit(
      ctx,
      {
        ok: false,
        extensionRoot: loaded.extensionRoot,
        errors: [{ path: '/', code: 'package.write-failed', message: (err as Error).message }],
      },
      asJson,
    );
    return 1;
  }

  emit(
    ctx,
    {
      ok: true,
      extensionRoot: loaded.extensionRoot,
      outputPath,
      id: loaded.manifest.id,
      version: loaded.manifest.version,
      fileCount: entries.length,
      bytes: archive.length,
      sha256: createHash('sha256').update(archive).digest('hex'),
      errors: [],
    },
    asJson,
  );
  return 0;
}
