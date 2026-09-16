import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followStore } from './followStore';
import { bibleStore } from './bibleStore';
import type { VerseData } from '../types';
import type { PresentState } from '../present/protocol';

/** A stand-in for EventSource that never delivers anything on its own. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, handler);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

function makeVerse(verse: number, book: number, chapter: number): VerseData {
  return {
    verse_id: book * 1000000 + chapter * 1000 + verse,
    book_number: book,
    chapter,
    verse,
    text: `verse ${verse}`,
    text_html: `verse ${verse}`,
    is_paragraph_start: false,
    words_of_christ: false,
  };
}

/** Minimal provider: only the calls navigateTo makes, for any book/chapter asked. */
function stubProvider() {
  return {
    getChapter: vi.fn(async (_module: string, book: number, chapter: number) => ({
      verses: [makeVerse(1, book, chapter), makeVerse(2, book, chapter), makeVerse(3, book, chapter)],
      hasInterlinearData: false,
      coveredBooks: undefined,
    })),
    getVerseOfTheDay: vi.fn(async () => null),
  } as never;
}

function stateWith(over: Partial<PresentState> & { version: number }): PresentState {
  return {
    live: null,
    position: { index: 0, highlight: null },
    display: { fontStep: 5, blanked: false, theme: 'dark' },
    session: { id: 'SESSION000000000', joinCode: 'ABCD2345', joinsLocked: false, viewerCount: 1 },
    ...over,
  };
}

const passageAt = (book: number, chapter: number, verse: number, version: number): PresentState => stateWith({
  version,
  live: { kind: 'passage', module: 'KJV', book, chapter },
  position: { index: verse, highlight: null },
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  localStorage.clear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(stubProvider());
  followStore.stop();
});

describe('followStore', () => {
  it('follows the presenter to a passage as soon as it arrives', async () => {
    followStore.start('ABCD2345');
    FakeEventSource.instances[0].emit('state', passageAt(43, 3, 16, 1));
    await flush();

    const tab = bibleStore.getActiveTab();
    expect(tab?.book).toBe(43);
    expect(tab?.chapter).toBe(3);
    expect(followStore.paused).toBe(false);
  });

  it('does not pause on a highlight or verse move within the same chapter', async () => {
    followStore.start('ABCD2345');
    const source = FakeEventSource.instances[0];
    source.emit('state', passageAt(43, 3, 16, 1));
    await flush();

    source.emit('state', passageAt(43, 3, 17, 2));
    await flush();

    expect(bibleStore.getActiveTab()?.chapter).toBe(3);
    expect(followStore.paused).toBe(false);
  });

  it('follows blank the same as live: the wall being blanked does not stop it', async () => {
    followStore.start('ABCD2345');
    const source = FakeEventSource.instances[0];
    const blanked = { ...passageAt(43, 3, 16, 1), display: { fontStep: 5, blanked: true, theme: 'dark' as const } };
    source.emit('state', blanked);
    await flush();

    expect(bibleStore.getActiveTab()?.book).toBe(43);
  });

  it('pauses when the reader navigates to a different chapter on their own', async () => {
    followStore.start('ABCD2345');
    FakeEventSource.instances[0].emit('state', passageAt(43, 3, 16, 1));
    await flush();

    await bibleStore.navigateTo(1, 1); // The reader taps to Genesis 1.
    await flush();

    expect(followStore.paused).toBe(true);
  });

  it('does not apply new state while paused', async () => {
    followStore.start('ABCD2345');
    const source = FakeEventSource.instances[0];
    source.emit('state', passageAt(43, 3, 16, 1));
    await flush();

    followStore.stopFollowing();
    expect(followStore.paused).toBe(true);

    source.emit('state', passageAt(45, 5, 1, 2)); // The presenter moves on.
    await flush();

    expect(bibleStore.getActiveTab()?.book).toBe(43); // The reader stays put.
  });

  it('resume() jumps to wherever the presenter currently is and resumes following', async () => {
    followStore.start('ABCD2345');
    const source = FakeEventSource.instances[0];
    source.emit('state', passageAt(43, 3, 16, 1));
    await flush();
    followStore.stopFollowing();

    source.emit('state', passageAt(45, 5, 1, 2));
    await flush();

    followStore.resume();
    await flush();

    expect(followStore.paused).toBe(false);
    expect(bibleStore.getActiveTab()?.book).toBe(45);
    expect(bibleStore.getActiveTab()?.chapter).toBe(5);
  });

  it('resume() re-navigates even when the presenter never moved while paused', async () => {
    // The bug this guards: if the presenter's reference is unchanged, the
    // cached "already applied this reference" check must not skip the
    // `navigateTo` resume() needs just because it matches a *stale* record of
    // what this store set before the reader wandered off on their own.
    followStore.start('ABCD2345');
    const source = FakeEventSource.instances[0];
    source.emit('state', passageAt(43, 3, 16, 1));
    await flush();

    await bibleStore.navigateTo(1, 1); // The reader taps away to Genesis 1.
    await flush();
    expect(followStore.paused).toBe(true);

    followStore.resume();
    await flush();

    expect(followStore.paused).toBe(false);
    expect(bibleStore.getActiveTab()?.book).toBe(43);
    expect(bibleStore.getActiveTab()?.chapter).toBe(3);
  });

  it('reports the presenter\'s current reference and highlight together', async () => {
    followStore.start('ABCD2345');
    const source = FakeEventSource.instances[0];
    const withHighlight: PresentState = {
      ...passageAt(43, 3, 16, 1),
      position: { index: 16, highlight: { verseIdStart: 43003016, textStart: 0, textEnd: 3 } },
    };
    source.emit('state', withHighlight);
    await flush();

    expect(followStore.liveVerse).toEqual({
      book: 43, chapter: 3, verse: 16,
      highlight: { verseIdStart: 43003016, textStart: 0, textEnd: 3 },
    });
  });

  it('reports the reference with a null highlight when the presenter has none set', async () => {
    followStore.start('ABCD2345');
    FakeEventSource.instances[0].emit('state', passageAt(43, 3, 16, 1));
    await flush();
    expect(followStore.liveVerse).toEqual({ book: 43, chapter: 3, verse: 16, highlight: null });
  });

  it('is null when nothing is on the wall', () => {
    followStore.start('ABCD2345');
    expect(followStore.liveVerse).toBeNull();
  });

  it('stop() closes the stream and stops watching for drift', async () => {
    followStore.start('ABCD2345');
    const source = FakeEventSource.instances[0];
    followStore.stop();
    expect(source.closed).toBe(true);
    expect(followStore.active).toBe(false);

    // No longer following: this must not throw or resurrect a subscription.
    await bibleStore.navigateTo(1, 1);
    expect(followStore.paused).toBe(false);
  });

  it('tracks connection status through reconnecting and closed', async () => {
    followStore.start('ABCD2345');
    const source = FakeEventSource.instances[0];

    source.onerror?.();
    expect(followStore.connection).toBe('reconnecting');

    source.emit('closed', { reason: 'ended' });
    expect(followStore.connection).toBe('closed');
    expect(followStore.closedReason).toBe('ended');
  });
});
