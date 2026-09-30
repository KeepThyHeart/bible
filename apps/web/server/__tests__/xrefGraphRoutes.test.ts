/**
 * Cross-reference graph routes (task 0068). The DatabaseManager is stubbed with a tiny in-memory
 * cross-reference module: what is under test is the wire shape and validation, not SQLite.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createXrefGraphRoutes } from '../routes/xrefGraphRoutes';

const JOHN_3_16 = 43003016;
const ROM_5_8 = 45005008;
const ROM_8_32 = 45008032;

/** John 3:16 cites Rom 5:8 and Rom 8:32; nothing else exists. */
const fakeRepo = {
  getModuleInfo: () => ({ version: '1' }),
  getLinkCount: () => 2,
  getGroupsWithEntries: (v: number) => v === JOHN_3_16
    ? [{ group: { groupId: 1, verseId: JOHN_3_16, phrase: 'God so loved' }, entries: [
        { targetVerseId: ROM_5_8, sortOrder: 0 }, { targetVerseId: ROM_8_32, sortOrder: 1 }] }]
    : [],
  getReverseReferences: (v: number) => (v === ROM_5_8 || v === ROM_8_32) ? [{ sourceVerseId: JOHN_3_16 }] : [],
  forEachLink: (visit: (l: unknown) => void) => {
    visit({ sourceVerseIdStart: JOHN_3_16, sourceVerseIdEnd: JOHN_3_16, targetVerseIdStart: ROM_5_8, targetVerseIdEnd: ROM_5_8, rank: 0 });
    visit({ sourceVerseIdStart: JOHN_3_16, sourceVerseIdEnd: JOHN_3_16, targetVerseIdStart: ROM_8_32, targetVerseIdEnd: ROM_8_32, rank: 1 });
  },
};

function makeApp(installed = true) {
  const db = {
    getModuleMetadataRepo: () => ({
      getByType: () => installed ? [{ abbreviation: 'TSK', moduleName: 'Treasury', getAbbreviation: () => 'TSK' }] : [],
    }),
    getCrossRefRepo: () => fakeRepo,
  };
  const app = express();
  app.use('/api/xref-graph', createXrefGraphRoutes(db as never));
  return app;
}

describe('xref graph routes', () => {
  it('lists the installed sources', async () => {
    const res = await request(makeApp()).get('/api/xref-graph/sources');
    expect(res.body).toEqual([{ abbreviation: 'TSK', name: 'Treasury' }]);
  });

  it('returns an ego graph', async () => {
    const res = await request(makeApp()).get(`/api/xref-graph/ego/${JOHN_3_16}?depth=1`);
    expect(res.status).toBe(200);
    expect(res.body.anchor).toBe(JOHN_3_16);
    expect(res.body.nodes.map((n: { verseId: number }) => n.verseId).sort()).toEqual([JOHN_3_16, ROM_5_8, ROM_8_32]);
    expect(res.body.edges).toHaveLength(2);
  });

  it('returns ranked neighbours, honouring limit', async () => {
    const res = await request(makeApp()).get(`/api/xref-graph/neighbours/${JOHN_3_16}?limit=1`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].to).toBe(ROM_5_8);
  });

  it('returns an empty graph when no module is installed', async () => {
    const res = await request(makeApp(false)).get(`/api/xref-graph/ego/${JOHN_3_16}`);
    expect(res.body.nodes).toHaveLength(1);
    const neighbours = await request(makeApp(false)).get(`/api/xref-graph/neighbours/${JOHN_3_16}`);
    expect(neighbours.body).toEqual([]);
  });

  it('validates its parameters', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/xref-graph/ego/abc')).status).toBe(400);
    expect((await request(app).get(`/api/xref-graph/ego/${JOHN_3_16}?depth=9`)).status).toBe(400);
    expect((await request(app).get(`/api/xref-graph/ego/${JOHN_3_16}?minWeight=2`)).status).toBe(400);
    expect((await request(app).get(`/api/xref-graph/ego/${JOHN_3_16}?sources=%3Cscript%3E`)).status).toBe(400);
    expect((await request(app).get(`/api/xref-graph/neighbours/${JOHN_3_16}?limit=0`)).status).toBe(400);
    expect((await request(app).get('/api/xref-graph/neighbours/12')).status).toBe(400);
  });

  it('serves the book matrix and the chapter index with a fingerprint', async () => {
    const app = makeApp();
    const books = await request(app).get('/api/xref-graph/books');
    expect(books.body.books).toHaveLength(66);
    expect(books.body.books[42][44]).toBeGreaterThan(0);
    const chapters = await request(app).get('/api/xref-graph/chapters').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(chapters.headers['x-xref-fingerprint']).toBe(books.body.fingerprint);
    // 1189 chapter totals plus two undirected pairs x 4 words, 4 bytes each
    expect((chapters.body as Buffer).length).toBe((1189 + 2 * 4) * 4);
    const again = await request(app).get('/api/xref-graph/chapters').set('If-None-Match', chapters.headers.etag);
    expect(again.status).toBe(304);
  });
});
