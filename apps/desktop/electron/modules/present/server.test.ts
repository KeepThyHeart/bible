// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { request, type IncomingMessage } from 'node:http';
import { PresenterServer } from './server';
import type { PresentSnapshot } from './types';

const snap = (version: number, text = 'In the beginning'): PresentSnapshot => ({
  version,
  live: { reference: 'Genesis 1:1', module: 'KJV', bookName: 'Genesis', chapter: 1, verses: [{ verse: 1, text }], focus: 1 },
  display: { fontStep: 0, blanked: false, theme: 'dark' },
  viewerCount: 0,
});

const servers: PresenterServer[] = [];
async function started(options = {}) {
  const server = new PresenterServer(options);
  servers.push(server);
  const info = await server.start(snap(1));
  return { server, ...info };
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

function get(port: number, path: string, opts: { method?: string; host?: string } = {}): Promise<{ status: number; headers: IncomingMessage['headers']; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: opts.host ? { Host: opts.host } : {}, agent: false },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Open an SSE stream; resolves a reader that yields complete frames. */
function stream(port: number, path: string) {
  const frames: string[] = [];
  let waiter: (() => void) | null = null;
  let buffer = '';
  let res!: IncomingMessage;
  const opened = new Promise<void>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, agent: false }, (r) => {
      res = r;
      r.setEncoding('utf8');
      r.on('data', (chunk: string) => {
        buffer += chunk;
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          frames.push(buffer.slice(0, i));
          buffer = buffer.slice(i + 2);
        }
        waiter?.();
      });
      resolve();
    });
    req.on('error', reject);
    req.end();
  });
  return {
    opened,
    status: () => res.statusCode,
    async next(match: RegExp): Promise<string> {
      for (;;) {
        const i = frames.findIndex((f) => match.test(f));
        if (i >= 0) return frames.splice(i, 1)[0];
        await new Promise<void>((r) => {
          waiter = r;
          setTimeout(r, 2000);
        });
        if (!frames.some((f) => match.test(f))) throw new Error(`no frame matching ${match}; got ${JSON.stringify(frames)}`);
      }
    },
    close: () => res.destroy(),
  };
}

describe('PresenterServer binding', () => {
  it('binds to 127.0.0.1 only by default, on a random port, behind a long token', async () => {
    const a = await started();
    const b = await started();
    expect(a.server.bindAddress).toBe('127.0.0.1');
    expect(a.lan).toBe(false);
    expect(a.port).toBeGreaterThan(0);
    expect(a.port).not.toBe(b.port);
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect(a.server.pagePath).toBe(`/p/${a.token}/`);
  });

  it('binds to all interfaces only when LAN mode is requested', async () => {
    const lan = await started({ lan: true });
    expect(lan.server.bindAddress).toBe('0.0.0.0');
    expect(lan.lan).toBe(true);
  });

  it('releases the port on stop', async () => {
    const { server, port } = await started();
    await server.stop();
    await expect(get(port, '/')).rejects.toThrow();
    expect(server.running).toBe(false);
  });
});

describe('PresenterServer access control', () => {
  it('serves the page, script and style only with the exact token', async () => {
    const { port, token } = await started();
    for (const file of ['', 'viewer.js', 'viewer.css', 'state']) {
      const ok = await get(port, `/p/${token}/${file}`);
      expect(ok.status, file).toBe(200);
    }
    const page = await get(port, `/p/${token}/`);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.body).toContain('viewer.js');
  });

  it('answers 404 to a missing, wrong, truncated or extended token and to other paths', async () => {
    const { port, token } = await started();
    for (const path of ['/', '/p/', '/p//', '/p/nope/', `/p/${token.slice(0, -1)}/`, `/p/${token}x/`, `/${token}/`, '/state', '/events', `/p/${token}/other`, `/p/${token}/../x`]) {
      expect((await get(port, path)).status, path).toBe(404);
    }
    expect((await get(port, '/p/wrong/events')).status).toBe(404);
  });

  it('refuses everything except GET and HEAD', async () => {
    const { port, token } = await started();
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      expect((await get(port, `/p/${token}/`, { method })).status, method).toBe(404);
    }
    expect((await get(port, `/p/${token}/`, { method: 'HEAD' })).status).toBe(200);
  });

  it('rejects a foreign Host header in local mode (DNS rebinding) but accepts localhost', async () => {
    const { port, token } = await started();
    expect((await get(port, `/p/${token}/state`, { host: `evil.example:${port}` })).status).toBe(404);
    expect((await get(port, `/p/${token}/state`, { host: 'evil.example' })).status).toBe(404);
    expect((await get(port, `/p/${token}/state`, { host: `localhost:${port}` })).status).toBe(200);
  });

  it('sets no CORS headers', async () => {
    const { port, token } = await started();
    const res = await get(port, `/p/${token}/state`);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('PresenterServer updates', () => {
  it('sends the current state on connect, then each published snapshot', async () => {
    const counts: number[] = [];
    const { server, port, token } = await started({ onViewers: (n: number) => counts.push(n) });
    const s = stream(port, `/p/${token}/events`);
    await s.opened;
    const first = await s.next(/^event: state/m);
    expect(JSON.parse(first.split('data: ')[1])).toMatchObject({ version: 1, viewerCount: 1 });
    server.publish(snap(2, 'And God said'));
    const second = await s.next(/And God said/);
    expect(JSON.parse(second.split('data: ')[1]).version).toBe(2);
    expect(server.viewerCount).toBe(1);
    s.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.viewerCount).toBe(0);
    expect(counts).toEqual(expect.arrayContaining([1, 0]));
  });

  it('tells screens the presentation ended when stopped', async () => {
    const { server, port, token } = await started();
    const s = stream(port, `/p/${token}/events`);
    await s.opened;
    await s.next(/^event: state/m);
    await server.stop();
    await s.next(/^event: closed/m);
  });

  it('caps the number of open screens', async () => {
    const { port, token } = await started({ maxViewers: 1 });
    const a = stream(port, `/p/${token}/events`);
    await a.opened;
    await a.next(/^event: state/m);
    const b = stream(port, `/p/${token}/events`);
    await b.opened;
    expect(b.status()).toBe(503);
    a.close();
  });
});
