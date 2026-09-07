import { test, expect } from '@playwright/test';

test.describe('API E2E Tests', () => {
  test('loads books list', async ({ request }) => {
    const res = await request.get('/api/books');
    expect(res.ok()).toBe(true);
    const books = await res.json();
    expect(books).toHaveLength(66);
    expect(books[0].book_name).toBe('Genesis');
  });

  test('loads Bible chapter', async ({ request }) => {
    const res = await request.get('/api/bible/KJV/1/1');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.verses.length).toBeGreaterThan(0);
    expect(data.verses[0].book_number).toBe(1);
    expect(data.verses[0].chapter).toBe(1);
    expect(data.hasInterlinearData).toBeDefined();
  });

  test('loads single verse', async ({ request }) => {
    const res = await request.get('/api/bible/KJV/verse/43003016');
    expect(res.ok()).toBe(true);
    const verse = await res.json();
    expect(verse.verse_id).toBe(43003016);
    expect(verse.book_number).toBe(43);
    expect(verse.chapter).toBe(3);
    expect(verse.verse).toBe(16);
  });

  test('loads modules', async ({ request }) => {
    const res = await request.get('/api/modules');
    expect(res.ok()).toBe(true);
    const modules = await res.json();
    expect(modules.length).toBeGreaterThan(0);
    const bibleModules = modules.filter((m: any) => m.type === 'bible');
    expect(bibleModules.length).toBeGreaterThan(0);
  });

  test('loads commentary', async ({ request }) => {
    const res = await request.get('/api/commentary/Barnes/43/3');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.entries.length).toBeGreaterThan(0);
    expect(data.entries[0]).toHaveProperty('content');
  });

  test('keyword search works', async ({ request }) => {
    const res = await request.get('/api/search/keyword?q=love');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('total');
  });

  test('Strong\'s lookup works', async ({ request }) => {
    const res = await request.get('/api/strongs/G2316');
    expect(res.ok()).toBe(true);
    const entry = await res.json();
    expect(entry.strongsNumber).toBe('G2316');
    expect(entry).toHaveProperty('definition');
  });

  test('interlinear data loads', async ({ request }) => {
    const res = await request.get('/api/interlinear/1/1');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('words');
    expect(data).toHaveProperty('strongsEntries');
  });

  test('chapter navigation across books', async ({ request }) => {
    // Last chapter of Genesis
    const res1 = await request.get('/api/bible/KJV/1/50');
    expect(res1.ok()).toBe(true);
    const gen50 = await res1.json();
    expect(gen50.verses.length).toBeGreaterThan(0);

    // First chapter of Exodus
    const res2 = await request.get('/api/bible/KJV/2/1');
    expect(res2.ok()).toBe(true);
    const exod1 = await res2.json();
    expect(exod1.verses.length).toBeGreaterThan(0);
    expect(exod1.verses[0].book_number).toBe(2);
  });

  test('multiple translations', async ({ request }) => {
    const kjv = await request.get('/api/bible/KJV/43/3');
    const asv = await request.get('/api/bible/ASV/43/3');
    expect(kjv.ok()).toBe(true);
    expect(asv.ok()).toBe(true);

    const kjvData = await kjv.json();
    const asvData = await asv.json();

    // Both should have verses but with different text
    expect(kjvData.verses.length).toBeGreaterThan(0);
    expect(asvData.verses.length).toBeGreaterThan(0);
  });

  test('returns 404 for unknown module', async ({ request }) => {
    const res = await request.get('/api/bible/NONEXISTENT/1/1');
    expect(res.status()).toBe(404);
  });
});
