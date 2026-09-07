/**
 * Simple file-based logger for the web server.
 *
 * Writes timestamped log entries to a rotating log file in the data directory.
 * Falls back to console-only if the log file can't be opened.
 */
import { createWriteStream, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { resolve } from 'path';
import type { WriteStream } from 'fs';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB before rotation
const MAX_ROTATED_FILES = 3;

let logStream: WriteStream | null = null;
let logFilePath: string | null = null;

export type PrivacyMode = 'strict' | 'relaxed';

// Privacy mode defaults to strict so we never write client-identifying data
// to disk before the server has finished reading its config at startup.
let privacyMode: PrivacyMode = 'strict';

function timestamp(): string {
  return new Date().toISOString();
}

// Matches IPv4 (including IPv4-mapped IPv6 like ::ffff:1.2.3.4) and most IPv6
// forms. Not comprehensive — the goal is to scrub accidental inclusions, not
// to defeat a determined caller who passes obfuscated addresses.
const IPV4 = /(?:\d{1,3}\.){3}\d{1,3}/g;
const IPV6 = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g;

function scrub(message: string): string {
  return message.replace(IPV4, '[ip]').replace(IPV6, '[ip]');
}

function rotateIfNeeded(): void {
  if (!logFilePath || !existsSync(logFilePath)) return;
  try {
    const stats = statSync(logFilePath);
    if (stats.size < MAX_LOG_SIZE) return;

    // Close current stream
    logStream?.end();
    logStream = null;

    // Rotate: server.3.log -> deleted, server.2.log -> server.3.log, etc.
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const older = `${logFilePath}.${i}`;
      const newer = i === 1 ? logFilePath : `${logFilePath}.${i - 1}`;
      if (existsSync(newer)) {
        if (i === MAX_ROTATED_FILES && existsSync(older)) {
          // oldest file is discarded by overwrite
        }
        renameSync(newer, older);
      }
    }

    // Reopen fresh log
    logStream = createWriteStream(logFilePath, { flags: 'a' });
  } catch {
    // Non-fatal — continue logging to console
  }
}

function write(level: string, message: string, ...args: unknown[]): void {
  const prefix = `${timestamp()} [${level}]`;
  const body = args.length > 0
    ? `${message} ${args.map(a => a instanceof Error ? a.stack ?? a.message : String(a)).join(' ')}`
    : message;
  const safeBody = privacyMode === 'strict' ? scrub(body) : body;
  const formatted = `${prefix} ${safeBody}`;

  // Always write to stdout/stderr
  if (level === 'ERROR' || level === 'WARN') {
    console.error(formatted);
  } else {
    console.log(formatted);
  }

  // Write to file if available
  if (logStream) {
    logStream.write(formatted + '\n');
    rotateIfNeeded();
  }
}

export const logger = {
  /** Initialize file logging. Call once at startup with the data directory path. */
  init(dataDir: string): void {
    try {
      const logsDir = resolve(dataDir, 'logs');
      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
      }
      logFilePath = resolve(logsDir, 'server.log');
      logStream = createWriteStream(logFilePath, { flags: 'a' });
      write('INFO', `Log file: ${logFilePath}`);
    } catch (err) {
      console.error(`[Server] Failed to initialize file logging: ${err}`);
      // Continue without file logging
    }
  },

  info(message: string, ...args: unknown[]): void {
    write('INFO', message, ...args);
  },

  warn(message: string, ...args: unknown[]): void {
    write('WARN', message, ...args);
  },

  error(message: string, ...args: unknown[]): void {
    write('ERROR', message, ...args);
  },

  /**
   * Set privacy mode. In "strict", IP addresses are scrubbed from log lines
   * and `logger.sensitive()` is dropped entirely. Call at startup after
   * loading config.
   */
  setPrivacyMode(mode: PrivacyMode): void {
    privacyMode = mode;
  },

  getPrivacyMode(): PrivacyMode {
    return privacyMode;
  },

  /**
   * Log a message that may contain client-identifying data (IPs, user-agents,
   * headers, request bodies). Dropped silently when privacy mode is "strict".
   * Use this for any log line whose content you would not want persisted on a
   * seized server.
   */
  sensitive(message: string, ...args: unknown[]): void {
    if (privacyMode !== 'relaxed') return;
    write('INFO', message, ...args);
  },

  /** Returns the current log file path, or null if file logging is not active. */
  getLogPath(): string | null {
    return logFilePath;
  },
};
