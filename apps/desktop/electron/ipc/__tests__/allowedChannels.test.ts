/**
 * Contract test for the generic IPC channel allowlist.
 *
 * `allowedChannels.ts` is a hand-maintained list of ~290 channel names, and its
 * own header says so:
 *
 *   "MAINTENANCE: When adding a new `ipcHandler` or `ipcMain.handle`
 *    registration that the renderer calls via `ipcRenderer.invoke`, add the
 *    channel string here."
 *
 * A documented manual step with no check is a step that eventually gets missed,
 * and the failure is invisible in review: the renderer calls a channel, preload
 * drops it because it is not on the list, and the feature is dead in the
 * packaged app.
 *
 * So this walks the renderer source for `ipcRenderer.invoke('...')` call sites
 * and requires each one to be allowlisted. It reads files rather than running
 * the app because the whole point is to catch the mismatch before anything
 * runs.
 *
 * Scope: only the *generic* bridge is covered. Channels reached through typed
 * preload methods (`window.electron.bible.*`, `extensionBridge.invoke`, ...) have
 * their own dedicated bridge functions and deliberately do not appear in the
 * list - see the header of `allowedChannels.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { ALLOWED_IPC_CHANNELS } from '../allowedChannels';

const RENDERER_ROOT = resolve(__dirname, '../../../src');

/** Every .ts/.tsx file under the renderer source tree. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      sourceFiles(full, out);
      continue;
    }
    if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Remove block and line comments.
 *
 * Without this the scan picks up documentation - `ipcResult.ts` explains itself
 * with `await window.electron.ipcRenderer.invoke('foo:bar', arg)` - and reports
 * a channel nothing actually calls.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface CallSite {
  channel: string;
  file: string;
}

/**
 * Find `ipcRenderer.invoke('channel')` call sites.
 *
 * Anchored on `ipcRenderer.` rather than a bare `.invoke(` so that the typed
 * preload bridges and the extension bridge - which are not allowlisted by
 * design - are not swept in.
 */
function genericInvokeCallSites(): CallSite[] {
  const pattern = /ipcRenderer\s*\.\s*invoke\s*\(\s*['"]([^'"]+)['"]/g;
  const sites: CallSite[] = [];

  for (const file of sourceFiles(RENDERER_ROOT)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const match of text.matchAll(pattern)) {
      sites.push({ channel: match[1], file: file.slice(RENDERER_ROOT.length + 1) });
    }
  }
  return sites;
}

describe('ALLOWED_IPC_CHANNELS', () => {
  const allowed = new Set<string>(ALLOWED_IPC_CHANNELS);

  it('is free of duplicates', () => {
    // A duplicate is harmless at runtime but means two people added the same
    // channel in different sections, which is how the list rots.
    expect(allowed.size).toBe(ALLOWED_IPC_CHANNELS.length);
  });

  it('holds only non-empty, namespaced channel names', () => {
    for (const channel of ALLOWED_IPC_CHANNELS) {
      expect(channel).toMatch(/^[a-z][\w-]*:[\w:-]+$/i);
    }
  });

  it('covers every channel the renderer invokes through the generic bridge', () => {
    const sites = genericInvokeCallSites();

    // Guard the guard: if the scan finds nothing, the regex has drifted and
    // this test would pass vacuously.
    expect(sites.length).toBeGreaterThan(0);

    const missing = sites
      .filter(site => !allowed.has(site.channel))
      .map(site => `${site.channel} (${site.file})`);

    expect(missing, 'channels invoked but not allowlisted').toEqual([]);
  });
});
