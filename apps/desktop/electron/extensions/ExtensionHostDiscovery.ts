/**
 * Discovery + listing helpers for `ExtensionHost`.
 *
 * Handles the on-disk scan of `extensionsRoot`, reconciliation with the
 * persisted registry rows, and sideloaded-extension auto-registration.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';

import { Extensions } from '@bible/core';

import { loadManifest } from './ExtensionManifestLoader';
import type { ExtensionHostContext } from './ExtensionHostTypes';

type ExtensionStateInfo = Extensions.ExtensionStateInfo;

export async function loadAll(ctx: ExtensionHostContext): Promise<void> {
  log.info('[ExtensionHost] loadAll: scanning', ctx.extensionsRoot);

  // Pull the persisted rows so we can reconcile them against what is on
  // disk. Anything in the DB but not on disk is a stale entry; anything on
  // disk but not in the DB is a sideloaded extension we should pick up.
  const persistedRows = ctx.registry.reloadFromDb();
  const persistedById = new Map(persistedRows.map((r) => [r.id, r]));

  const onDiskIds = new Set<string>();

  let dirEntries: string[] = [];
  try {
    dirEntries = readdirSync(ctx.extensionsRoot);
  } catch (err) {
    log.warn('[ExtensionHost] could not read extensions root:', err);
    return;
  }

  for (const entry of dirEntries) {
    const installPath = join(ctx.extensionsRoot, entry);
    try {
      if (!statSync(installPath).isDirectory()) continue;
    } catch {
      continue;
    }

    // No manifest at all means this is not an install. The host keeps each
    // extension's own data here too (`<id>/db/`, `<id>/extension.log`) - for
    // an unpacked extension that is all the directory holds - so warning about
    // it on every start would report a healthy extension as broken.
    if (!existsSync(join(installPath, 'extension.json'))) continue;

    const manifestResult = loadManifest(installPath);
    if (!manifestResult.ok) {
      // Surface the load failure both to the registry (so the UI shows
      // it) and to the log file. We don't auto-create a registry row for
      // a directory we cannot validate; sideloads must round-trip
      // through `installExtension`.
      const errorSummary = manifestResult.errors
        .map((e) => `${e.path || '<root>'}: ${e.message}`)
        .join('; ');
      log.warn(`[ExtensionHost] manifest invalid at ${installPath}: ${errorSummary}`);
      continue;
    }

    const manifest = manifestResult.manifest;
    onDiskIds.add(manifest.id);

    const persisted = persistedById.get(manifest.id);
    if (persisted) {
      ctx.registry.attachManifest(
        persisted,
        manifest,
        persisted.enabled === 1 ? 'installed' : 'disabled',
      );
    } else {
      // Sideloaded directory - auto-register with default permissions so
      // it shows up in the Extensions UI. The user can grant additional
      // permissions there.
      log.info(`[ExtensionHost] sideloaded extension detected: ${manifest.id}`);
      ctx.registry.insert({
        manifest,
        installPath,
        grantedPermissions: [...Extensions.DEFAULT_GRANTED_PERMISSIONS],
      });
    }
  }

  // -- Unpacked Developer Mode extensions --------------------------------
  // These live outside `extensionsRoot`, so the scan above never sees them.
  // Load each from its own recorded path instead. Getting this wrong is not
  // subtle: without it the pruning pass below would delete every dev row on
  // every boot, because "not found in the extensions root" is exactly what a
  // dev extension looks like.
  for (const row of persistedRows) {
    if (row.dev_mode !== 1 || onDiskIds.has(row.id)) continue;

    const manifestResult = loadManifest(row.install_path);
    if (!manifestResult.ok) {
      // The directory may still be there with a manifest that is mid-edit, or
      // it may be gone entirely. Distinguish the two: a directory that still
      // exists keeps its row (dropping it would discard the granted
      // permissions over a temporary syntax error), while a directory that has
      // been moved or deleted falls through to the pruning pass below.
      if (!existsSync(row.install_path)) continue;
      const summary = manifestResult.errors
        .map((e) => `${e.path || '<root>'}: ${e.message}`)
        .join('; ');
      log.warn(
        `[ExtensionHost] unpacked extension ${row.id} kept but not loaded — manifest invalid at ${row.install_path}: ${summary}`,
      );
      onDiskIds.add(row.id);
      continue;
    }

    onDiskIds.add(row.id);
    log.info(`[ExtensionHost] unpacked extension loaded from ${row.install_path}: ${row.id}`);
    ctx.registry.attachManifest(
      row,
      manifestResult.manifest,
      row.enabled === 1 ? 'installed' : 'disabled',
    );
  }

  // Drop registry rows whose install directory is gone.
  for (const row of persistedRows) {
    if (!onDiskIds.has(row.id)) {
      log.warn(`[ExtensionHost] dropping stale registry row for missing install: ${row.id}`);
      ctx.registry.remove(row.id);
    }
  }

  log.info(
    `[ExtensionHost] loadAll complete: ${ctx.registry.list().length} extension(s) registered`,
  );
}

export async function listExtensions(
  ctx: ExtensionHostContext,
): Promise<ExtensionStateInfo[]> {
  return ctx.registry.list();
}

export async function getExtension(
  ctx: ExtensionHostContext,
  extensionId: string,
): Promise<ExtensionStateInfo | null> {
  return ctx.registry.get(extensionId);
}
