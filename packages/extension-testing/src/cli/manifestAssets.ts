/**
 * Checks that the files an `extension.json` *points at* actually exist.
 *
 * Schema validation and this check answer different questions. The validator
 * says the manifest is well-formed and that each path is package-relative and
 * free of `..` segments (`validatePackagePath`). It cannot say whether
 * `dist/main.js` was ever built, because it never sees the directory. That gap
 * is where the most common packaging mistake lives - shipping an archive whose
 * entry point was cleaned away, or whose panel HTML sits at `ui/index.html`
 * while the manifest says `ui/panel.html`. Both install without complaint and
 * then fail at activation, in the app, with an error the author reads as a host
 * bug.
 *
 * So `validate` and `package` both run this, and `package` refuses on a miss:
 * an archive that cannot activate is not worth producing.
 *
 * **Path shape is deliberately not re-checked here.** Absolute paths and `..`
 * escapes are already rejected by `validateManifest`, which every caller runs
 * first, and a second implementation of that rule is free to disagree with the
 * one the host actually enforces. This module only asks whether the file is
 * there.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Extensions } from '@bible/core';

export interface AssetIssue {
  /** JSON-pointer-style path to the manifest field, matching validator errors. */
  path: string;
  /** Stable, machine-readable code. */
  code: 'asset.missing';
  message: string;
}

interface AssetRef {
  path: string;
  value: string;
}

/**
 * Every manifest field the host resolves against the package root. Kept in
 * step with the `validatePackagePath` call sites in `ExtensionManifestValidator`
 * - a path the validator shape-checks but nothing here looks for is a file the
 * author can forget to ship and only find out about from a user.
 */
function collectRefs(manifest: Extensions.ExtensionManifest): AssetRef[] {
  const refs: AssetRef[] = [];

  const push = (path: string, value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) refs.push({ path, value });
  };

  push('/main', manifest.main);
  push('/icon', manifest.icon);

  const contributes = manifest.contributes;
  if (!contributes) return refs;

  contributes.panelTypes?.forEach((panel, i) => {
    push(`/contributes/panelTypes/${i}/uiEntry`, panel.uiEntry);
  });
  contributes.themes?.forEach((theme, i) => {
    push(`/contributes/themes/${i}/path`, theme.path);
  });
  contributes.icons?.forEach((icon, i) => {
    push(`/contributes/icons/${i}/path`, icon.path);
  });
  contributes.styles?.forEach((style, i) => {
    push(`/contributes/styles/${i}/path`, style.path);
  });
  contributes.fonts?.forEach((font, i) => {
    font.files?.forEach((file, j) => {
      push(`/contributes/fonts/${i}/files/${j}`, file);
    });
  });

  return refs;
}

/**
 * @param manifest      A manifest that has already passed `validateManifest`.
 * @param extensionRoot Absolute path to the folder holding `extension.json`.
 */
export function checkManifestAssets(
  manifest: Extensions.ExtensionManifest,
  extensionRoot: string,
): AssetIssue[] {
  const root = resolve(extensionRoot);
  const issues: AssetIssue[] = [];

  for (const ref of collectRefs(manifest)) {
    if (!existsSync(resolve(root, ref.value))) {
      issues.push({
        path: ref.path,
        code: 'asset.missing',
        message: `"${ref.value}" does not exist (looked in ${root})`,
      });
    }
  }

  return issues;
}
