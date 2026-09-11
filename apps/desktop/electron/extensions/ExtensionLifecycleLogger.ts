/**
 * Per-extension log + crash log writer.
 *
 * Backs crash detection / auto-disable and the `IExtensionHost`
 * `getLog()` / `getCrashLog()` surface.
 *
 * Each extension gets its own log directory under
 * `data/extensions/<id>/` with two files:
 *
 *   extension.log - append-only NDJSON of `ExtensionLogEntry` records
 *   crash.log - append-only NDJSON of `ExtensionCrashRecord` records
 *
 * The logger keeps the files on disk so the Extensions UI can show recent
 * activity even after the worker has been torn down. Reads return the most
 * recent N entries; writes append (the host caps total file size by tail-
 * truncating when the file grows past LOG_MAX_BYTES).
 */

import { existsSync, mkdirSync, appendFileSync, statSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { Extensions } from '@bible/core';

type ExtensionCrashRecord = Extensions.ExtensionCrashRecord;
type ExtensionLogEntry = Extensions.ExtensionLogEntry;

const LOG_MAX_BYTES = 1024 * 1024; // 1 MB per file
const LOG_TRUNCATE_KEEP = 512 * 1024; // keep the last 512 KB after truncate

export class ExtensionLifecycleLogger {
  /**
   * @param extensionsRoot Absolute path to the per-extension state root (the
   *                       parent of per-extension directories). `ExtensionHost`
   *                       passes its `logRoot`, which `main.ts` roots at
   *                       `getUserDataPath()` so the files are writable in a
   *                       packaged build - the discovery root is not.
   */
  constructor(private readonly extensionsRoot: string) {}

  /** Append a structured log entry to `<id>/extension.log`. */
  appendLog(extensionId: string, entry: ExtensionLogEntry): void {
    this.appendLine(this.logPath(extensionId), entry);
  }

  /** Append a crash record to `<id>/crash.log`. */
  appendCrash(extensionId: string, record: ExtensionCrashRecord): void {
    this.appendLine(this.crashPath(extensionId), record);
  }

  /** Read the most recent `limit` log entries (newest first). */
  readLog(extensionId: string, limit = 200): ExtensionLogEntry[] {
    return this.readTail<ExtensionLogEntry>(this.logPath(extensionId), limit);
  }

  /** Read the most recent `limit` crash records (newest first). */
  readCrashLog(extensionId: string, limit = 50): ExtensionCrashRecord[] {
    return this.readTail<ExtensionCrashRecord>(this.crashPath(extensionId), limit);
  }

  // --- private ------------------------------------------------------------

  private logPath(extensionId: string): string {
    return join(this.extensionsRoot, extensionId, 'extension.log');
  }

  private crashPath(extensionId: string): string {
    return join(this.extensionsRoot, extensionId, 'crash.log');
  }

  private appendLine(path: string, payload: unknown): void {
    // Log writes must never be fatal. The extensions root is not guaranteed
    // writable (a packaged Linux AppImage mounts `resources/` read-only), and
    // an activation that succeeded should not be reported as a failure just
    // because its "Activated" line could not be persisted.
    try {
      this.ensureDir(path);
      const line = JSON.stringify(payload) + '\n';
      appendFileSync(path, line, 'utf8');
      this.maybeTruncate(path);
    } catch {
      /* diagnostics are best-effort */
    }
  }

  private ensureDir(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private maybeTruncate(path: string): void {
    try {
      const size = statSync(path).size;
      if (size <= LOG_MAX_BYTES) return;
      const buf = readFileSync(path, 'utf8');
      const tail = buf.slice(buf.length - LOG_TRUNCATE_KEEP);
      // Drop a partial first line so the tail starts on a record boundary.
      const firstNl = tail.indexOf('\n');
      const aligned = firstNl >= 0 ? tail.slice(firstNl + 1) : tail;
      writeFileSync(path, aligned, 'utf8');
    } catch {
      // Ignore truncate failures - losing some history is preferable to
      // crashing the host.
    }
  }

  private readTail<T>(path: string, limit: number): T[] {
    if (!existsSync(path)) return [];
    let buf: string;
    try {
      buf = readFileSync(path, 'utf8');
    } catch {
      return [];
    }
    const lines = buf.split('\n').filter((l) => l.length > 0);
    const slice = lines.slice(Math.max(0, lines.length - limit));
    const out: T[] = [];
    for (let i = slice.length - 1; i >= 0; i--) {
      try {
        out.push(JSON.parse(slice[i]) as T);
      } catch {
        // Skip malformed lines.
      }
    }
    return out;
  }
}
