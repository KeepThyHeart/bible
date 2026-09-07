import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StudyOverviewProvider } from '../providers/StudyOverviewProvider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function overviewResponse(topics: Record<string, unknown[]>) {
  const data = { commentary: [], topics, crossrefs: {}, entities: {}, cached: true };
  return { ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}

describe('StudyOverviewProvider topic ancestors', () => {
  // The breadcrumb the Study pane draws over a verse's topics comes from this
  // cache. Its ancestors are only openable if they carry real topic ids — a
  // name is not unique (hundreds of Nave's topics are called "History of").
  it('maps the `a` tuples to ancestors with real ids and counts', async () => {
    mockFetch.mockResolvedValue(overviewResponse({
      '43007003': [{
        id: 8357,
        n: 'Journeys to Jerusalem',
        p: 'Jesus, The Christ > HISTORY OF',
        a: [[8356, 'Jesus, The Christ', 4231], [8399, 'HISTORY OF', 361]],
        vc: 22,
        src: 'nave',
        sn: "Nave's Topical Bible",
      }],
    }));

    const provider = new StudyOverviewProvider('http://localhost:3100');
    await provider.loadChapter(43, 7);
    const topics = provider.getTopicsForVerse(43, 7, 43007003);

    expect(topics).toHaveLength(1);
    expect(topics[0].ancestors).toEqual([
      { topic_id: 8356, name: 'Jesus, The Christ', verse_count: 4231 },
      { topic_id: 8399, name: 'HISTORY OF', verse_count: 361 },
    ]);
    // The direct parent is the last ancestor, not null.
    expect(topics[0].parent_topic_id).toBe(8399);
    expect(topics[0].parent_name).toBe('Jesus, The Christ > HISTORY OF');
  });

  it('falls back to id-less ancestors for a cache generated without `a`', async () => {
    mockFetch.mockResolvedValue(overviewResponse({
      '43007003': [{
        id: 8357,
        n: 'Journeys to Jerusalem',
        p: 'Jesus, The Christ > HISTORY OF',
        vc: 22,
        src: 'nave',
        sn: "Nave's Topical Bible",
      }],
    }));

    const provider = new StudyOverviewProvider('http://localhost:3100');
    await provider.loadChapter(43, 7);
    const topics = provider.getTopicsForVerse(43, 7, 43007003);

    // Names still render; ids are 0, which the UI uses to keep them unclickable.
    expect(topics[0].ancestors.map(a => a.name)).toEqual(['Jesus, The Christ', 'HISTORY OF']);
    expect(topics[0].ancestors.every(a => a.topic_id === 0)).toBe(true);
    expect(topics[0].parent_topic_id).toBeNull();
  });

  it('reports no ancestors for a root topic', async () => {
    mockFetch.mockResolvedValue(overviewResponse({
      '43007003': [{ id: 8356, n: 'Jesus, The Christ', vc: 4231, src: 'nave', sn: "Nave's" }],
    }));

    const provider = new StudyOverviewProvider('http://localhost:3100');
    await provider.loadChapter(43, 7);
    const topics = provider.getTopicsForVerse(43, 7, 43007003);

    expect(topics[0].ancestors).toEqual([]);
    expect(topics[0].parent_topic_id).toBeNull();
    expect(topics[0].parent_name).toBeUndefined();
  });
});
