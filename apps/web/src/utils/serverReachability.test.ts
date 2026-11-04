import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  installServerReachabilityMonitor,
  isServerReachable,
  onServerReachabilityChange,
  isGatewayFailure,
  __resetServerReachabilityForTests,
} from './serverReachability';

let fake: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetServerReachabilityForTests();
  fake = vi.fn();
  window.fetch = fake as unknown as typeof fetch;
  installServerReachabilityMonitor();
});

afterEach(() => {
  __resetServerReachabilityForTests();
  vi.useRealTimers();
});

const json = (status: number) => new Response('{}', { status, headers: { 'content-type': 'application/json' } });

describe('serverReachability', () => {
  it('marks the server unreachable when an API request fails to connect', async () => {
    fake.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(window.fetch('/api/bible/KJV/1/1')).rejects.toThrow();
    expect(isServerReachable()).toBe(false);
  });

  it('treats gateway statuses and the dev proxy\'s empty 500 as unreachable, real errors as reachable', () => {
    expect(isGatewayFailure(new Response('', { status: 503 }))).toBe(true);
    expect(isGatewayFailure(new Response(null, { status: 500 }))).toBe(true);
    expect(isGatewayFailure(json(500))).toBe(false);
    expect(isGatewayFailure(json(404))).toBe(false);
    // B-096: our server's own JSON 503 (upstream bibsearch failure) is not an outage.
    expect(isGatewayFailure(json(503))).toBe(false);
  });

  it('recovers on the next successful API response and notifies listeners', async () => {
    const seen: boolean[] = [];
    onServerReachabilityChange((r) => seen.push(r));
    fake.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await window.fetch('/api/x').catch(() => {});
    fake.mockResolvedValueOnce(json(200));
    await window.fetch('/api/x');
    expect(isServerReachable()).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it('ignores aborts and non-API requests', async () => {
    fake.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await window.fetch('/api/x').catch(() => {});
    fake.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await window.fetch('https://elsewhere.test/api/x').catch(() => {});
    fake.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await window.fetch('/assets/v1/index.json').catch(() => {});
    expect(isServerReachable()).toBe(true);
  });

  it('probes /api/version while unreachable', async () => {
    vi.useFakeTimers();
    fake.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await window.fetch('/api/x').catch(() => {});
    fake.mockResolvedValueOnce(json(200));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake).toHaveBeenLastCalledWith('/api/version', { cache: 'no-store' });
    expect(isServerReachable()).toBe(true);
  });
});
