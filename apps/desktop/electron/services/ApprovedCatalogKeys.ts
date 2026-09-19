/**
 * Signing keys the user approved for the official catalog, each on the
 * strength of a vouch from a key the app already trusted (see
 * `CatalogKeyVouches.ts`).
 *
 * Kept in `{userData}/catalog-trust/approved-keys.json`, deliberately NOT on
 * the catalog row: the row's `signing_public_key` is also written by
 * trust-on-first-use, and an install that predates pinning may have recorded
 * whatever key the official catalog was first seen with. A separate file means
 * only a user decision can ever widen the official trust set.
 *
 * Sync fs, like `NetworkConfig`: the file is tiny, read when the official
 * catalog is fetched, and written only when the user approves a key.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log/main';

export interface ApprovedCatalogKey {
  /** Hex Ed25519 key the user approved. */
  publicKey: string;
  /** Official catalog URL prefix it was approved for. */
  scope: string;
  /** Key whose vouch the user relied on. */
  vouchedBy: string;
  /** When that vouch was issued. */
  issued: string;
  /** When the user approved the key. */
  approvedAt: string;
}

export interface ApprovedCatalogKeyStore {
  /** Keys approved for `scope`. */
  list(scope: string): string[];
  add(entry: ApprovedCatalogKey): void;
}

/** Keeps approvals for the life of the process: the default, and what tests use. */
export class MemoryApprovedCatalogKeyStore implements ApprovedCatalogKeyStore {
  private readonly entries: ApprovedCatalogKey[] = [];

  list(scope: string): string[] {
    return keysFor(this.entries, scope);
  }

  add(entry: ApprovedCatalogKey): void {
    this.entries.push(entry);
  }
}

export class FileApprovedCatalogKeyStore implements ApprovedCatalogKeyStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? path.join(app.getPath('userData'), 'catalog-trust', 'approved-keys.json');
  }

  list(scope: string): string[] {
    return keysFor(this.load(), scope);
  }

  /** Throws if the file cannot be written: an approval must not look saved when it is not. */
  add(entry: ApprovedCatalogKey): void {
    const entries = [...this.load(), entry];
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  private load(): ApprovedCatalogKey[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      // Missing is the normal case. Unreadable means no approvals - never more.
      return [];
    }
    if (!Array.isArray(parsed)) {
      log.warn(`[catalog-trust] Ignoring malformed ${this.filePath}`);
      return [];
    }
    return parsed.filter(isApprovedCatalogKey);
  }
}

function keysFor(entries: readonly ApprovedCatalogKey[], scope: string): string[] {
  const wanted = scope.toLowerCase();
  return entries
    .filter((entry) => entry.scope.toLowerCase() === wanted)
    .map((entry) => entry.publicKey);
}

function isApprovedCatalogKey(value: unknown): value is ApprovedCatalogKey {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.publicKey === 'string' && /^[0-9a-f]{64}$/i.test(entry.publicKey) &&
    typeof entry.scope === 'string' &&
    typeof entry.vouchedBy === 'string' &&
    typeof entry.issued === 'string' &&
    typeof entry.approvedAt === 'string'
  );
}
