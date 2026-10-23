// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { PresentController, type PresentScripture } from './controller';
import type { PresentStatus, PresentSnapshot } from './types';

/** A two-book Bible: book 1 has chapters 1 (3 verses) and 2 (2 verses); book 2 has chapter 1 (2 verses). */
const BOOKS: Record<number, { name: string; chapterCount: number }> = { 1: { name: 'Genesis', chapterCount: 2 }, 2: { name: 'Exodus', chapterCount: 1 } };
const SIZES: Record<string, number> = { '1:1': 3, '1:2': 2, '2:1': 2 };
const scripture: PresentScripture = {
  async getChapter(_m, book, chapter) {
    const n = SIZES[`${book}:${chapter}`] ?? 0;
    return Array.from({ length: n }, (_, i) => ({ verse: i + 1, text: `${BOOKS[book]?.name} ${chapter}:${i + 1}` }));
  },
  getBook: (book) => BOOKS[book] ?? null,
};

const made: PresentController[] = [];
function make() {
  const changes: PresentStatus[] = [];
  const c = new PresentController({ scripture, lanAddresses: () => ['192.168.1.20'], qr: (u) => `<svg data-url="${u}"/>` }, (s) => changes.push(s));
  made.push(c);
  return { c, changes };
}
afterEach(async () => {
  await Promise.all(made.splice(0).map((c) => c.stop()));
});

function fetchJson(url: string): Promise<PresentSnapshot> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    request({ host: u.hostname, port: u.port, path: u.pathname + 'state', agent: false }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(JSON.parse(body)));
    })
      .on('error', reject)
      .end();
  });
}

describe('PresentController', () => {
  it('starts on loopback with a tokened url, and stops cleanly', async () => {
    const { c } = make();
    expect(c.status().running).toBe(false);
    const st = await c.start();
    expect(st.running).toBe(true);
    expect(st.server?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/p\/[\w-]{32,}\/$/);
    expect(st.server?.lan).toBe(false);
    expect(st.server?.lanUrls).toEqual([]);
    const stopped = await c.stop();
    expect(stopped.running).toBe(false);
    expect(stopped.server).toBeNull();
    expect(c.pagePath()).toBeNull();
  });

  it('LAN mode lists network urls and puts the first in the QR code; switching changes the token', async () => {
    const { c } = make();
    const local = await c.start();
    const lan = await c.start({ lan: true });
    expect(lan.server?.lan).toBe(true);
    expect(lan.server?.lanUrls[0]).toMatch(/^http:\/\/192\.168\.1\.20:\d+\/p\//);
    expect(lan.server?.qrSvg).toContain(lan.server!.lanUrls[0]);
    expect(lan.server?.url).not.toBe(local.server?.url);
    // asking for the same mode again keeps the server
    expect((await c.start({ lan: true })).server?.url).toBe(lan.server?.url);
  });

  it('the page follows the controller: passage, stepping, display', async () => {
    const { c } = make();
    const { server } = await c.start();
    expect((await fetchJson(server!.url)).live).toBeNull();

    await c.setPassage({ module: 'KJV', book: 1, chapter: 1 });
    let snap = await fetchJson(server!.url);
    expect(snap.live).toMatchObject({ reference: 'Genesis 1', focus: 1 });
    expect(snap.live?.verses).toHaveLength(3);

    await c.step(1);
    snap = await fetchJson(server!.url);
    expect(snap.live?.focus).toBe(2);

    c.setDisplay({ fontStep: 2, blanked: true, theme: 'light' });
    snap = await fetchJson(server!.url);
    expect(snap.display).toEqual({ fontStep: 2, blanked: true, theme: 'light' });
  });

  it('steps across chapters and books, and stops at the ends of the Bible', async () => {
    const { c } = make();
    await c.setPassage({ module: 'KJV', book: 1, chapter: 2, verseStart: undefined });
    await c.step(2); // verse 1 -> 2 -> next chapter is book 2 ch 1
    expect(c.status().snapshot.live).toMatchObject({ reference: 'Exodus 1', focus: 1 });
    await c.step(-1); // back to Genesis 2 last verse
    expect(c.status().snapshot.live).toMatchObject({ reference: 'Genesis 2', focus: 2 });
    await c.step(100); // runs off the end
    expect(c.status().snapshot.live).toMatchObject({ reference: 'Exodus 1', focus: 2 });
  });

  it('a verse range pins the passage: stepping clamps inside it', async () => {
    const { c } = make();
    await c.setPassage({ module: 'KJV', book: 1, chapter: 1, verseStart: 2, verseEnd: 3 });
    const live = c.status().snapshot.live!;
    expect(live.reference).toBe('Genesis 1:2–3');
    expect(live.focus).toBe(2);
    await c.step(-5);
    expect(c.status().snapshot.live?.focus).toBe(2);
    await c.step(5);
    expect(c.status().snapshot.live?.focus).toBe(3);
    expect(c.status().snapshot.live?.reference).toBe('Genesis 1:2–3');
    c.focusVerse(1); // outside the range: ignored
    expect(c.status().snapshot.live?.focus).toBe(3);
    c.focusVerse(2);
    expect(c.status().snapshot.live?.focus).toBe(2);
  });

  it('rejects bad input and leaves the wall alone', async () => {
    const { c } = make();
    await c.setPassage({ module: 'KJV', book: 1, chapter: 1 });
    await expect(c.setPassage({ module: '../x', book: 1, chapter: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(c.setPassage({ module: 'KJV', book: 0, chapter: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(c.setPassage({ module: 'KJV', book: 1, chapter: 99 })).rejects.toMatchObject({ code: 'not_found' });
    await expect(c.setPassage({ module: 'KJV', book: 66, chapter: 1 })).rejects.toMatchObject({ code: 'not_found' });
    c.setDisplay({ fontStep: 999, theme: 'neon' as never });
    expect(c.status().snapshot.display).toEqual({ fontStep: 0, blanked: false, theme: 'dark' });
    expect(c.status().snapshot.live?.reference).toBe('Genesis 1');
  });

  it('versions only go up, even across a restart', async () => {
    const { c } = make();
    await c.start();
    await c.setPassage({ module: 'KJV', book: 1, chapter: 1 });
    const v1 = c.status().snapshot.version;
    await c.stop();
    await c.start();
    expect(c.status().snapshot.version).toBeGreaterThanOrEqual(v1);
  });

  it('concurrent start/stop never leaves a listener behind', async () => {
    const { c } = make();
    const a = c.start();
    const b = c.start({ lan: true });
    const url = (await Promise.all([a, b]))[1].server!.url;
    expect(c.status().server?.url).toBe(url);
    const stopping = c.stop();
    const starting = c.start();
    await Promise.all([stopping, starting]);
    await c.stop();
    expect(c.status().running).toBe(false);
    await expect(fetchJson(url)).rejects.toThrow();
  });

  it('rejects a range with no verses and clamps huge steps', async () => {
    const { c } = make();
    await expect(c.setPassage({ module: 'KJV', book: 1, chapter: 1, verseStart: 40, verseEnd: 50 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(c.setPassage({ module: 'KJV', book: 1, chapter: 1, verseStart: 3, verseEnd: 2 })).rejects.toMatchObject({ code: 'invalid_input' });
    await c.setPassage({ module: 'KJV', book: 1, chapter: 1 });
    await c.step(1e9);
    expect(c.status().snapshot.live?.reference).toBe('Exodus 1');
  });
});
