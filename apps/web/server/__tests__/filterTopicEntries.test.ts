import { describe, it, expect } from 'vitest';
import type { TopicEntryLike } from '@bible/core';
import { filterTopicEntries, resolveTopicSources } from '../core.js';

/**
 * Test entries mimicking the TopicEntry shape from SqliteVectorSearch.
 */
interface TestEntry extends TopicEntryLike {
  embeddingId: string;
  tagName: string;
  verseCount: number;
  avgStrength: number;
}

function makeEntry(overrides: Partial<TestEntry> & Pick<TestEntry, 'embeddingId' | 'tagName' | 'tagType'>): TestEntry {
  return {
    verseCount: 10,
    avgStrength: 0.5,
    naveTopicId: null,
    torreyTopicId: null,
    ...overrides,
  };
}

function buildMap(entries: TestEntry[]): Map<string, TestEntry> {
  const map = new Map<string, TestEntry>();
  for (const e of entries) map.set(e.embeddingId, e);
  return map;
}

// Sample entries
const naveEntry = makeEntry({
  embeddingId: 'topic_nave_1',
  tagName: 'Faith',
  tagType: 'nave_torrey',
  naveTopicId: 101,
  torreyTopicId: null,
});

const torreyEntry = makeEntry({
  embeddingId: 'topic_torrey_1',
  tagName: 'Grace',
  tagType: 'nave_torrey',
  naveTopicId: null,
  torreyTopicId: 202,
});

const bothEntry = makeEntry({
  embeddingId: 'topic_both_1',
  tagName: 'Love',
  tagType: 'nave_torrey',
  naveTopicId: 303,
  torreyTopicId: 404,
});

const themeTag = makeEntry({
  embeddingId: 'tag_theme_1',
  tagName: 'redemption',
  tagType: 'theme',
});

const emotionTag = makeEntry({
  embeddingId: 'tag_emotion_1',
  tagName: 'joy',
  tagType: 'emotion',
});

const eventTag = makeEntry({
  embeddingId: 'tag_event_1',
  tagName: 'exodus',
  tagType: 'event',
});

const allEntries = buildMap([naveEntry, torreyEntry, bothEntry, themeTag, emotionTag, eventTag]);

describe('resolveTopicSources', () => {
  it('returns all true when no config provided', () => {
    expect(resolveTopicSources()).toEqual({ naves: true, torreys: true, customTags: true });
  });

  it('returns all true when empty object provided', () => {
    expect(resolveTopicSources({})).toEqual({ naves: true, torreys: true, customTags: true });
  });

  it('respects explicit false values', () => {
    expect(resolveTopicSources({ naves: false })).toEqual({ naves: false, torreys: true, customTags: true });
  });

  it('respects all false values', () => {
    expect(resolveTopicSources({ naves: false, torreys: false, customTags: false }))
      .toEqual({ naves: false, torreys: false, customTags: false });
  });
});

describe('filterTopicEntries', () => {
  it('returns original map when all sources enabled (fast path)', () => {
    const sources = resolveTopicSources();
    const result = filterTopicEntries(allEntries, sources);
    expect(result).toBe(allEntries); // Same reference, not a copy
  });

  it('returns empty map when all sources disabled', () => {
    const sources = resolveTopicSources({ naves: false, torreys: false, customTags: false });
    const result = filterTopicEntries(allEntries, sources);
    expect(result.size).toBe(0);
  });

  it('excludes Nave entries when naves disabled', () => {
    const sources = resolveTopicSources({ naves: false });
    const result = filterTopicEntries(allEntries, sources);
    expect(result.has('topic_nave_1')).toBe(false);
    expect(result.has('topic_torrey_1')).toBe(true);
    // 'both' entry still included because torreys is enabled
    expect(result.has('topic_both_1')).toBe(true);
    expect(result.has('tag_theme_1')).toBe(true);
  });

  it('excludes Torrey entries when torreys disabled', () => {
    const sources = resolveTopicSources({ torreys: false });
    const result = filterTopicEntries(allEntries, sources);
    expect(result.has('topic_nave_1')).toBe(true);
    expect(result.has('topic_torrey_1')).toBe(false);
    // 'both' entry still included because naves is enabled
    expect(result.has('topic_both_1')).toBe(true);
    expect(result.has('tag_theme_1')).toBe(true);
  });

  it('excludes both Nave and Torrey when both disabled', () => {
    const sources = resolveTopicSources({ naves: false, torreys: false });
    const result = filterTopicEntries(allEntries, sources);
    expect(result.has('topic_nave_1')).toBe(false);
    expect(result.has('topic_torrey_1')).toBe(false);
    expect(result.has('topic_both_1')).toBe(false);
    // Custom tags still included
    expect(result.has('tag_theme_1')).toBe(true);
    expect(result.has('tag_emotion_1')).toBe(true);
    expect(result.has('tag_event_1')).toBe(true);
    expect(result.size).toBe(3);
  });

  it('excludes custom tags when customTags disabled', () => {
    const sources = resolveTopicSources({ customTags: false });
    const result = filterTopicEntries(allEntries, sources);
    expect(result.has('tag_theme_1')).toBe(false);
    expect(result.has('tag_emotion_1')).toBe(false);
    expect(result.has('tag_event_1')).toBe(false);
    // Nave/Torrey entries still included
    expect(result.has('topic_nave_1')).toBe(true);
    expect(result.has('topic_torrey_1')).toBe(true);
    expect(result.has('topic_both_1')).toBe(true);
    expect(result.size).toBe(3);
  });

  it('only includes custom tags when nave and torrey disabled', () => {
    const sources = resolveTopicSources({ naves: false, torreys: false });
    const result = filterTopicEntries(allEntries, sources);
    expect(result.size).toBe(3);
    expect([...result.keys()]).toEqual(
      expect.arrayContaining(['tag_theme_1', 'tag_emotion_1', 'tag_event_1'])
    );
  });

  it('handles empty input map', () => {
    const sources = resolveTopicSources();
    const result = filterTopicEntries(new Map(), sources);
    expect(result.size).toBe(0);
  });

  it('handles map with only nave entries and naves disabled', () => {
    const naveOnly = buildMap([naveEntry]);
    const sources = resolveTopicSources({ naves: false });
    const result = filterTopicEntries(naveOnly, sources);
    expect(result.size).toBe(0);
  });
});
