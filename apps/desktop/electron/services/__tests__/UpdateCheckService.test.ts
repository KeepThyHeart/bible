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

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.2.3'),
  },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  UpdateCheckService,
  isNewer,
  normalizeVersion,
} from '../UpdateCheckService';
import { FakeNetworkGateway, fetchResult } from './fakeNetworkGateway';

const MANIFEST = 'https://api.github.com/repos/psrankin/bible/releases/latest';

beforeEach(() => {
  delete process.env.BIBLE_UPDATE_MANIFEST_URL;
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

  it('ignores pre-release suffixes for the comparison', () => {
    expect(isNewer('1.3.0-beta.1', '1.2.9')).toBe(true);
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
