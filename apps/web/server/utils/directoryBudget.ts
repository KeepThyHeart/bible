/**
 * A size cap for a directory that anonymous callers can add files to
 * (`data/feedback`, `data/desktop-reports`).
 *
 * Per-client quotas slow one sender down; this bounds the total, so that many
 * senders together still cannot fill the disk that holds main.db and the
 * modules. Past the cap the route answers 503 and writes nothing; the operator
 * reads, forwards or deletes submissions to make room.
 *
 * Usage is counted once at startup and then kept up to date in memory as the
 * route writes. Files the operator deletes are noticed the next time the cap is
 * reached: the directory is re-counted then (at most once a minute), so a full
 * store reopens without a restart.
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface DirectoryBudgetOptions {
  maxFiles: number;
  maxBytes: number;
}

export interface DirectoryBudget {
  /** Whether a file of `bytes` more still fits. */
  hasRoom(bytes: number): boolean;
  /** Count a file the caller has just written. */
  recordWrite(bytes: number): void;
}

const RECOUNT_INTERVAL_MS = 60_000;

function measure(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files++;
    try { bytes += statSync(join(dir, entry.name)).size; } catch { /* removed meanwhile */ }
  }
  return { files, bytes };
}

export function createDirectoryBudget(dir: string, { maxFiles, maxBytes }: DirectoryBudgetOptions): DirectoryBudget {
  let usage = measure(dir);
  let lastCount = Date.now();

  const fits = (bytes: number) => usage.files + 1 <= maxFiles && usage.bytes + bytes <= maxBytes;

  return {
    hasRoom(bytes) {
      if (fits(bytes)) return true;
      const now = Date.now();
      if (now - lastCount >= RECOUNT_INTERVAL_MS) {
        usage = measure(dir);
        lastCount = now;
        return fits(bytes);
      }
      return false;
    },
    recordWrite(bytes) {
      usage = { files: usage.files + 1, bytes: usage.bytes + bytes };
    },
  };
}
