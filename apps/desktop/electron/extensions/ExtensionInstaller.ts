/**
 * Extension installer.
 *
 * File-system half of install/uninstall: copies the extension package into `data/extensions/<id>/`, validates the manifest
 * found there, and on uninstall removes the directory.
 *
 * Database state (the `extensions` table) and consent UX live elsewhere:
 *   - Persistence  -> ExtensionRegistry
 *   - Consent      -> ExtensionHost (raises an InstallConsentRequest)
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { tmpdir } from 'os';
// EXP-H: `unzipper` pulls a sizeable CommonJS tree that is required at main-
// process module-eval time purely to have it available for an operation the
// user has to ask for. Loaded on first use instead.
async function unzipperOpen(): Promise<typeof import('unzipper').Open> {
  return (await import('unzipper')).Open;
}
import { loadManifest, type ManifestLoadResult } from './ExtensionManifestLoader';
import {
  verifyExtensionSignature,
  type SignatureVerificationResult,
} from './ExtensionSignatureVerifier';

export interface InstallFromDirectoryOpts {
  /** Absolute path to a directory containing an `extension.json`. */
  sourcePath: string;
  /** Absolute path to the per-user `data/extensions/` root. */
  extensionsRoot: string;
  /** Replace an existing install with the same id (in-place upgrade). */
  overwrite?: boolean;
}

export interface InstallFromDirectorySuccess {
  ok: true;
  /** Absolute path to the installed copy under `extensionsRoot`. */
  installPath: string;
  /** Manifest as loaded from the installed copy. */
  manifestResult: Extract<ManifestLoadResult, { ok: true }>;
  /** Ed25519 signature verification result. */
  signatureResult: SignatureVerificationResult;
}

export interface InstallFromDirectoryFailure {
  ok: false;
  code: string;
  message: string;
  detail?: unknown;
}

export type InstallFromDirectoryResult =
  | InstallFromDirectorySuccess
  | InstallFromDirectoryFailure;

/**
 * Validate a source directory and copy it under `data/extensions/<id>/`.
 *
 * The validation pass runs against the *source* manifest first so we never
 * leave a half-copied directory behind for an invalid extension. Once
 * validation passes, we copy and re-validate at the destination to be sure
 * the copy round-tripped intact.
 */
export function installFromDirectory(opts: InstallFromDirectoryOpts): InstallFromDirectoryResult {
  const sourcePath = resolve(opts.sourcePath);

  if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
    return failure('source.not-directory', `Source path is not a directory: ${sourcePath}`);
  }

  // -- Validate source ----------------------------------------------------
  const sourceManifest = loadManifest(sourcePath);
  if (!sourceManifest.ok) {
    return failure(
      'manifest.invalid',
      `Source manifest is invalid (${sourceManifest.errors.length} error${sourceManifest.errors.length === 1 ? '' : 's'})`,
      sourceManifest.errors,
    );
  }

  const id = sourceManifest.manifest.id;
  const installPath = join(opts.extensionsRoot, id);

  // -- Refuse to clobber unless overwrite --------------------------------
  if (existsSync(installPath)) {
    if (!opts.overwrite) {
      return failure(
        'install.already-exists',
        `Extension '${id}' is already installed at ${installPath}; pass overwrite=true to replace.`,
      );
    }
    // In-place upgrade: remove the old copy first.
    rmSync(installPath, { recursive: true, force: true });
  }

  if (!existsSync(opts.extensionsRoot)) {
    mkdirSync(opts.extensionsRoot, { recursive: true });
  }

  // -- Copy --------------------------------------------------------------
  try {
    cpSync(sourcePath, installPath, { recursive: true, errorOnExist: false });
  } catch (err) {
    return failure(
      'install.copy-failed',
      `Failed to copy extension files: ${(err as Error).message}`,
    );
  }

  // -- Reject symlinks that escape the install boundary -----------------
  const symlinkViolation = findEscapingSymlink(installPath);
  if (symlinkViolation) {
    rmSync(installPath, { recursive: true, force: true });
    return failure(
      'install.symlink-escape',
      `Extension contains a symlink that escapes its install directory: ${symlinkViolation}`,
    );
  }

  // -- Verify extension signature ----------------------------------------
  // Runs against the installed copy (after symlink check) so the content
  // hash covers the files the user will actually run.
  const signatureResult = verifyExtensionSignature(installPath);
  // `invalid` means the sig exists but doesn't match - treat as a hard
  // failure (possible tampering). `unsigned` and `error` are non-fatal;
  // the caller surfaces a warning to the user.
  if (signatureResult.status === 'invalid') {
    rmSync(installPath, { recursive: true, force: true });
    return failure(
      'install.signature-invalid',
      signatureResult.message,
    );
  }

  // -- Re-validate at destination (cheap belt-and-braces) ---------------
  const destManifest = loadManifest(installPath);
  if (!destManifest.ok) {
    // Roll back the copy so we don't leave a broken half-install behind.
    try {
      rmSync(installPath, { recursive: true, force: true });
    } catch {
      // Ignore - we are already returning a failure.
    }
    return failure(
      'install.copy-corrupt',
      'Manifest validation failed after copy — install rolled back.',
      destManifest.errors,
    );
  }

  return { ok: true, installPath, manifestResult: destManifest, signatureResult };
}

function failure(code: string, message: string, detail?: unknown): InstallFromDirectoryFailure {
  return detail !== undefined
    ? { ok: false, code, message, detail }
    : { ok: false, code, message };
}

/**
 * Delete an extension's install directory. The caller is responsible for
 * removing the corresponding registry rows (see `ExtensionRegistry.remove`).
 */
/**
 * Recursively delete an installed extension directory.
 *
 * `extensionsRoot` is not optional decoration. Since Developer Mode, an
 * extension's `install_path` may point at a directory the *host does not own*
 * - a developer's working copy, loaded unpacked and never copied. A recursive
 * force-delete aimed at one of those destroys someone's source tree, and the
 * only thing standing between an ordinary uninstall and that outcome would be
 * a caller remembering to check. So the check lives here, where the deletion
 * is, and a path outside the root is refused rather than trusted.
 */
export function uninstallDirectory(installPath: string, extensionsRoot: string): void {
  // Containment is checked BEFORE existence, deliberately. A caller passing a
  // path outside the root has a bug worth surfacing whether or not that path
  // happens to exist right now - checking existence first would let the same
  // mistake pass silently on one machine and destroy a directory on another.
  const target = resolve(installPath);
  const root = resolve(extensionsRoot);
  const contained = target !== root && target.startsWith(root.endsWith(sep) ? root : root + sep);
  if (!contained) {
    throw new Error(
      `Refusing to delete ${target}: it is outside the extensions root (${root}). ` +
        'Unpacked Developer Mode extensions are unregistered, not deleted.',
    );
  }

  if (!existsSync(target)) return;
  rmSync(target, { recursive: true, force: true });
}

// --- Symlink escape detection ----------------------------------------

/**
 * Recursively walk `root` looking for symlinks whose resolved target falls
 * outside `root`. Returns the offending relative path on first violation,
 * or `null` if the tree is clean.
 */
function findEscapingSymlink(root: string): string | null {
  const realRoot = realpathSync(root);
  const prefix = realRoot + sep;

  function walk(dir: string): string | null {
    for (const name of readdirSync(dir)) {
      const entry = join(dir, name);
      const st = lstatSync(entry);
      if (st.isSymbolicLink()) {
        const target = resolve(dir, readlinkSync(entry));
        if (!target.startsWith(prefix) && target !== realRoot) {
          // Return a human-readable relative path for the error message.
          return entry.slice(root.length + 1);
        }
      } else if (st.isDirectory()) {
        const found = walk(entry);
        if (found) return found;
      }
    }
    return null;
  }

  return walk(root);
}

// --- ZIP install -----------------------------------------------------

export interface InstallFromZipOpts {
  /** Absolute path to a `.zip` archive containing an extension package. */
  zipPath: string;
  extensionsRoot: string;
  overwrite?: boolean;
}

/**
 * Unzip an extension package into a temp directory, validate the manifest,
 * and copy it under `data/extensions/<id>/`. The temp directory is cleaned up
 * unconditionally.
 *
 * Path traversal defense: every entry in the archive is checked against the
 * temp root before being written. Anything that would escape the root is
 * rejected with `zip.unsafe-path`. Symlinks are skipped entirely.
 */
export async function installFromZip(opts: InstallFromZipOpts): Promise<InstallFromDirectoryResult> {
  const zipPath = resolve(opts.zipPath);
  if (!existsSync(zipPath) || !statSync(zipPath).isFile()) {
    return failure('zip.not-file', `Zip path is not a file: ${zipPath}`);
  }

  const tempRoot = join(tmpdir(), `bible-ext-install-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(tempRoot, { recursive: true });

  try {
    // Open the archive and stream every entry into the temp root.
    const directory = await (await unzipperOpen()).file(zipPath);
    for (const entry of directory.files) {
      // The `unzipper` types only know "Directory" / "File"; symlinks are
      // exposed as files with no content, which is fine for our use case.
      if (entry.type === 'Directory') continue;

      // Defense against path traversal: resolve the destination and verify it
      // stays inside the temp root.
      //
      // This compared against `tempRoot + '/'`, which is correct on POSIX and
      // wrong on Windows: `resolve()` returns backslash-separated paths, so
      // the forward-slash suffix never matched and *every* entry - including
      // a plain `extension.json` - was rejected as unsafe. Zip install was
      // broken outright on Windows. `relative()` is separator-agnostic, so
      // the check now means the same thing on both platforms.
      const destPath = resolve(tempRoot, entry.path);
      const rel = relative(tempRoot, destPath);
      if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        return failure('zip.unsafe-path', `Refusing entry that escapes the archive root: ${entry.path}`);
      }
      const destDir = dirname(destPath);
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      const buffer = await entry.buffer();
      writeFileSync(destPath, buffer);
    }

    // Find the actual extension root inside the temp tree. Many zips wrap
    // their content in a single top-level directory; if so, descend into it.
    let extRoot = tempRoot;
    if (!existsSync(join(extRoot, 'extension.json'))) {
      const entries = readdirSync(tempRoot).filter((e) => statSync(join(tempRoot, e)).isDirectory());
      if (entries.length === 1 && existsSync(join(tempRoot, entries[0]!, 'extension.json'))) {
        extRoot = join(tempRoot, entries[0]!);
      }
    }

    // Hand off to the directory installer for the rest of the validation +
    // copy + re-validation flow. Same code path as folder install.
    return installFromDirectory({
      sourcePath: extRoot,
      extensionsRoot: opts.extensionsRoot,
      ...(opts.overwrite !== undefined ? { overwrite: opts.overwrite } : {}),
    });
  } catch (err) {
    return failure('zip.extract-failed', `Failed to extract archive: ${(err as Error).message}`);
  } finally {
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* swallow */ }
  }
}
