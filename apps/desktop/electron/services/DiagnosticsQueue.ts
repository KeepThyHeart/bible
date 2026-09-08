/**
 * DiagnosticsQueue - filesystem-backed queue of pending diagnostic reports.
 * One JSON file per report under `{userData}/diagnostics/queue/`, named
 * `{ISOts}-{type}-{shortId}.json`. Files are plain JSON so power users (and
 * support) can inspect them directly.
 *
 * All IO is synchronous - the files are tiny (< 10 KB) and infrequent, and
 * using sync fs avoids the complexity of racing writes against shutdown.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import { DIAGNOSTICS_QUEUE_MAX } from '../config/constants';
import type { DiagnosticsPayload, DiagnosticsReportType } from './DiagnosticsService';

export interface QueueEntry {
  id: string;
  type: DiagnosticsReportType;
  ts: string;
}

export class DiagnosticsQueue {
  private dir: string;

  constructor(queueDir?: string) {
    this.dir =
      queueDir ?? path.join(app.getPath('userData'), 'diagnostics', 'queue');
    this.ensureDir();
  }

  private ensureDir(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      log.error('[diagnostics] failed to create queue dir:', err);
    }
  }

  getQueueDir(): string {
    return this.dir;
  }

  /**
   * Write a payload to the queue and return its id (the filename stem).
   * Evicts the oldest report if the queue is at the cap.
   */
  enqueue(payload: DiagnosticsPayload): string {
    this.evictOldestIfFull(DIAGNOSTICS_QUEUE_MAX);

    // Filenames use a filesystem-safe ISO timestamp (no colons) so listing
    // lexically also sorts chronologically.
    const safeTs = payload.timestamp.replace(/[:.]/g, '-');
    const id = `${safeTs}-${payload.type}-${payload.report_id}`;
    const filePath = path.join(this.dir, `${id}.json`);

    try {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), {
        encoding: 'utf-8',
      });
    } catch (err) {
      log.error('[diagnostics] failed to enqueue report:', err);
    }
    return id;
  }

  list(): QueueEntry[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    const entries: QueueEntry[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      // id format: {safeTs}-{type}-{shortId}
      const parts = id.split('-');
      // type is the second-to-last dash-delimited token; shortId is the last.
      // safeTs contains many dashes (from the ISO timestamp) so we slice from
      // the right.
      if (parts.length < 3) continue;
      const type = parts[parts.length - 2] as DiagnosticsReportType;
      const ts = this.readTs(path.join(this.dir, name)) ?? '';
      entries.push({ id, type, ts });
    }
    // Sort oldest first for predictable eviction + UI ordering.
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return entries;
  }

  private readTs(filePath: string): string | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DiagnosticsPayload>;
      return typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
    } catch {
      return null;
    }
  }

  read(id: string): DiagnosticsPayload | null {
    const filePath = path.join(this.dir, `${id}.json`);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as DiagnosticsPayload;
    } catch (err) {
      log.warn(`[diagnostics] read(${id}) failed:`, err);
      return null;
    }
  }

  /** Overwrite an existing queued report. Used to attach user descriptions. */
  update(id: string, payload: DiagnosticsPayload): boolean {
    const filePath = path.join(this.dir, `${id}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), {
        encoding: 'utf-8',
      });
      return true;
    } catch (err) {
      log.warn(`[diagnostics] update(${id}) failed:`, err);
      return false;
    }
  }

  delete(id: string): boolean {
    const filePath = path.join(this.dir, `${id}.json`);
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      log.warn(`[diagnostics] delete(${id}) failed:`, err);
      return false;
    }
  }

  deleteAll(): number {
    let count = 0;
    for (const entry of this.list()) {
      if (this.delete(entry.id)) count++;
    }
    return count;
  }

  evictOldestIfFull(max: number): void {
    const entries = this.list();
    while (entries.length >= max) {
      const oldest = entries.shift();
      if (!oldest) break;
      this.delete(oldest.id);
    }
  }
}
