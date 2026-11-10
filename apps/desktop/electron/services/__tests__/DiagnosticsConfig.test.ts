/**
 * DiagnosticsConfig endpoint defaulting, and the build-time resolution of that
 * default (`resolveDiagnosticsEndpoint`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { DiagnosticsConfig } from '../DiagnosticsConfig';
import {
  DEFAULT_DIAGNOSTICS_URL,
  DIAGNOSTICS_DEFAULT_ENDPOINT,
  resolveDiagnosticsEndpoint,
} from '../../config/constants';

describe('resolveDiagnosticsEndpoint', () => {
  it('uses the official endpoint when the build sets nothing', () => {
    expect(resolveDiagnosticsEndpoint(undefined)).toBe(DEFAULT_DIAGNOSTICS_URL);
    expect(resolveDiagnosticsEndpoint('  ')).toBe(DEFAULT_DIAGNOSTICS_URL);
    expect(DEFAULT_DIAGNOSTICS_URL).toBe('https://bible.keepthyheart.com/api/desktop-report');
  });

  it('lets the build override it', () => {
    expect(resolveDiagnosticsEndpoint('https://reports.example.org/in')).toBe(
      'https://reports.example.org/in'
    );
  });

  it('lets the build opt out with "none"', () => {
    expect(resolveDiagnosticsEndpoint('none')).toBe('');
    expect(resolveDiagnosticsEndpoint('NONE')).toBe('');
  });

  it('is what an unconfigured (test) build gets', () => {
    expect(DIAGNOSTICS_DEFAULT_ENDPOINT).toBe(DEFAULT_DIAGNOSTICS_URL);
  });
});

describe('DiagnosticsConfig endpoint', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-cfg-'));
    file = path.join(dir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts with the default endpoint and diagnostics off', () => {
    const cfg = new DiagnosticsConfig(file).get();
    expect(cfg.endpointUrl).toBe(DEFAULT_DIAGNOSTICS_URL);
    expect(cfg.enabled).toBe(false);
  });

  it('reads a blank endpoint saved by an older version as the default', () => {
    // Older versions persisted the whole config, including `endpointUrl: ""`,
    // whenever any setting changed.
    fs.writeFileSync(file, JSON.stringify({ enabled: false, endpointUrl: '', dontAskAgain: true }));
    const cfg = new DiagnosticsConfig(file).get();
    expect(cfg.endpointUrl).toBe(DEFAULT_DIAGNOSTICS_URL);
    expect(cfg.dontAskAgain).toBe(true);
  });

  it('keeps a user override, and clearing it restores the default', () => {
    const config = new DiagnosticsConfig(file);
    expect(config.set({ endpointUrl: ' https://mine.example/r ' }).endpointUrl).toBe(
      'https://mine.example/r'
    );
    expect(new DiagnosticsConfig(file).get().endpointUrl).toBe('https://mine.example/r');
    expect(config.set({ endpointUrl: '' }).endpointUrl).toBe(DEFAULT_DIAGNOSTICS_URL);
  });
});
