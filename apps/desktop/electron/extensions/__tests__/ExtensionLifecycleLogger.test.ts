import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ExtensionLifecycleLogger } from '../ExtensionLifecycleLogger';

let tmpRoot: string;
let logger: ExtensionLifecycleLogger;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ext-logger-'));
  logger = new ExtensionLifecycleLogger(tmpRoot);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ExtensionLifecycleLogger', () => {
  it('appends and reads back log entries newest-first', () => {
    logger.appendLog('ext.acme.x', { ts: 1, level: 'info', message: 'first' });
    logger.appendLog('ext.acme.x', { ts: 2, level: 'warn', message: 'second' });
    logger.appendLog('ext.acme.x', { ts: 3, level: 'error', message: 'third' });

    const entries = logger.readLog('ext.acme.x');
    expect(entries.map((e) => e.message)).toEqual(['third', 'second', 'first']);
  });

  it('caps the returned log to the requested limit', () => {
    for (let i = 0; i < 5; i++) {
      logger.appendLog('ext.acme.x', { ts: i, level: 'info', message: `m${i}` });
    }
    const entries = logger.readLog('ext.acme.x', 2);
    expect(entries.map((e) => e.message)).toEqual(['m4', 'm3']);
  });

  it('appends and reads back crash records', () => {
    logger.appendCrash('ext.acme.x', {
      ts: 100,
      exitCode: 1,
      stderrTail: 'boom',
      lastRpcMethod: 'bible.getVerse',
    });
    const crashes = logger.readCrashLog('ext.acme.x');
    expect(crashes).toHaveLength(1);
    expect(crashes[0]?.exitCode).toBe(1);
    expect(crashes[0]?.lastRpcMethod).toBe('bible.getVerse');
  });

  it('returns an empty array for an extension that has no log file', () => {
    expect(logger.readLog('ext.never.existed')).toEqual([]);
    expect(logger.readCrashLog('ext.never.existed')).toEqual([]);
  });

  it('isolates logs per extension id', () => {
    logger.appendLog('ext.a.x', { ts: 1, level: 'info', message: 'a-only' });
    logger.appendLog('ext.b.x', { ts: 1, level: 'info', message: 'b-only' });
    expect(logger.readLog('ext.a.x').map((e) => e.message)).toEqual(['a-only']);
    expect(logger.readLog('ext.b.x').map((e) => e.message)).toEqual(['b-only']);
  });
});
