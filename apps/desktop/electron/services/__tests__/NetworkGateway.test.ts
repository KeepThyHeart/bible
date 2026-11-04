/**
 * Tests for the single network egress gateway.
 *
 * Two concerns:
 *   1. The master offline switch refuses EVERY egress path before a socket is
 *      opened (`createRequest`, `fetchBuffered`, `downloadStream`).
 *   2. The redirect/scheme/size-cap security policy is enforced here, driven
 *      by a mocked Electron `net`. Callers such as ModuleCatalogService and
 *      DownloadService delegate to the gateway rather than re-asserting it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { NETWORK_MAX_REDIRECTS, CATALOG_MAX_RESPONSE_BYTES } from '../../config/constants';
import {
  NetworkGateway,
  NetworkBlockedError,
  __setNetForTests,
  type NetworkConfigLike,
} from '../NetworkGateway';
import { fakeNet, requestedHeaders, requestedUrls, resetFakeNet, setFakeRoute } from './fakeNet';

let allowNetwork = true;
const config: NetworkConfigLike = { get: () => ({ allowNetwork }) };

function makeGateway(): NetworkGateway {
  return new NetworkGateway(config);
}

const VALID_CATALOG = JSON.stringify({ repository: { name: 'Test' }, modules: [] });

beforeEach(() => {
  resetFakeNet();
  allowNetwork = true;
  __setNetForTests(fakeNet);
});

afterEach(() => {
  __setNetForTests(undefined);
});

describe('NetworkGateway — master offline switch', () => {
  it('treats a config with no allowNetwork flag as offline', () => {
    // Fails CLOSED. A corrupt config, a config written by an older build, or a
    // read that threw must all leave the app quiet rather than online - the
    // whole reason the flag is phrased positively.
    const gw = new NetworkGateway({ get: () => ({}) as { allowNetwork: boolean } });

    expect(gw.isOffline()).toBe(true);
    expect(() => gw.assertEgressAllowed('x')).toThrow(NetworkBlockedError);
  });

  it('isOffline reflects the config and assertEgressAllowed throws when offline', () => {
    const gw = makeGateway();
    expect(gw.isOffline()).toBe(false);
    expect(() => gw.assertEgressAllowed('x')).not.toThrow();

    allowNetwork = false;
    expect(gw.isOffline()).toBe(true);
    expect(() => gw.assertEgressAllowed('x')).toThrow(NetworkBlockedError);
  });

  it('refuses every path with NO socket opened when offline', async () => {
    allowNetwork = false;
    const gw = makeGateway();

    expect(() => gw.createRequest({ url: 'https://x.example/a', context: 't' })).toThrow(
      NetworkBlockedError
    );
    await expect(
      gw.fetchBuffered({ url: 'https://x.example/a', maxResponseBytes: 1000, context: 't' })
    ).rejects.toThrow(NetworkBlockedError);
    await expect(
      gw.downloadStream({ url: 'https://x.example/a', context: 't' })
    ).rejects.toThrow(NetworkBlockedError);

    // The crux: not a single request reached the (fake) socket layer.
    expect(requestedUrls).toHaveLength(0);
  });

  it('online: fetchBuffered passes through and returns the body', async () => {
    setFakeRoute(() => ({ statusCode: 200, chunks: [VALID_CATALOG] }));
    const gw = makeGateway();
    const res = await gw.fetchBuffered({
      url: 'https://repo.example/catalog.json',
      maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
      context: 'catalog fetch',
    });
    expect(res.status).toBe(200);
    expect(res.body.toString('utf-8')).toBe(VALID_CATALOG);
    expect(requestedUrls).toEqual(['https://repo.example/catalog.json']);
  });
});

describe('NetworkGateway — fetchBuffered redirect/scheme/size policy', () => {
  it('follows a bounded number of redirects then gives up', async () => {
    let hop = 0;
    setFakeRoute(() => ({
      statusCode: 302,
      headers: { location: `https://repo.example/hop${++hop}/catalog.json` },
    }));
    const gw = makeGateway();
    await expect(
      gw.fetchBuffered({
        url: 'https://repo.example/catalog.json',
        maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
        context: 'catalog fetch',
      })
    ).rejects.toThrow(/Too many redirects/);
    expect(requestedUrls).toHaveLength(NETWORK_MAX_REDIRECTS + 1);
  });

  it('follows a redirect chain that terminates within the limit', async () => {
    setFakeRoute((req) => {
      if (req.url === 'https://repo.example/catalog.json') {
        return { statusCode: 301, headers: { location: '/v2/catalog.json' } };
      }
      return { statusCode: 200, chunks: [VALID_CATALOG] };
    });
    const gw = makeGateway();
    const res = await gw.fetchBuffered({
      url: 'https://repo.example/catalog.json',
      maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
      context: 'catalog fetch',
    });
    expect(res.status).toBe(200);
    expect(requestedUrls).toEqual([
      'https://repo.example/catalog.json',
      'https://repo.example/v2/catalog.json',
    ]);
  });

  it('honours 303/307/308', async () => {
    for (const status of [303, 307, 308]) {
      resetFakeNet();
      setFakeRoute((req) =>
        req.url.includes('/final/')
          ? { statusCode: 200, chunks: [VALID_CATALOG] }
          : { statusCode: status, headers: { location: 'https://repo.example/final/catalog.json' } }
      );
      const gw = makeGateway();
      const res = await gw.fetchBuffered({
        url: 'https://repo.example/catalog.json',
        maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
        context: 'catalog fetch',
      });
      expect(res.status).toBe(200);
      expect(requestedUrls).toHaveLength(2);
    }
  });

  it('refuses an https → http downgrade on redirect', async () => {
    setFakeRoute(() => ({
      statusCode: 302,
      headers: { location: 'http://repo.example/catalog.json' },
    }));
    const gw = makeGateway();
    await expect(
      gw.fetchBuffered({
        url: 'https://repo.example/catalog.json',
        maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
        context: 'catalog fetch',
      })
    ).rejects.toThrow(/https → http downgrade/);
    expect(requestedUrls).toHaveLength(1);
  });

  it('refuses a redirect into a non-HTTP scheme', async () => {
    setFakeRoute(() => ({
      statusCode: 302,
      headers: { location: 'file:///C:/Windows/System32/calc.exe' },
    }));
    const gw = makeGateway();
    await expect(
      gw.fetchBuffered({
        url: 'https://repo.example/catalog.json',
        maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
        context: 'catalog fetch',
      })
    ).rejects.toThrow(/unsupported scheme/);
  });

  it('rejects a non-http(s) URL before making a request', async () => {
    const gw = makeGateway();
    await expect(
      gw.fetchBuffered({
        url: 'file:///C:/modules/catalog.json',
        maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
        context: 'catalog fetch',
      })
    ).rejects.toThrow(/unsupported scheme/);
    expect(requestedUrls).toHaveLength(0);
  });

  it('aborts once the response body exceeds the size cap', async () => {
    const megabyte = Buffer.alloc(1024 * 1024, 0x61);
    const chunkCount = Math.ceil(CATALOG_MAX_RESPONSE_BYTES / megabyte.length) + 2;
    setFakeRoute(() => ({
      statusCode: 200,
      chunks: Array.from({ length: chunkCount }, () => megabyte),
    }));
    const gw = makeGateway();
    await expect(
      gw.fetchBuffered({
        url: 'https://repo.example/catalog.json',
        maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
        context: 'catalog fetch',
      })
    ).rejects.toThrow(new RegExp(`exceeded the ${CATALOG_MAX_RESPONSE_BYTES} byte limit`));
  });

  it('maxRedirects:0 returns a 3xx verbatim instead of following it', async () => {
    setFakeRoute(() => ({
      statusCode: 302,
      headers: { location: 'https://repo.example/next', 'retry-after': '5' },
    }));
    const gw = makeGateway();
    const res = await gw.fetchBuffered({
      url: 'https://repo.example/x',
      maxResponseBytes: 1024,
      maxRedirects: 0,
      context: 'diagnostics upload',
    });
    expect(res.status).toBe(302);
    expect(res.headers['retry-after']).toBe('5');
    expect(requestedUrls).toHaveLength(1);
  });
});

describe('NetworkGateway — downloadStream', () => {
  it('resolves with a readable response stream on success', async () => {
    setFakeRoute(() => ({ statusCode: 200, chunks: ['module-bytes'] }));
    const gw = makeGateway();
    const result = await gw.downloadStream({ url: 'https://cdn.example/module.db', context: 'download' });
    expect(result.status).toBe(200);
    // Drain to prove the stream is usable by the caller.
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      result.response.on('data', (c: Buffer) => chunks.push(c));
      result.response.on('end', () => resolve());
      result.response.on('error', reject);
    });
    expect(Buffer.concat(chunks).toString()).toBe('module-bytes');
  });

  it('follows redirects and refuses an https → http downgrade', async () => {
    setFakeRoute(() => ({ statusCode: 301, headers: { location: 'http://cdn.example/module.db' } }));
    const gw = makeGateway();
    await expect(
      gw.downloadStream({ url: 'https://cdn.example/module.db', context: 'download' })
    ).rejects.toThrow(/https → http downgrade/);
    expect(requestedUrls).toHaveLength(1);
  });

  it('follows a redirect chain that terminates within the limit', async () => {
    setFakeRoute((req) =>
      req.url.includes('/final/')
        ? { statusCode: 200, chunks: ['bytes'] }
        : { statusCode: 307, headers: { location: 'https://cdn.example/final/module.db' } }
    );
    const gw = makeGateway();
    const result = await gw.downloadStream({ url: 'https://cdn.example/module.db', context: 'download' });
    expect(result.status).toBe(200);
    expect(requestedUrls).toHaveLength(2);
  });
});

describe('NetworkGateway — Electron manual-redirect `redirect` event (B-134)', () => {
  const HF = 'https://huggingface.co/onnx-community/whisper-base/resolve/abc/config.json';

  it('downloadStream follows a 307 with a RELATIVE Location delivered as a redirect event', async () => {
    setFakeRoute((req) =>
      req.url.includes('/api/resolve-cache/')
        ? { statusCode: 206, chunks: ['tail'] }
        : {
            statusCode: 307,
            headers: { location: '/api/resolve-cache/models/whisper-base/abc/config.json' },
            viaRedirectEvent: true,
          }
    );
    const result = await makeGateway().downloadStream({
      url: HF,
      headers: { Range: 'bytes=100-' },
      context: 'download',
    });
    expect(result.status).toBe(206);
    expect(result.url).toBe(
      'https://huggingface.co/api/resolve-cache/models/whisper-base/abc/config.json'
    );
    expect(requestedUrls).toHaveLength(2);
    // Range-resume survives the hop.
    expect(requestedHeaders[1]?.Range).toBe('bytes=100-');
  });

  it('downloadStream refuses a downgrade and a redirect loop on the event path', async () => {
    setFakeRoute(() => ({
      statusCode: 307,
      headers: { location: 'http://cdn.example/x' },
      viaRedirectEvent: true,
    }));
    await expect(
      makeGateway().downloadStream({ url: 'https://cdn.example/x', context: 'download' })
    ).rejects.toThrow(/downgrade/);

    resetFakeNet();
    setFakeRoute(() => ({
      statusCode: 302,
      headers: { location: '/loop' },
      viaRedirectEvent: true,
    }));
    await expect(
      makeGateway().downloadStream({ url: 'https://cdn.example/loop', context: 'download' })
    ).rejects.toThrow(/Too many redirects/);
    expect(requestedUrls).toHaveLength(NETWORK_MAX_REDIRECTS + 1);
  });

  it('fetchBuffered follows the redirect event, and returns it verbatim with maxRedirects 0', async () => {
    setFakeRoute((req) =>
      req.url.endsWith('/final')
        ? { statusCode: 200, chunks: ['ok'] }
        : { statusCode: 307, headers: { location: '/final' }, viaRedirectEvent: true }
    );
    const gw = makeGateway();
    const res = await gw.fetchBuffered({
      url: 'https://a.example/start',
      maxResponseBytes: 100,
      context: 't',
    });
    expect(res.body.toString()).toBe('ok');

    resetFakeNet();
    setFakeRoute(() => ({ statusCode: 307, headers: { location: '/final' }, viaRedirectEvent: true }));
    const raw = await gw.fetchBuffered({
      url: 'https://a.example/start',
      maxResponseBytes: 100,
      maxRedirects: 0,
      context: 't',
    });
    expect(raw.status).toBe(307);
    expect(requestedUrls).toHaveLength(1);
  });
});
