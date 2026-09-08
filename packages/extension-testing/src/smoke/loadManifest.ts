/**
 * Load and validate an extension's `extension.json` from disk.
 *
 * Thin wrapper over `@bible/core`'s `validateManifest` so smoke-test callers
 * get a single entry point and a typed error on failure.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Extensions } from '@bible/core';

export interface LoadedManifest {
  manifest: Extensions.ExtensionManifest;
  /** Absolute path to the extension package root (the folder containing `extension.json`). */
  extensionRoot: string;
  /** Absolute path to the manifest file itself. */
  manifestPath: string;
}

export class ManifestLoadError extends Error {
  readonly errors: Extensions.ManifestValidationError[];
  constructor(message: string, errors: Extensions.ManifestValidationError[] = []) {
    super(message);
    this.name = 'ManifestLoadError';
    this.errors = errors;
  }
}

export function loadManifest(extensionRoot: string): LoadedManifest {
  const root = resolve(extensionRoot);
  const manifestPath = resolve(root, 'extension.json');
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    throw new ManifestLoadError(
      `Could not read extension manifest at ${manifestPath}: ${(err as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ManifestLoadError(
      `Invalid JSON in ${manifestPath}: ${(err as Error).message}`,
    );
  }
  const result = Extensions.validateManifest(parsed);
  if (!result.ok) {
    const summary = result.errors
      .map((e) => `  ${e.path}: ${e.message}`)
      .join('\n');
    throw new ManifestLoadError(
      `Manifest validation failed for ${manifestPath}:\n${summary}`,
      result.errors,
    );
  }
  return { manifest: result.manifest, extensionRoot: root, manifestPath };
}
