// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NotificationStateFile } from '../stateFile';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-state-'));
  file = path.join(dir, 'notifications.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const state = { version: 1 as const, checkpoints: { 'app:x': 5 }, items: {}, labels: { 'ext:a': 'A' } };

describe('NotificationStateFile', () => {
  it('reads defaults when the file is missing', () => {
    const f = new NotificationStateFile(file);
    expect(f.getDevice()).toEqual({ tray: false, openAtLogin: false });
    expect(f.statePort().load()).toBeNull();
  });

  it('round-trips scheduler state and device settings atomically', () => {
    const a = new NotificationStateFile(file);
    a.statePort().save(state);
    a.setDevice({ tray: true, openAtLogin: false });
    expect(fs.readdirSync(dir)).toEqual(['notifications.json']);
    const b = new NotificationStateFile(file);
    expect(b.statePort().load()).toEqual(state);
    expect(b.getDevice()).toEqual({ tray: true, openAtLogin: false });
  });

  it('tolerates a corrupt file and replaces it on the next save', () => {
    fs.writeFileSync(file, '{ not json');
    const errors: string[] = [];
    const f = new NotificationStateFile(file, (_e, ctx) => errors.push(ctx));
    expect(f.statePort().load()).toBeNull();
    expect(f.getDevice()).toEqual({ tray: false, openAtLogin: false });
    expect(errors).toEqual(['stateFile.read']);
    f.statePort().save(state);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).scheduler).toEqual(state);
  });

  it('ignores a scheduler block of an unknown version', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, scheduler: { version: 9 }, device: { tray: 'yes' } }));
    const f = new NotificationStateFile(file);
    expect(f.statePort().load()).toBeNull();
    expect(f.getDevice().tray).toBe(false);
  });
});
