/**
 * Study add-on pack import - a single `.zip`/`.biblepack` archive bundling
 * many module `.db`/`.db.gz` files, so a user can install a whole
 * commentary/dictionary/etc. set from one file instead of one at a time.
 *
 * ## Why this does not add a new install path
 *
 * `InstallationService.installModule` is the conformance gate every module
 * must pass: `module_info`, a UUID, `canon`/`versification`, and the
 * shifted-canon check over `bible_verse`. A pack is not a new kind of
 * content - it is many ordinary modules concatenated into one file for
 * transport. So this module does exactly one new thing (safely unpack an
 * archive to a temp directory) and hands each resulting `.db`/`.db.gz` file
 * to the *existing* per-module install path, one at a time, via an injected
 * callback. Nothing here bypasses the gate; nothing here even knows what the
 * gate checks.
 *
 * ## Failure isolation
 *
 * A pack install is not all-or-nothing. If 7 of 9 bundled modules pass
 * conformance and 2 do not, the 7 install and the 2 are reported with their
 * individual reasons - aborting the whole pack over one bad module would
 * throw away seven good installs for no safety benefit, since each module is
 * validated independently anyway.
 *
 * ## Threat model - this is untrusted archive input
 *
 * A `.zip` chosen through a native file dialog is still attacker-controlled
 * content once opened (a `.zip` a user was sent, not one the app produced):
 *
 *   - **Zip-slip**: an entry path like `../../../Windows/System32/evil.db`
 *     must never resolve outside the extraction root. Every module-file entry
 *     is checked with `path.relative()` before anything is written, the same
 *     pattern used by `ExtensionInstaller.installFromZip` and
 *     `SemanticPackService.safeJoin`.
 *   - **Zip bomb (declared-size lie)**: the central directory's
 *     `uncompressedSize` is untrusted metadata - nothing stops an entry from
 *     declaring a small size while its DEFLATE stream expands to gigabytes.
 *     Extraction counts actual bytes written and aborts mid-stream the
 *     instant the running total for that entry exceeds the declared/allowed
 *     size, so the disk is never at the mercy of a forged header.
 *   - **Entry-count / total-size floods**: a fixed ceiling on the number of
 *     archive entries scanned, the number of module files extracted, and the
 *     cumulative declared bytes across the archive bounds the CPU and disk
 *     cost of processing a hostile archive before a single byte is written.
 *   - **Non-module payloads**: any entry that isn't named `*.db` or
 *     `*.db.gz` is never written anywhere - it is only ever used as a
 *     rejected-or-skipped label.
 */

import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
// See ExtensionInstaller.ts -- `unzipper` is loaded on first use.
type UnzipperOpenType = typeof import('unzipper').Open;
async function unzipperOpen(): Promise<UnzipperOpenType> {
  return (await import('unzipper')).Open;
}

/** Accepted archive extensions for a study add-on pack. */
export const MODULE_PACK_EXTENSIONS = ['.zip', '.biblepack'] as const;

/** Accepted module file extensions inside a pack. Case-insensitive. */
const MODULE_FILE_RE = /\.db(\.gz)?$/i;

export interface ModulePackLimits {
  /** Total entries (files + directories) the archive's central directory may list. */
  maxArchiveEntries: number;
  /** Max number of `.db`/`.db.gz` files that will be extracted from one archive. */
  maxModuleFiles: number;
  /** Max declared (and actual) uncompressed size of a single module file. */
  maxEntryBytes: number;
  /** Max cumulative declared uncompressed size across all extracted module files. */
  maxTotalBytes: number;
}

/**
 * Defaults are generous for a legitimate "commentary + dictionary + book"
 * bundle (which realistically totals in the hundreds of MB to a few GB) while
 * still bounding worst-case cost. Kept local to this file rather than in
 * `@bible/core`'s `FeaturePackTypes.ts` - a module pack is a different
 * artifact with different size characteristics than a semantic-search
 * feature pack, and the two should be free to diverge.
 */
export const DEFAULT_MODULE_PACK_LIMITS: ModulePackLimits = {
  maxArchiveEntries: 2000,
  maxModuleFiles: 200,
  maxEntryBytes: 2 * 1024 * 1024 * 1024, // 2 GiB - comfortably above any real single module
  maxTotalBytes: 8 * 1024 * 1024 * 1024, // 8 GiB - matches the feature-pack total ceiling
};

export type ModulePackErrorCode =
  | 'not_found'
  | 'invalid_archive'
  | 'too_many_entries'
  | 'archive_too_large';

export class ModulePackError extends Error {
  constructor(message: string, readonly code: ModulePackErrorCode) {
    super(message);
    this.name = 'ModulePackError';
  }
}

/** A `.db`/`.db.gz` entry that was safely extracted and is ready to install. */
export interface ExtractedModuleFile {
  /** Path inside the archive, forward-slash separated, for display. */
  entryPath: string;
  /** Absolute path to the extracted copy on disk. */
  extractedPath: string;
  /** Actual bytes written (verified during streaming, not merely the declared size). */
  sizeBytes: number;
}

/** An archive entry that was deliberately not extracted, and why. */
export interface SkippedPackEntry {
  entryPath: string;
  reason: string;
}

export interface ExtractModulePackResult {
  /** Root of the temp directory the module files were extracted into. */
  tempDir: string;
  moduleFiles: ExtractedModuleFile[];
  skipped: SkippedPackEntry[];
}

/**
 * Safely unpack the `.db`/`.db.gz` entries of a module pack archive into a
 * fresh subdirectory of `extractionRoot`.
 *
 * Does not install anything - this only gets safe files onto disk. Every
 * entry that isn't a recognized module file, or whose resolved path would
 * escape the extraction root, is skipped (never written) rather than
 * rejected outright, so a pack with a handful of stray non-module files
 * (a README, a LICENSE) still imports its modules.
 *
 * On any ceiling violation (entry count, total declared size) or read
 * failure, the partially-extracted temp directory is removed before the
 * error propagates - callers never have to clean up a failed extraction.
 */
export async function extractModulePack(
  archivePath: string,
  extractionRoot: string,
  limits: ModulePackLimits = DEFAULT_MODULE_PACK_LIMITS
): Promise<ExtractModulePackResult> {
  if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
    throw new ModulePackError(`Archive not found: ${archivePath}`, 'not_found');
  }

  mkdirSync(extractionRoot, { recursive: true });
  const tempDir = join(extractionRoot, `pack-${Date.now()}-${randomUUID().slice(0, 8)}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    let directory: Awaited<ReturnType<UnzipperOpenType['file']>>;
    try {
      directory = await (await unzipperOpen()).file(archivePath);
    } catch (error) {
      throw new ModulePackError(
        `Could not read archive: ${(error as Error).message}`,
        'invalid_archive'
      );
    }

    if (directory.files.length > limits.maxArchiveEntries) {
      throw new ModulePackError(
        `Archive contains ${directory.files.length} entries, exceeding the limit of ${limits.maxArchiveEntries}.`,
        'too_many_entries'
      );
    }

    const moduleFiles: ExtractedModuleFile[] = [];
    const skipped: SkippedPackEntry[] = [];
    let totalDeclaredBytes = 0;

    for (const entry of directory.files) {
      if (entry.type === 'Directory') continue;

      const normalized = entry.path.replace(/\\/g, '/').replace(/^\.\//, '');

      if (!MODULE_FILE_RE.test(normalized)) {
        skipped.push({ entryPath: normalized, reason: 'Not a module file (.db or .db.gz) — not extracted.' });
        continue;
      }

      // Zip-slip defense: resolve against the temp root and verify the
      // result is still contained within it. Checked before anything about
      // the entry is trusted further.
      const destPath = resolve(tempDir, normalized);
      const rel = relative(tempDir, destPath);
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        skipped.push({ entryPath: normalized, reason: 'Rejected: entry path escapes the archive root.' });
        continue;
      }

      if (entry.uncompressedSize > limits.maxEntryBytes) {
        skipped.push({
          entryPath: normalized,
          reason: `Exceeds the per-file size limit (${limits.maxEntryBytes} bytes) — not extracted.`,
        });
        continue;
      }

      if (moduleFiles.length >= limits.maxModuleFiles) {
        skipped.push({
          entryPath: normalized,
          reason: `Archive exceeds the ${limits.maxModuleFiles}-module-file limit — not extracted.`,
        });
        continue;
      }

      totalDeclaredBytes += entry.uncompressedSize;
      if (totalDeclaredBytes > limits.maxTotalBytes) {
        throw new ModulePackError(
          `Archive's total uncompressed size exceeds the ${limits.maxTotalBytes}-byte limit.`,
          'archive_too_large'
        );
      }

      mkdirSync(dirname(destPath), { recursive: true });
      const actualBytes = await copyEntryCapped(entry, destPath, limits.maxEntryBytes, normalized);
      moduleFiles.push({ entryPath: normalized, extractedPath: destPath, sizeBytes: actualBytes });
    }

    return { tempDir, moduleFiles, skipped };
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Stream one archive entry to disk, counting real bytes as they pass so a
 * DEFLATE stream that expands past its declared (or the configured) size
 * ceiling is cut off mid-write rather than trusted to stop on its own.
 */
async function copyEntryCapped(
  entry: { stream: () => Readable },
  destPath: string,
  cap: number,
  label: string
): Promise<number> {
  let seen = 0;
  try {
    await pipeline(
      entry.stream(),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          seen += chunk.length;
          if (seen > cap) {
            throw new ModulePackError(
              `"${label}" decompressed past its declared size — refusing (possible zip bomb).`,
              'archive_too_large'
            );
          }
          yield chunk;
        }
      },
      createWriteStream(destPath)
    );
  } catch (error) {
    throw error instanceof ModulePackError
      ? error
      : new ModulePackError(`Failed to extract "${label}": ${(error as Error).message}`, 'invalid_archive');
  }
  return seen;
}

/** Remove an extraction temp directory. Safe to call more than once. */
export function cleanupModulePack(tempDir: string): void {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Best-effort - a leftover temp directory under the app's own data path
    // is not worth failing an otherwise-successful install over.
    // eslint-disable-next-line no-console
    console.warn(`[ModulePack] Failed to clean up temp dir ${tempDir}:`, error);
  }
}

// --- Orchestration ---------------------------------------------------------

export interface ModulePackOutcome {
  entryPath: string;
  moduleName?: string;
  overwritten?: boolean;
}

export interface ModulePackFailure {
  entryPath: string;
  reason: string;
}

/**
 * A module that extracted and validated fine but was deliberately NOT
 * installed, because the copy already on disk is the same version or newer.
 *
 * Deliberately its own bucket rather than folded into `skipped` (which means
 * "never extracted - not a module, unsafe path, over a ceiling") or `failed`
 * (which means "tried and could not"). Re-importing last month's pack over a
 * newer library is the normal, expected case, and reporting six modules as
 * failures for behaving correctly would train users to ignore the summary.
 */
export interface ModulePackUpToDateEntry {
  entryPath: string;
  moduleName?: string;
  /** Human-readable explanation, e.g. "Installed version 2.1 is newer than 2.0." */
  reason: string;
}

export interface ModulePackInstallSummary {
  /** Module files found in the archive (installed + failed + up-to-date). */
  found: number;
  installed: ModulePackOutcome[];
  failed: ModulePackFailure[];
  /** Non-module / unsafe / over-limit entries that were never extracted. */
  skipped: SkippedPackEntry[];
  /**
   * Modules left alone because the installed copy is already current. Optional
   * so that callers written against the pre-policy summary shape still
   * type-check; always present on summaries this function produces.
   */
  upToDate?: ModulePackUpToDateEntry[];
}

/**
 * Extract a pack archive and install every resulting module file through the
 * caller-supplied `installOne` callback - normally a thin wrapper around
 * `InstallationService.installModule` (see `installModuleFromPath` in
 * `moduleHandlers.ts`), so every module still passes the full conformance
 * gate. One module failing does not stop the others: each is installed
 * independently and its outcome recorded.
 *
 * The temp extraction directory is always removed before this returns or
 * throws - on the failure paths inside `extractModulePack` itself, and here
 * in a `finally` once every extracted file has had an install attempt.
 */
export async function installModulePack(
  archivePath: string,
  extractionRoot: string,
  installOne: (filePath: string) => Promise<{
    moduleName?: string;
    overwritten?: boolean;
    /**
     * Set by the caller when it declined to install because the installed
     * copy is already current. Returning this rather than throwing is what
     * keeps "already up to date" out of the failure bucket.
     */
    upToDateReason?: string;
  }>,
  limits: ModulePackLimits = DEFAULT_MODULE_PACK_LIMITS
): Promise<ModulePackInstallSummary> {
  const { tempDir, moduleFiles, skipped } = await extractModulePack(archivePath, extractionRoot, limits);

  const installed: ModulePackOutcome[] = [];
  const failed: ModulePackFailure[] = [];
  const upToDate: ModulePackUpToDateEntry[] = [];

  try {
    for (const file of moduleFiles) {
      try {
        const result = await installOne(file.extractedPath);
        if (result.upToDateReason) {
          upToDate.push({
            entryPath: file.entryPath,
            moduleName: result.moduleName,
            reason: result.upToDateReason,
          });
          continue;
        }
        installed.push({ entryPath: file.entryPath, moduleName: result.moduleName, overwritten: result.overwritten });
      } catch (error) {
        failed.push({ entryPath: file.entryPath, reason: (error as Error).message });
      }
    }
  } finally {
    cleanupModulePack(tempDir);
  }

  return { found: moduleFiles.length, installed, failed, skipped, upToDate };
}

/** True if `filePath`'s extension marks it as a pack archive, not a single module file. */
export function isModulePackPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return MODULE_PACK_EXTENSIONS.some(ext => lower.endsWith(ext));
}
