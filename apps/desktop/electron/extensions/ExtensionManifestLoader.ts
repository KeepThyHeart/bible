/**
 * Manifest loader.
 *
 * The loader is intentionally a thin wrapper around `fs.readFileSync` +
 * `JSON.parse` + `validateManifest()` from `@bible/core` - all real validation
 * logic lives in the validator so the desktop package owns no manifest
 * semantics.
 *
 * The loader's job is just to:
 *   - find `extension.json` inside an extension's install directory,
 *   - turn parse / IO failures into structured errors with the same shape as
 *     validation errors,
 *   - return a typed manifest plus the absolute install path.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Extensions } from '@bible/core';

type ExtensionManifest = Extensions.ExtensionManifest;
type ManifestValidationError = Extensions.ManifestValidationError;

export interface ManifestLoadSuccess {
  ok: true;
  manifest: ExtensionManifest;
  /** Absolute path to the directory containing `extension.json`. */
  installPath: string;
  /** Absolute path to `extension.json` itself. */
  manifestPath: string;
}

export interface ManifestLoadFailure {
  ok: false;
  installPath: string;
  manifestPath: string;
  errors: ManifestValidationError[];
}

export type ManifestLoadResult = ManifestLoadSuccess | ManifestLoadFailure;

/**
 * Read and validate `<installPath>/extension.json`. Never throws - every
 * failure mode (missing file, malformed JSON, schema/cross-cutting validation
 * errors) returns a `ManifestLoadFailure`.
 */
export function loadManifest(installPath: string): ManifestLoadResult {
  const manifestPath = join(installPath, 'extension.json');

  if (!existsSync(manifestPath)) {
    return failure(installPath, manifestPath, 'manifest.missing', `extension.json not found at ${manifestPath}`);
  }

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    return failure(
      installPath,
      manifestPath,
      'manifest.unreadable',
      `extension.json could not be read: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return failure(
      installPath,
      manifestPath,
      'manifest.parse-error',
      `extension.json is not valid JSON: ${(err as Error).message}`,
    );
  }

  const result = Extensions.validateManifest(parsed);
  if (!result.ok) {
    return { ok: false, installPath, manifestPath, errors: result.errors };
  }

  return { ok: true, manifest: result.manifest, installPath, manifestPath };
}

function failure(
  installPath: string,
  manifestPath: string,
  code: string,
  message: string,
): ManifestLoadFailure {
  return {
    ok: false,
    installPath,
    manifestPath,
    errors: [{ path: '', code, message }],
  };
}
