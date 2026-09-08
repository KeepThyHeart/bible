import { unwrap } from './ipcResult';
import type { TopicDetail, TopicVerseResult, AlsoInResult } from '../components/TopicsPane/types';

/**
 * A short-lived cache in front of the three IPC calls that make up a topic
 * page.
 *
 * Two things need it. The Topics pane refetches from scratch every time it is
 * mounted, and dockview mounts a pane fresh each time its tab is activated -
 * so walking back and forth between tabs re-ran the same queries. And the
 * Study pane wants to *prefetch* a topic before it hands over to the Topics
 * pane (see `paneHandoff.ts`); without a shared cache the prefetch would be
 * thrown away and the pane would simply fetch again.
 *
 * Topic content comes out of read-only module databases, so it does not go
 * stale within a session. The TTL exists only to stop a long-running window
 * from holding every topic the reader ever opened.
 */
const TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  /** The in-flight or settled request. Sharing it dedupes concurrent callers. */
  value: Promise<T>;
  /** When the entry was created, for TTL expiry. */
  storedAt: number;
}

const entries = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = entries.get(key);
  if (existing && Date.now() - existing.storedAt < TTL_MS) {
    return existing.value as Promise<T>;
  }

  // A rejected request must not be cached, or one transient IPC failure would
  // keep the topic broken for the rest of the TTL.
  const value = load().catch((error: unknown) => {
    if (entries.get(key)?.value === value) entries.delete(key);
    throw error;
  });
  entries.set(key, { value, storedAt: Date.now() });
  return value;
}

/** True when a topic's detail is already resolved and can be rendered without a fetch. */
export function hasTopicDetail(abbreviation: string, topicId: number): boolean {
  const entry = entries.get(`detail:${abbreviation}:${topicId}`);
  return entry !== undefined && Date.now() - entry.storedAt < TTL_MS;
}

export function loadTopicDetail(abbreviation: string, topicId: number): Promise<TopicDetail | null> {
  return cached(`detail:${abbreviation}:${topicId}`, () =>
    unwrap(window.electron.topical.getTopic(abbreviation, topicId)),
  );
}

export function loadTopicVerses(
  abbreviation: string,
  topicId: number,
  limit: number,
  offset: number,
): Promise<TopicVerseResult[]> {
  // Only the first page is cached; later pages are appended by the pane as the
  // reader asks for them and are not worth holding.
  if (offset !== 0) {
    return unwrap(window.electron.topical.getVersesForTopic(abbreviation, topicId, limit, offset));
  }
  return cached(`verses:${abbreviation}:${topicId}:${limit}`, () =>
    unwrap(window.electron.topical.getVersesForTopic(abbreviation, topicId, limit, 0)),
  );
}

export function loadAlsoIn(topicName: string, abbreviation: string): Promise<AlsoInResult[]> {
  return cached(`alsoIn:${abbreviation}:${topicName}`, () =>
    unwrap(window.electron.topical.getAlsoIn(topicName, abbreviation)),
  );
}

/**
 * Warms everything the topic view renders, so that a pane mounted immediately
 * afterwards has its content in hand. Resolves when the detail has arrived -
 * the two follow-up calls are left to settle on their own, because holding a
 * tab switch on them would cost more than it saves.
 */
export async function prefetchTopic(
  abbreviation: string,
  topicId: number,
  versePageSize: number,
): Promise<void> {
  const detail = await loadTopicDetail(abbreviation, topicId);
  if (!detail) return;
  void loadTopicVerses(abbreviation, topicId, versePageSize, 0).catch(() => {});
  void loadAlsoIn(detail.topic.name, abbreviation).catch(() => {});
}

/** Test seam. */
export function clearTopicalContentCache(): void {
  entries.clear();
}
