/**
 * Unit tests for UpdateCheckService (manual, user-initiated updates).
 *
 * The service performs its single request through the injected `NetworkGateway`
 * seam, so we inject a `FakeNetworkGateway` and script `fetchBuffered`. `electron`
 * is mocked for `app.getVersion`. These tests pin the behaviours the persecuted-
 * user model depends on: `getInfo()` never touches the network, offline mode
 * blocks the check, and version comparison is correct.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const appVersion = vi.hoisted(() => ({ value: '1.2.3' }));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => appVersion.value),
  },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  UpdateCheckService,
  compareVersions,
  isNewer,
  normalizeVersion,
  pickLatestRelease,
  prereleaseChannel,
} from '../UpdateCheckService';
import { FakeNetworkGateway, fetchResult } from './fakeNetworkGateway';

const MANIFEST = 'https://api.github.com/repos/KeepThyHeart/bible/releases/latest';

beforeEach(() => {
  delete process.env.BIBLE_UPDATE_MANIFEST_URL;
  appVersion.value = '1.2.3';
});

describe('normalizeVersion / isNewer', () => {
  it('strips a leading v', () => {
    expect(normalizeVersion('v2.0.1')).toBe('2.0.1');
    expect(normalizeVersion('  1.0.0 ')).toBe('1.0.0');
  });

  it('compares numeric triples, not strings', () => {
    expect(isNewer('1.10.0', '1.9.0')).toBe(true); // 10 > 9 numerically
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('1.2.3', '1.2.3')).toBe(false);
    expect(isNewer('1.2.2', '1.2.3')).toBe(false);
  });

  it('orders pre-releases by semver precedence', () => {
    expect(isNewer('1.3.0-beta.1', '1.2.9')).toBe(true);
    expect(isNewer('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true);
    expect(isNewer('1.0.0-beta.10', '1.0.0-beta.2')).toBe(true); // numeric, not text
    expect(isNewer('1.0.0-rc.1', '1.0.0-beta.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true); // release beats its pre-releases
    expect(isNewer('1.0.0-beta.1', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0-beta.1', '1.0.0-beta.1')).toBe(false);
    expect(isNewer('1.0.0-beta', '1.0.0-beta.1')).toBe(false); // fewer identifiers sort first
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0); // build metadata ignored
  });

  it('reads the pre-release channel', () => {
    expect(prereleaseChannel('v1.0.0-beta.2')).toBe('beta');
    expect(prereleaseChannel('1.0.0')).toBeNull();
    expect(prereleaseChannel('junk')).toBeNull();
  });

  it('fails safe on unparseable input (never nags)', () => {
    expect(isNewer('not-a-version', '1.0.0')).toBe(false);
  });
});

describe('getInfo', () => {
  it('reports the host without making any request', () => {
    const gw = new FakeNetworkGateway();
    const svc = new UpdateCheckService(gw);
    const info = svc.getInfo();
    expect(info.host).toBe('api.github.com');
    expect(info.manifestUrl).toBe(MANIFEST);
    expect(info.currentVersion).toBe('1.2.3');
    expect(info.offline).toBe(false);
    expect(info.configured).toBe(true);
    // The whole point: pre-flight touches no socket.
    expect(gw.fetchCalls.length).toBe(0);
  });

  it('surfaces offline state from the gateway', () => {
    const gw = new FakeNetworkGateway();
    gw.offline = true;
    expect(new UpdateCheckService(gw).getInfo().offline).toBe(true);
  });
});

describe('check', () => {
  it('returns "offline" and makes no request when offline', async () => {
    const gw = new FakeNetworkGateway();
    gw.offline = true;
    const outcome = await new UpdateCheckService(gw).check();
    expect(outcome).toEqual({ status: 'offline', host: 'api.github.com' });
    expect(gw.fetchCalls.length).toBe(0);
  });

  it('reports an available update with notes + download url', async () => {
    const gw = new FakeNetworkGateway();
    gw.fetchBufferedImpl = () =>
      Promise.resolve(
        fetchResult(
          200,
          JSON.stringify({
            tag_name: 'v2.0.0',
            body: 'Shiny new things',
            html_url: 'https://example.test/releases/v2.0.0',
          }),
        ),
      );
    const outcome = await new UpdateCheckService(gw).check();
    expect(outcome.status).toBe('update-available');
    if (outcome.status === 'update-available') {
      expect(outcome.latestVersion).toBe('2.0.0');
      expect(outcome.currentVersion).toBe('1.2.3');
      expect(outcome.releaseNotes).toBe('Shiny new things');
      expect(outcome.releaseUrl).toBe('https://example.test/releases/v2.0.0');
    }
    // Egress went through the gateway (not a raw socket).
    expect(gw.fetchCalls.length).toBe(1);
    expect(gw.fetchCalls[0]!.url).toBe(MANIFEST);
  });

  it('reports up-to-date when the latest equals the running version', async () => {
    const gw = new FakeNetworkGateway();
    gw.fetchBufferedImpl = () =>
      Promise.resolve(fetchResult(200, JSON.stringify({ tag_name: 'v1.2.3' })));
    const outcome = await new UpdateCheckService(gw).check();
    expect(outcome.status).toBe('up-to-date');
  });

  it('classifies a non-2xx as an error', async () => {
    const gw = new FakeNetworkGateway();
    gw.fetchBufferedImpl = () => Promise.resolve(fetchResult(503, ''));
    const outcome = await new UpdateCheckService(gw).check();
    expect(outcome.status).toBe('error');
  });

  it('classifies a network rejection as an error, not a throw', async () => {
    const gw = new FakeNetworkGateway();
    gw.fetchBufferedImpl = () => Promise.reject(new Error('ECONNRESET'));
    const outcome = await new UpdateCheckService(gw).check();
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') expect(outcome.message).toContain('ECONNRESET');
  });
});

describe('pickLatestRelease', () => {
  const list = (...tags: Array<string | [string, { draft?: boolean }]>) =>
    tags.map((t) => (Array.isArray(t) ? { tag_name: t[0], ...t[1] } : { tag_name: t }));

  it('takes stable releases only on a stable install', () => {
    const picked = pickLatestRelease(list('v1.1.0-beta.1', 'v1.0.1', 'v1.0.0'), '1.0.0');
    expect(picked?.tag_name).toBe('v1.0.1');
  });

  it('takes the newest beta or stable on a beta install, by version not list order', () => {
    expect(
      pickLatestRelease(list('v1.0.0-beta.2', 'v1.0.0-beta.3', 'v0.1.0-beta.1'), '1.0.0-beta.1')
        ?.tag_name
    ).toBe('v1.0.0-beta.3');
    expect(pickLatestRelease(list('v1.0.0', 'v1.0.0-beta.3'), '1.0.0-beta.1')?.tag_name).toBe('v1.0.0');
  });

  it('follows electron-updater: no beta -> alpha, no other channels unless on them', () => {
    expect(pickLatestRelease(list('v1.1.0-alpha.1', 'v1.0.0-rc.1'), '1.0.0-beta.1')).toBeNull();
    expect(pickLatestRelease(list('v1.0.0-beta.1'), '1.0.0-alpha.3')?.tag_name).toBe('v1.0.0-beta.1');
    expect(pickLatestRelease(list('v1.0.0-rc.2'), '1.0.0-rc.1')?.tag_name).toBe('v1.0.0-rc.2');
  });

  it('ignores drafts and junk', () => {
    const releases = [...list(['v9.0.0', { draft: true }], 'not-a-tag'), null as never];
    expect(pickLatestRelease(releases, '1.0.0-beta.1')).toBeNull();
  });
});

describe('check on a pre-release install', () => {
  it('reads the release list and offers the next beta', async () => {
    appVersion.value = '1.0.0-beta.1';
    const gw = new FakeNetworkGateway();
    gw.fetchBufferedImpl = () =>
      Promise.resolve(
        fetchResult(
          200,
          JSON.stringify([
            { tag_name: 'v1.0.0-beta.2', prerelease: true, html_url: 'https://example.test/b2' },
            { tag_name: 'v1.0.0-beta.1', prerelease: true },
          ])
        )
      );
    const svc = new UpdateCheckService(gw);
    expect(svc.getInfo().manifestUrl).toBe(
      'https://api.github.com/repos/KeepThyHeart/bible/releases?per_page=10'
    );
    const outcome = await svc.check();
    expect(gw.fetchCalls[0]!.url).toBe(
      'https://api.github.com/repos/KeepThyHeart/bible/releases?per_page=10'
    );
    expect(outcome.status).toBe('update-available');
    if (outcome.status === 'update-available') {
      expect(outcome.latestVersion).toBe('1.0.0-beta.2');
      expect(outcome.releaseUrl).toBe('https://example.test/b2');
    }
  });

  it('is up to date when nothing in the list is newer or allowed', async () => {
    appVersion.value = '1.0.0-beta.2';
    const gw = new FakeNetworkGateway();
    gw.fetchBufferedImpl = () =>
      Promise.resolve(fetchResult(200, JSON.stringify([{ tag_name: 'v1.0.0-beta.2' }])));
    expect((await new UpdateCheckService(gw).check()).status).toBe('up-to-date');
    gw.fetchBufferedImpl = () => Promise.resolve(fetchResult(200, '[]'));
    expect((await new UpdateCheckService(gw).check()).status).toBe('up-to-date');
  });

  it('leaves a custom manifest URL alone', () => {
    appVersion.value = '1.0.0-beta.1';
    process.env.BIBLE_UPDATE_MANIFEST_URL = 'https://updates.example.org/manifest.json';
    expect(new UpdateCheckService(new FakeNetworkGateway()).getInfo().manifestUrl).toBe(
      'https://updates.example.org/manifest.json'
    );
  });
});
