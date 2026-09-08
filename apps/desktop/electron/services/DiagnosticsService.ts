/**
 * DiagnosticsService - in-memory collection layer for crash reports, manual
 * issue reports, and plain feedback. Builds sanitized payloads per the spec
 * in docs/queue/diagnostics-and-issue-reporting.md section 2.
 *
 * Privacy note: this service is allowed to see stack traces and raw errors.
 * Everything it EMITS (payloads, the IPC ring buffer, the state snapshot)
 * must be scrubbed so it never reveals: file paths, usernames, timezones,
 * locales, user content, modules, or session identifiers beyond the
 * strictly-necessary diagnostic fields. See section 2.4 of the spec.
 */

import os from 'os';
import crypto from 'crypto';
import { app } from 'electron';
import log from 'electron-log';
import {
  DIAGNOSTICS_RING_SIZE,
  DIAGNOSTICS_CRASHES_PER_SESSION_CAP,
} from '../config/constants';

// Injected at build time by electron.vite.config.ts via Vite's `define`.
// Resolves to the short git SHA for the source revision this binary was
// built from (or an empty string when git wasn't available at build time).
declare const __BIBLE_BUILD_ID__: string;

/**
 * Build-time git SHA, safe to read from anywhere in the main process.
 * Exported so the uploader can add it to request headers without having
 * to thread it through the service API.
 */
export const BUILD_ID: string =
  typeof __BIBLE_BUILD_ID__ === 'string' ? __BIBLE_BUILD_ID__ : '';

export type DiagnosticsReportType = 'crash' | 'manual' | 'feedback';

export interface IpcBreadcrumb {
  channel: string;
  ts: string; // ISO timestamp UTC
  error?: boolean;
}

export interface RecordIpcOptions {
  error?: boolean;
  safeArgs?: string;
}

export interface StateSnapshot {
  app_version: string;
  electron_version: string;
  os: string;
  arch: string;
  memory_mb: number;
  recent_ipc: IpcBreadcrumb[];
}

export interface CrashErrorInfo {
  message: string;
  type: string;
  stack: string;
}

export interface CrashMethodInfo {
  name: string;
  channel?: string;
  args_summary?: string;
}

export interface CrashPayload {
  type: 'crash';
  report_id: string;
  timestamp: string;
  app_version: string;
  build_id?: string;
  electron_version: string;
  os: string;
  arch: string;
  error: CrashErrorInfo;
  method?: CrashMethodInfo;
  recent_ipc: IpcBreadcrumb[];
  user_description: string | null;
  pending_send: boolean;
}

export interface ManualPayload {
  type: 'manual';
  report_id: string;
  timestamp: string;
  app_version: string;
  build_id?: string;
  electron_version: string;
  os: string;
  arch: string;
  user_description: string;
  state?: StateSnapshot;
}

export interface FeedbackPayload {
  type: 'feedback';
  report_id: string;
  timestamp: string;
  app_version: string;
  build_id?: string;
  user_description: string;
}

export type DiagnosticsPayload = CrashPayload | ManualPayload | FeedbackPayload;

export interface RendererErrorPayload {
  message: string;
  stack?: string;
  componentStack?: string;
}

/**
 * Replace home directory and OS usernames in any string with generic tokens.
 * Targets stack traces most aggressively - frame paths nearly always contain
 * the user's home path.
 */
function sanitizeString(input: string): string {
  if (!input) return input;
  let out = input;

  // Replace home dir with ~
  try {
    const home = os.homedir();
    if (home) {
      const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'g'), '~');
    }
  } catch {
    // ignore
  }

  // Replace USER / USERNAME / LOGNAME env values if set
  const userValues = [
    process.env.USER,
    process.env.USERNAME,
    process.env.LOGNAME,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  for (const u of userValues) {
    const escaped = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), '<user>');
  }

  // Windows-style user paths: C:\Users\<name>\...
  out = out.replace(
    /([a-zA-Z]:\\Users\\)[^\\\/\s"']+/g,
    '$1<user>'
  );
  // POSIX /home/<name>/... and /Users/<name>/... - collapse to ~
  out = out.replace(/\/home\/[^\/\s"']+/g, '~');
  out = out.replace(/\/Users\/[^\/\s"']+/g, '~');

  return out;
}

function sanitizeStack(stack: string | undefined): string {
  if (!stack) return '';
  return sanitizeString(stack);
}

function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Derive a short stable "os" string (name + kernel) without hostname or
 * locale. Example: `"Linux 5.15"` or `"Windows_NT 10.0"`.
 */
function osSummary(): string {
  return `${os.type()} ${os.release().split('-')[0] ?? os.release()}`;
}

export class DiagnosticsService {
  private ring: IpcBreadcrumb[] = [];
  private crashCount = 0;
  private dedup = new Set<string>();

  recordIpc(channel: string, opts: RecordIpcOptions = {}): void {
    // Store channel name + ISO timestamp only. `safeArgs` is intentionally
    // not stored in the ring (it would inflate memory and risks accidental
    // content capture); if a caller passes it, we just drop it here. The
    // field exists so a future version can route it straight into crash
    // payloads without re-plumbing the API.
    void opts.safeArgs;
    const entry: IpcBreadcrumb = { channel, ts: nowIso() };
    if (opts.error) entry.error = true;
    this.ring.push(entry);
    if (this.ring.length > DIAGNOSTICS_RING_SIZE) {
      this.ring.shift();
    }
  }

  getRecentIpc(): IpcBreadcrumb[] {
    return this.ring.slice();
  }

  /**
   * Snapshot of environment + memory. Deliberately excludes timezone,
   * locale, hostname, file paths, user identity, and module library.
   */
  getStateSnapshot(): StateSnapshot {
    const mem = process.memoryUsage();
    const memory_mb = Math.round(mem.rss / (1024 * 1024));
    return {
      app_version: app.getVersion(),
      electron_version: process.versions.electron ?? '',
      os: osSummary(),
      arch: process.arch,
      memory_mb,
      recent_ipc: this.getRecentIpc(),
    };
  }

  /**
   * Compute a dedup hash from the message + first five stack frames.
   * Returns true if we've already captured this exact signature this session.
   */
  private isDuplicate(message: string, stack: string): boolean {
    const frames = stack.split('\n').slice(0, 5).join('\n');
    const hash = crypto
      .createHash('sha1')
      .update(`${message}\n${frames}`)
      .digest('hex');
    if (this.dedup.has(hash)) return true;
    this.dedup.add(hash);
    return false;
  }

  private exceededCap(): boolean {
    if (this.crashCount >= DIAGNOSTICS_CRASHES_PER_SESSION_CAP) {
      log.warn(
        `[diagnostics] Per-session crash cap (${DIAGNOSTICS_CRASHES_PER_SESSION_CAP}) reached; dropping further captures.`
      );
      return true;
    }
    return false;
  }

  /**
   * Capture an uncaught exception or unhandled rejection from the main
   * process. Returns the built payload (caller enqueues).
   */
  captureMainError(err: unknown, source: string): CrashPayload | null {
    if (this.exceededCap()) return null;

    const error = err instanceof Error ? err : new Error(String(err));
    const message = sanitizeString(error.message ?? 'Unknown error');
    const stack = sanitizeStack(error.stack);

    if (this.isDuplicate(message, stack)) {
      log.info(`[diagnostics] Duplicate main error suppressed: ${message}`);
      return null;
    }

    this.crashCount++;
    return this.buildCrashPayload({
      message,
      type: error.name || 'Error',
      stack,
      methodName: source,
    });
  }

  /**
   * Capture a renderer-side error (window.onerror, unhandledrejection, or
   * React ErrorBoundary). The renderer has already stringified stack+message
   * before sending over IPC.
   */
  captureRendererError(payload: RendererErrorPayload): CrashPayload | null {
    if (this.exceededCap()) return null;

    const message = sanitizeString(payload.message ?? 'Renderer error');
    const stackRaw = [payload.stack, payload.componentStack]
      .filter((s): s is string => !!s)
      .join('\n');
    const stack = sanitizeStack(stackRaw);

    if (this.isDuplicate(message, stack)) {
      log.info(`[diagnostics] Duplicate renderer error suppressed: ${message}`);
      return null;
    }

    this.crashCount++;
    return this.buildCrashPayload({
      message,
      type: 'RendererError',
      stack,
      methodName: 'renderer',
    });
  }

  buildCrashPayload(args: {
    message: string;
    type: string;
    stack: string;
    methodName: string;
    channel?: string;
    argsSummary?: string;
  }): CrashPayload {
    const method: CrashMethodInfo = { name: args.methodName };
    if (args.channel) method.channel = args.channel;
    if (args.argsSummary) method.args_summary = sanitizeString(args.argsSummary);
    return {
      type: 'crash',
      report_id: shortId(),
      timestamp: nowIso(),
      app_version: app.getVersion(),
      ...(BUILD_ID ? { build_id: BUILD_ID } : {}),
      electron_version: process.versions.electron ?? '',
      os: osSummary(),
      arch: process.arch,
      error: {
        message: args.message,
        type: args.type,
        stack: args.stack,
      },
      method,
      recent_ipc: this.getRecentIpc(),
      user_description: null,
      pending_send: false,
    };
  }

  buildManualPayload(args: {
    description: string;
    includeDiagnostics: boolean;
  }): ManualPayload {
    const payload: ManualPayload = {
      type: 'manual',
      report_id: shortId(),
      timestamp: nowIso(),
      app_version: app.getVersion(),
      ...(BUILD_ID ? { build_id: BUILD_ID } : {}),
      electron_version: process.versions.electron ?? '',
      os: osSummary(),
      arch: process.arch,
      user_description: args.description,
    };
    if (args.includeDiagnostics) {
      payload.state = this.getStateSnapshot();
    }
    return payload;
  }

  buildFeedbackPayload(args: { description: string }): FeedbackPayload {
    return {
      type: 'feedback',
      report_id: shortId(),
      timestamp: nowIso(),
      app_version: app.getVersion(),
      ...(BUILD_ID ? { build_id: BUILD_ID } : {}),
      user_description: args.description,
    };
  }
}
