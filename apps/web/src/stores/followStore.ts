import { Store } from './Store';
import { bibleStore } from './bibleStore';
import { openPresentReceiver, type PresentReceiver } from '../present/transport/receiver';
import type { HighlightRange, PresentClosedPayload, PresentState } from '../present/protocol';

/**
 * Following along on a phone (or any device that opened `/present/f/<code>`
 * rather than the projector's `/present/v/<code>`): the normal reading app,
 * with this store nudging it to the presenter's live reference.
 *
 * Deliberately the thinnest possible layer over the reading app rather than a
 * second renderer: `usePresentStream` already exists for a screen with
 * nothing else to do, but a phone here is running the *whole* app, so
 * following just means calling `bibleStore.navigateTo` -- the same method
 * every other kind of navigation already uses -- whenever the presenter's
 * reference changes and this device has not chosen to look elsewhere.
 *
 * "Chosen to look elsewhere" is `paused`, set the moment this device's own
 * chapter stops matching what was last pushed here (see `checkForDrift`).
 * `lastApplied` is what tells the two apart: a navigation this store just
 * issued always matches it (it is set synchronously, before `navigateTo` is
 * even called, and `bibleStore` sets `tab.book`/`tab.chapter` synchronously
 * too -- see the comment on `checkForDrift`), so only the reader's *own* taps
 * and links ever look like drift.
 */

export type FollowConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

interface FollowedRef {
  book: number;
  chapter: number;
  verse: number;
}

class FollowStore extends Store {
  active = false;
  joinCode: string | null = null;
  connection: FollowConnectionStatus = 'connecting';
  closedReason: PresentClosedPayload['reason'] | null = null;

  /** What the presenter is currently showing, straight from the stream. */
  wall: PresentState | null = null;

  /**
   * True once this device has read something other than the live reference --
   * a tap on a cross-reference, a different chapter, anything. Blank does
   * *not* set this: a follower keeps reading through a prayer or a pause,
   * which is the one place this store's notion of "live" deliberately
   * diverges from what the projector shows.
   */
  paused = false;

  private receiver: PresentReceiver | null = null;
  private unsubscribeReceiver: (() => void) | null = null;
  private unsubscribeBible: (() => void) | null = null;
  private lastApplied: FollowedRef | null = null;

  /** Begin following a session by its join code. Safe to call more than once. */
  start(joinCode: string): void {
    if (this.active && this.joinCode === joinCode) return;
    this.stop();

    this.active = true;
    this.joinCode = joinCode;
    this.connection = 'connecting';
    this.closedReason = null;
    this.paused = false;
    this.lastApplied = null;
    this.notify();

    this.receiver = openPresentReceiver(joinCode);
    this.unsubscribeReceiver = this.receiver.subscribe(event => {
      if (event.type === 'state') {
        this.wall = event.state;
        this.connection = 'live';
        if (!this.paused) this.applyLive(event.state);
      } else if (event.type === 'reconnecting') {
        this.connection = 'reconnecting';
      } else {
        this.connection = 'closed';
        this.closedReason = event.reason;
      }
      this.notify();
    });

    // Watching for the reader wandering off on their own -- see the class
    // doc comment on why comparing against `lastApplied` cannot mistake this
    // store's own navigation for the reader's.
    this.unsubscribeBible = bibleStore.subscribe(() => this.checkForDrift());
  }

  /** Stop following. Leaves whatever chapter is currently open exactly as it is. */
  stop(): void {
    this.unsubscribeReceiver?.();
    this.unsubscribeReceiver = null;
    this.receiver?.close();
    this.receiver = null;
    this.unsubscribeBible?.();
    this.unsubscribeBible = null;

    this.active = false;
    this.joinCode = null;
    this.wall = null;
    this.paused = false;
    this.lastApplied = null;
    this.notify();
  }

  /**
   * "Stop following" from the banner: unlike `stop()`, this keeps the stream
   * open (the banner still needs to know what is live, to offer "Back to
   * live" and to keep showing the presenter's highlight if the reader is
   * still on that verse) but stops pulling the reader's own navigation along
   * with it. Functionally identical to drifting off on your own; named
   * separately because it is a deliberate choice, not a side effect.
   */
  stopFollowing(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    this.notify();
  }

  /** "Back to live": jump to the presenter's current reference and resume following it. */
  resume(): void {
    if (!this.active) return;
    this.paused = false;
    if (this.wall) this.applyLive(this.wall);
    this.notify();
  }

  private applyLive(state: PresentState): void {
    const live = state.live;
    if (!live || live.kind !== 'passage') return;
    const verse = state.position.index || 1;
    const ref: FollowedRef = { book: live.book, chapter: live.chapter, verse };

    // Nothing to do if the reader is already sitting on exactly this verse --
    // most position changes within a passage the presenter is already showing
    // (`next`/`previous`/a highlight move) do not change chapter or anchor,
    // and skipping a redundant `navigateTo` avoids a chapter re-fetch on
    // every one of them.
    //
    // Checked against the *actual* tab, not just `lastApplied`: after a
    // pause-then-resume, `lastApplied` still names the reference this store
    // set before the reader wandered off, even though `bibleStore` itself has
    // since moved. Trusting the cache there would make `resume()` a no-op --
    // exactly the bug this comparison exists to rule out.
    const tab = bibleStore.getActiveTab();
    const targetVerseId = ref.book * 1_000_000 + ref.chapter * 1_000 + ref.verse;
    const alreadyThere = tab?.book === ref.book && tab.chapter === ref.chapter
      && (tab.studyVerse == null || tab.studyVerse === targetVerseId);
    if (alreadyThere) {
      this.lastApplied = ref;
      return;
    }

    // Set before calling `navigateTo`, not after: `navigateTo` sets
    // `tab.book`/`tab.chapter` synchronously, before its first `await`, so any
    // `bibleStore` subscriber -- including `checkForDrift`, subscribed to the
    // very same store -- could otherwise observe the new chapter with the old
    // `lastApplied` still in place and misread this store's own move as drift.
    this.lastApplied = ref;
    void bibleStore.navigateTo(ref.book, ref.chapter, ref.verse, { replace: true });
  }

  /**
   * Has the reader navigated somewhere this store did not just put them?
   *
   * Compared by book/chapter only, not verse: scrolling to look at a
   * neighbouring verse within the same chapter the presenter is showing is
   * not "wandering off" the way leaving the chapter is, so only a book or
   * chapter change pauses following.
   */
  private checkForDrift(): void {
    if (!this.active || this.paused) return;
    const tab = bibleStore.getActiveTab();
    if (!tab?.book || !tab.chapter || !this.lastApplied) return;
    if (tab.book !== this.lastApplied.book || tab.chapter !== this.lastApplied.chapter) {
      this.paused = true;
      this.notify();
    }
  }

  /**
   * The presenter's current reference, and their highlight if they have set
   * one -- everything `BibleContent` needs to mark the followed verse and
   * (per the spec's answer on this: yes) show the same word highlight the
   * screen shows, reusing the exact highlight data the viewer renders rather
   * than a second copy of it.
   *
   * Present whenever the wall is showing a passage, regardless of `paused`:
   * the highlight belongs to whatever verse this *was* following, and a
   * paused reader sitting on that verse should still see it lit -- it is
   * `applyLive` (gated on `!paused`) that stops pulling the reader along, not
   * this getter.
   */
  get liveVerse(): { book: number; chapter: number; verse: number; highlight: HighlightRange | null } | null {
    if (!this.wall?.live || this.wall.live.kind !== 'passage') return null;
    return {
      book: this.wall.live.book,
      chapter: this.wall.live.chapter,
      verse: this.wall.position.index || 1,
      highlight: this.wall.position.highlight,
    };
  }
}

export const followStore = new FollowStore();
