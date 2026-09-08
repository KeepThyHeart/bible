/**
 * The master "Allow web requests" switch must be OFF unless the user has said
 * otherwise, and every way of failing to read that answer must land on OFF.
 *
 * The flag it replaced (`offlineMode`, default `false`) failed OPEN: the quiet
 * state was the one you had to set. These tests hold the inversion in place,
 * including the migration - an install that never answered the question is
 * asked again rather than being carried online by an old default.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { NetworkConfig } from '../NetworkConfig';

describe('NetworkConfig — allowNetwork', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'netcfg-'));
    file = join(dir, 'config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to false when no config file exists', () => {
    expect(new NetworkConfig(file).get().allowNetwork).toBe(false);
  });

  it('defaults to false when the config file is unreadable garbage', () => {
    writeFileSync(file, 'not json {{{');

    expect(new NetworkConfig(file).get().allowNetwork).toBe(false);
  });

  it('honours an explicit true', () => {
    writeFileSync(file, JSON.stringify({ allowNetwork: true }));

    expect(new NetworkConfig(file).get().allowNetwork).toBe(true);
  });

  it('does not read a legacy offlineMode:false as consent', () => {
    // `offlineMode: false` was the shipped DEFAULT, not a choice the user made.
    // Reading it as "yes, go online" would put every existing install on the
    // network without ever showing the confirmation dialog.
    writeFileSync(file, JSON.stringify({ offlineMode: false }));

    expect(new NetworkConfig(file).get().allowNetwork).toBe(false);
  });

  it('does not read a legacy offlineMode:true as consent either', () => {
    writeFileSync(file, JSON.stringify({ offlineMode: true }));

    expect(new NetworkConfig(file).get().allowNetwork).toBe(false);
  });

  it('persists a change and reloads it', () => {
    const cfg = new NetworkConfig(file);
    cfg.set({ allowNetwork: true });

    expect(new NetworkConfig(file).get().allowNetwork).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).allowNetwork).toBe(true);
  });

  it('creates the containing directory when persisting', () => {
    const nested = join(dir, 'network', 'config.json');
    new NetworkConfig(nested).set({ allowNetwork: true });

    expect(JSON.parse(readFileSync(nested, 'utf8')).allowNetwork).toBe(true);
  });

  it('survives a directory that already exists', () => {
    mkdirSync(join(dir, 'network'), { recursive: true });
    const nested = join(dir, 'network', 'config.json');

    expect(() => new NetworkConfig(nested).set({ allowNetwork: true })).not.toThrow();
  });
});
