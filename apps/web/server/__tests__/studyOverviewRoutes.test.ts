/**
 * Unit tests for the study overview route's ancestor backfill.
 *
 * The cache format gained `a` (ancestor ids) after `p` (the pre-joined display
 * string). A cache written before that carries names only, and the topic
 * breadcrumb in the Study pane renders an id-less ancestor as plain text —
 * correctly, since opening topic 0 fails. The reader saw a breadcrumb whose
 * only clickable crumb was the last one.
 *
 * Both the DatabaseManager and the cache DB are stubbed: what is under test is
 * the shape of the payload the route hands the client, not SQLite.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createStudyOverviewRoutes } from '../routes/studyOverviewRoutes';
import type { DatabaseManager } from '../DatabaseManager';

interface CacheRow {
  commentary_overview: string;
  topics: string;
  crossrefs: string;
  entities: string;
}

/** Nave's: "Condescension Of God" (5189) > "SCRIPTURES RELATING TO" (5201). */
const PARENT = { topicId: 5189, name: 'Condescension Of God' };

function makeApp(topics: unknown, options: { withModule?: boolean } = {}) {
  const { withModule = true } = options;

  const row: CacheRow = {
    commentary_overview: '[]',
    topics: JSON.stringify(topics),
    crossrefs: '{}',
    entities: '{}',
  };

  const getParentChain = vi.fn(() => [PARENT]);
  const getRecursiveVerseCount = vi.fn(() => 268);

  const db = {
    getStudyCacheDb: () => ({ queryOne: () => row }),
    getTopicalIndexRepo: (abbr: string) =>
      withModule && abbr === 'NaveTopics' ? { getParentChain, getRecursiveVerseCount } : null,
  } as unknown as DatabaseManager;

  const app = express();
  app.use('/api/study/overview', createStudyOverviewRoutes(db));
  return { app, getParentChain, getRecursiveVerseCount };
}

const LEGACY_TOPIC = {
  id: 5201,
  n: 'SCRIPTURES RELATING TO',
  p: 'Condescension Of God',
  vc: 14,
  src: 'NaveTopics',
  sn: "Nave's Topical Bible",
};

describe('study overview — ancestor backfill', () => {
  it('gives a legacy cache entry its ancestor ids back', async () => {
    const { app } = makeApp({ '43003016': [LEGACY_TOPIC] });

    const res = await request(app).get('/api/study/overview/43/3');

    expect(res.status).toBe(200);
    expect(res.body.topics['43003016'][0].a).toEqual([[5189, 'Condescension Of God', 268]]);
  });

  it('leaves a modern cache entry untouched and never queries the module', async () => {
    const modern = { ...LEGACY_TOPIC, a: [[5189, 'Condescension Of God', 268]] };
    const { app, getParentChain } = makeApp({ '43003016': [modern] });

    const res = await request(app).get('/api/study/overview/43/3');

    expect(res.body.topics['43003016'][0].a).toEqual([[5189, 'Condescension Of God', 268]]);
    expect(getParentChain).not.toHaveBeenCalled();
  });

  it('resolves each topic once, however many verses list it', async () => {
    const { app, getParentChain } = makeApp({
      '43003016': [LEGACY_TOPIC],
      '43003017': [LEGACY_TOPIC],
      '43003018': [{ ...LEGACY_TOPIC }],
    });

    await request(app).get('/api/study/overview/43/3');

    expect(getParentChain).toHaveBeenCalledTimes(1);
  });

  it('leaves a root topic alone — it has no ancestors to resolve', async () => {
    const root = { id: 5189, n: 'Condescension Of God', vc: 268, src: 'NaveTopics', sn: "Nave's" };
    const { app, getParentChain } = makeApp({ '43003016': [root] });

    const res = await request(app).get('/api/study/overview/43/3');

    expect(res.body.topics['43003016'][0].a).toBeUndefined();
    expect(getParentChain).not.toHaveBeenCalled();
  });

  it('leaves the ancestors id-less when the module is not installed', async () => {
    // Plain text is the right answer here: the topic could not be opened.
    const { app } = makeApp({ '43003016': [LEGACY_TOPIC] }, { withModule: false });

    const res = await request(app).get('/api/study/overview/43/3');

    expect(res.body.topics['43003016'][0].a).toBeUndefined();
    expect(res.body.topics['43003016'][0].p).toBe('Condescension Of God');
  });
});
