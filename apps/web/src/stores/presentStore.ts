import { Store } from './Store';
import { API_BASE } from '../utils/apiUrl';
import type { HymnSummary } from '../present/hymns';
import type {
  CreateSessionResponse,
  PresentIntent,
  PresentItem,
  PresentPlanEntry,
  PresentState,
  StoredPresentState,
} from '../present/protocol';
import { applyIntent, type IntentContext } from '../present/reducer';
import { beginDraft, draftIsOnWall, draftToRange, tapDraft, type HighlightDraft } from '../present/wordHighlight';
import { openLocalChannel, type LocalChannel } from '../present/transport/localChannel';

/** The cache key `warmContext` and `hasWarmContext` share for a hymn's slide count. */
function hymnSlideKey(hymnId: string, verseOrder?: string[]): string {
  return `${hymnId}?${(verseOrder ?? []).join(' ')}`;
}

/**
 * Session mode: the reading app, driving a screen.
 *
 * The controller is not a separate application. It is this one, with a control
 * strip along the bottom -- and that is the whole design, not a shortcut. A
 * preacher wants tabs, search, cross-references and commentary while choosing
 * what to put on the wall; a purpose-built controller would have to grow all of
 * that back, badly. Making control a *permission* rather than a codebase means:
 *
 *  - **Preview-then-send is free.** What the presenter is reading and what the
 *    room can see are already two different things, because the app is the
 *    preview. There is no second navigation surface to build and nothing to
 *    keep in sync. Look ahead, chase a cross-reference, find the next passage;
 *    the wall does not move until told.
 *  - The presenter uses software they already know, at the moment when being
 *    surprised by their tools is most expensive.
 *
 * The one thing that genuinely has to be new is this store: the session, the
 * intents, the running order, and a stream of what is actually on the wall.
 *
 * On tokens: the control token is held in memory and in `localStorage`, and is
 * sent only as a request header. It never enters a URL path or query string, so
 * it stays out of access logs and `Referer`. The one place it legitimately
 * appears in a URL is the fragment of a handoff link (see `controlLink.ts`),
 * which browsers do not transmit.
 *
 * On the same-machine transport: this device also predicts what most intents
 * will do, with the exact reducer the server runs, and publishes that
 * prediction to a `BroadcastChannel` a screen in another tab of this browser
 * is listening on -- see `predictLocal`. Nothing here waits for that path or
 * treats it as authoritative; the POST below is still what actually drives
 * the session, and its answer still replaces whatever was predicted.
 */

/** What a device needs to hold in order to drive a session. */
export interface ControllerSession {
  sessionId: string;
  joinCode: string;
  controlToken: string;
  expiresAt: string;
}

export type PresentConnectionStatus = 'offline' | 'connecting' | 'live' | 'reconnecting';

const SESSION_KEY = 'present-controller-session';

/**
 * Whether the controller's own keyboard also answers to a presentation
 * remote/clicker: plain Page Up/Down and arrow keys for next/previous, and
 * `b` for blank -- the keys the old, single-machine program read directly
 * from a projector pointer.
 *
 * On by default: a bare Up/Down (or a clicker's key) means the same thing
 * everywhere -- advance the slide of a hymn or quote, advance the verse of a
 * passage -- so there is no collision to opt in to. It stays a preference
 * rather than a constant for the presenter who wants those bare keys back for
 * the reader underneath; only an explicit opt-out (stored as `'0'`) turns it
 * off.
 */
const CLICKER_KEY = 'present-accept-clicker-keys';

function readStoredClickerPreference(): boolean {
  try {
    return localStorage.getItem(CLICKER_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * How far apart two `next`/`previous` presses have to be before the second one
 * is sent. A held arrow key would otherwise put one request per repeat on the
 * wire; the server already refuses to bump its version for a no-op, but the
 * requests themselves are still worth not making over venue wifi.
 */
const NAV_THROTTLE_MS = 60;

function readStoredSession(): ControllerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ControllerSession;
    if (!parsed?.sessionId || !parsed.controlToken || !parsed.joinCode) return null;
    // An expired session is not worth offering to resume: every action against
    // it would 410.
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

class PresentStore extends Store {
  /** Non-null exactly when this device is presenting. */
  session: ControllerSession | null = null;

  /** What is on the wall right now, as last reported by the server. */
  wall: PresentState | null = null;

  connection: PresentConnectionStatus = 'offline';

  /** The running order. Empty until `loadPlan` has run. */
  plan: PresentPlanEntry[] = [];

  /**
   * A message for the presenter, and only ever for the presenter -- nothing
   * here reaches the wall.
   */
  error: string | null = null;

  /** Whether the running order / preview panel is open. */
  panelOpen = false;

  /** See `CLICKER_KEY`. Read once at construction; this browser's own choice. */
  acceptClickerKeys = readStoredClickerPreference();

  /**
   * The phrase the presenter is lighting up in the active verse, or null.
   * Controller-local until sent -- see `sendHighlight` -- and only ever one at
   * a time.
   */
  highlightDraft: HighlightDraft | null = null;

  /** An intent is in flight. Used to keep the strip from looking dead. */
  busy = false;

  /**
   * Hymn titles, learned as the picker searches.
   *
   * The session state carries a hymn *id*, not its title -- the same way it
   * carries a book number rather than "John" -- so something has to turn one
   * into the other for the control strip and the running order. Looking it up
   * per render would mean a request per keystroke; remembering what the picker
   * already fetched costs nothing and covers every hymn the presenter has
   * actually seen. Anything unknown falls back to the id, which is at least
   * readable.
   */
  private readonly hymnTitles = new Map<string, string>();

  /** Hymn ids already looked up, so a burst of frames asks the server once. */
  private readonly hymnTitlesAsked = new Set<string>();

  private stream: EventSource | null = null;
  private lastNavAt = 0;

  /**
   * The same-machine sink for state this device predicts. See `predictLocal`
   * for what is safe to predict and why, and `transport/localChannel.ts` for
   * the transport itself.
   */
  private localChannel: LocalChannel | null = null;

  /** Chapter lengths this device has learned, keyed `module/book/chapter`. */
  private readonly chapterLengths = new Map<string, number>();
  private readonly chapterLengthsAsked = new Set<string>();
  /** Hymn slide counts this device has learned, keyed by `hymnSlideKey`. */
  private readonly slideCounts = new Map<string, number>();
  private readonly slideCountsAsked = new Set<string>();

  /**
   * The same pure reducer the server runs, so this device can predict what an
   * intent will do instead of waiting to be told. `chapterLength` and
   * `slideCount` answer from whatever `warmContext` has learned so far, and
   * `null` when it has not -- which `predictLocal` treats as "do not guess",
   * never as "assume zero".
   */
  private readonly intentContext: IntentContext = {
    chapterLength: (module, book, chapter) => this.chapterLengths.get(`${module}/${book}/${chapter}`) ?? null,
    slideCount: (hymnId, verseOrder) => this.slideCounts.get(hymnSlideKey(hymnId, verseOrder)) ?? null,
  };

  /** How often the wall is polled while this controller's stream is refused. */
  private static readonly REFUSED_POLL_MS = 5000;
  private refusedPoll: ReturnType<typeof setInterval> | null = null;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Pick up a session this device already holds, from a handoff link or from a
   * previous visit. Safe to call when there is nothing to pick up.
   */
  restore(adopted: ControllerSession | null): void {
    const session = adopted ?? readStoredSession();
    if (!session) return;
    this.enter(session);
  }

  /** Create a session and start presenting. */
  async start(): Promise<boolean> {
    this.error = null;
    this.busy = true;
    this.notify();
    try {
      const res = await fetch(`${API_BASE}/api/present/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        this.error = res.status === 503
          ? 'The server is already running as many sessions as it allows.'
          : 'Could not start a session.';
        return false;
      }
      const created = await res.json() as CreateSessionResponse;
      this.enter({
        sessionId: created.sessionId,
        joinCode: created.joinCode,
        controlToken: created.controlToken,
        expiresAt: created.expiresAt,
      });
      return true;
    } catch {
      this.error = 'Could not reach the server.';
      return false;
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  private enter(session: ControllerSession): void {
    this.session = session;
    this.error = null;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Private browsing. Costs the presenter their session on reload, which is
      // worth a shrug rather than a refusal to present.
    }
    this.openStream(session.joinCode);
    void this.loadPlan();
    this.notify();
  }

  /**
   * Stop driving from this device, leaving the session running.
   *
   * Distinct from `end` on purpose: closing a laptop lid should not blank the
   * wall, and a presenter who hands over to a phone still wants the screen up.
   */
  leave(): void {
    this.closeStream();
    this.session = null;
    this.wall = null;
    this.plan = [];
    this.panelOpen = false;
    this.highlightDraft = null;
    this.connection = 'offline';
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Nothing to do; the session is already out of memory.
    }
    this.notify();
  }

  /** End the session for everyone. The wall goes to its closing screen. */
  async end(): Promise<void> {
    if (this.session) await this.post({ type: 'end' });
    this.leave();
  }

  // -------------------------------------------------------------------------
  // The stream
  // -------------------------------------------------------------------------

  /**
   * The controller watches the same stream the viewers do, but does not count
   * as one of them.
   *
   * Watching is what keeps the strip honest: the viewer count is live, and a
   * session driven from a second device stays reflected here rather than
   * silently diverging.
   *
   * Not counting is the other half, and it matters more than it looks. The
   * number exists to answer one question -- "is the television actually
   * connected?" -- asked minutes before it would be embarrassing to find out
   * otherwise. A controller that counted itself would answer "one" before
   * anything was plugged in, which is not a smaller truth but the wrong answer
   * to the only question being asked.
   */
  private openStream(joinCode: string): void {
    this.closeStream();
    this.connection = 'connecting';
    this.localChannel = openLocalChannel(joinCode);

    const source = new EventSource(
      `${API_BASE}/api/present/j/${encodeURIComponent(joinCode)}/stream?preview=1`,
    );
    this.stream = source;

    source.addEventListener('state', event => {
      let next: PresentState;
      try {
        next = JSON.parse((event as MessageEvent<string>).data) as PresentState;
      } catch {
        return;
      }
      // Versions are monotonic; anything not newer is a duplicate. The viewer
      // count is the exception -- it rides along on the same frame and can
      // change without the version moving, so it is taken from every frame.
      if (this.wall && next.version < this.wall.version) {
        this.wall = { ...this.wall, session: next.session };
      } else {
        this.adoptWall(next);
      }
      // Non-null by construction: both branches above just set `this.wall`,
      // directly or through `adoptWall`, which the type checker cannot see
      // through a method call the way it can a plain assignment.
      this.learnHymnTitles([this.wall!.live]);
      this.connection = 'live';
      this.notify();
    });

    source.addEventListener('closed', event => {
      source.close();
      if (this.stream !== source) return;

      let reason: string | undefined;
      try {
        reason = (JSON.parse((event as MessageEvent<string>).data) as { reason?: string }).reason;
      } catch {
        // No readable reason is treated as the end, as it always was.
      }

      // Refused at the door is not the same as over. With joins locked, or the
      // session full, the server turns away *every* new stream -- this one
      // included. A presenter who locks joins and then reloads, or hands off
      // to a phone, would otherwise throw away the control token for a session
      // that is still running, with no way back to it.
      if (reason === 'locked' || reason === 'full') {
        this.stream = null;
        this.watchWhileRefused(joinCode, reason === 'locked');
        return;
      }

      // The session is over -- most likely because this controller ended it, or
      // because it expired. Either way there is nothing left to drive.
      this.leave();
    });

    source.onerror = () => {
      if (this.stream !== source) return;
      this.connection = this.wall ? 'reconnecting' : 'connecting';
      this.notify();
    };
  }

  /**
   * Keep up with the wall while the stream is refused.
   *
   * The state endpoint still answers a locked session, so polling it keeps the
   * strip and the viewer count honest. Once a lock lifts, the stream is opened
   * again and this stops. A full session is only polled: trying the stream
   * again would just be refused again.
   */
  private watchWhileRefused(joinCode: string, reopenWhenUnlocked: boolean): void {
    this.stopWatching();
    this.connection = this.wall ? 'reconnecting' : 'connecting';
    this.notify();

    const poll = async (): Promise<void> => {
      if (this.session?.joinCode !== joinCode) return;
      try {
        const res = await fetch(`${API_BASE}/api/present/j/${encodeURIComponent(joinCode)}/state`);
        if (res.status === 404 || res.status === 410) {
          this.leave();
          return;
        }
        if (!res.ok) return;
        const body = await res.json() as { state: PresentState };
        if (this.session?.joinCode !== joinCode) return;

        this.adoptWall(body.state);
        this.learnHymnTitles([body.state.live]);
        if (reopenWhenUnlocked && !body.state.session.joinsLocked) {
          this.openStream(joinCode);
        } else {
          this.connection = 'live';
        }
        this.notify();
      } catch {
        // The next tick will try again.
      }
    };

    void poll();
    this.refusedPoll = setInterval(() => void poll(), PresentStore.REFUSED_POLL_MS);
  }

  private stopWatching(): void {
    if (this.refusedPoll) clearInterval(this.refusedPoll);
    this.refusedPoll = null;
  }

  private closeStream(): void {
    this.stopWatching();
    this.stream?.close();
    this.stream = null;
    this.localChannel?.close();
    this.localChannel = null;
  }

  /** Adopt newly-known state. A thin, named wrapper so every call site reads the same way. */
  private adoptWall(next: PresentState): void {
    this.wall = next;
  }

  /**
   * Learn how long the given passage's chapter is, or how many slides the
   * given hymn makes, so a later `next`/`previous`/`goTo`/`show` against it can
   * be predicted locally.
   *
   * Called from `predictLocal` itself, on demand, the first time it declines
   * to guess about a given item for lack of this -- never eagerly on every
   * incoming frame. Two reasons: it means a passage or hymn nobody ever
   * navigates within is never fetched a second time for nothing, and it keeps
   * this request off the same tick as adopting state from the server, which
   * would otherwise interleave unpredictably with whatever request the caller
   * of `send` is about to make (as, for instance, `presentStore.test.ts`
   * asserts by position). Best-effort and silent: a failure here only means
   * `predictLocal` keeps declining to guess, exactly as it already does before
   * this has run.
   */
  private warmContext(item: PresentItem | null): void {
    if (!item) return;

    if (item.kind === 'passage') {
      const key = `${item.module}/${item.book}/${item.chapter}`;
      if (this.chapterLengths.has(key) || this.chapterLengthsAsked.has(key)) return;
      this.chapterLengthsAsked.add(key);
      fetch(`${API_BASE}/api/bible/${encodeURIComponent(item.module)}/${item.book}/${item.chapter}`)
        .then(res => (res.ok ? res.json() as Promise<{ verses?: unknown[] }> : null))
        .then(body => {
          if (Array.isArray(body?.verses) && body.verses.length > 0) {
            this.chapterLengths.set(key, body.verses.length);
          }
        })
        .catch(() => { /* Predictions for this chapter just stay unavailable. */ });
      return;
    }

    if (item.kind === 'hymn') {
      // The common case -- no verse-order override -- is exactly what
      // `learnHymnTitles` already fetches to learn a hymn's title, and that
      // response is a full detail, slides included. Piggybacking on it there
      // (rather than asking again here) is what keeps a hymn arriving on the
      // wall from costing two requests for the one thing.
      if (!item.verseOrder?.length) return;

      const key = hymnSlideKey(item.hymnId, item.verseOrder);
      if (this.slideCounts.has(key) || this.slideCountsAsked.has(key)) return;
      this.slideCountsAsked.add(key);
      const order = `?order=${encodeURIComponent(item.verseOrder.join(' '))}`;
      fetch(`${API_BASE}/api/hymns/${encodeURIComponent(item.hymnId)}${order}`)
        .then(res => (res.ok ? res.json() as Promise<{ slides?: unknown[] }> : null))
        .then(body => {
          if (Array.isArray(body?.slides)) this.slideCounts.set(key, body.slides.length);
        })
        .catch(() => { /* Same: the network path is entirely unaffected. */ });
    }
  }

  /** Whether `item` could be positioned within without guessing its length. */
  private hasWarmContext(item: PresentItem): boolean {
    if (item.kind === 'passage') return this.chapterLengths.has(`${item.module}/${item.book}/${item.chapter}`);
    if (item.kind === 'hymn') return this.slideCounts.has(hymnSlideKey(item.hymnId, item.verseOrder));
    // A text item has exactly one position (index 0) regardless of context.
    return true;
  }

  // -------------------------------------------------------------------------
  // Intents
  // -------------------------------------------------------------------------

  /**
   * Send an intent and adopt the state it answers with.
   *
   * The response carries the new state, so the strip updates without waiting
   * for its own broadcast to come back around the stream -- which matters on
   * the wifi this runs on.
   */
  async send(intent: PresentIntent): Promise<boolean> {
    if (!this.session) return false;
    // Captured before `predictLocal` may optimistically update `this.wall`, so
    // `post` can still tell whether *this* intent is the one that unlocked
    // joins, rather than comparing the prediction against itself.
    const wasLocked = this.wall?.session.joinsLocked ?? false;
    this.predictLocal(intent);
    this.busy = true;
    this.notify();
    try {
      return await this.post(intent, wasLocked);
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  /**
   * Compute, and publish to same-machine screens, the state this intent will
   * produce -- without waiting for the server. This is the whole of the
   * "non-network-reliant" path the spec asks for: a screen sharing this
   * browser updates the instant this runs, not when the POST below resolves.
   *
   * `next`/`previous`/`goTo` reposition within whatever is already live, and
   * `show` positions within the item it names; all four need to know how long
   * that passage's chapter is, or how many slides that hymn makes, to clamp
   * correctly at the ends -- exactly what the server's `IntentContext` knows
   * and this device only sometimes does (see `warmContext`). Guessing wrong
   * there would predict a version bump the server never makes, which nothing
   * could later correct: `isNewer` only lets a newer version replace an older
   * one, and there would be no newer version coming. So this predicts only
   * once the real length has been learned, never before, and every other
   * intent -- which the reducer computes without asking the outside world
   * anything -- is always safe.
   */
  private predictLocal(intent: PresentIntent): void {
    if (!this.wall) return;

    const needsContext = intent.type === 'show' || intent.type === 'goTo'
      || intent.type === 'next' || intent.type === 'previous';
    if (needsContext) {
      const item = intent.type === 'show' ? intent.item : this.wall.live;
      if (!item) return;
      if (!this.hasWarmContext(item)) {
        // Not known yet: learn it for next time, but do not guess now.
        this.warmContext(item);
        return;
      }
    }

    const stored: StoredPresentState = {
      version: this.wall.version,
      live: this.wall.live,
      position: this.wall.position,
      display: this.wall.display,
      session: {
        id: this.wall.session.id,
        joinCode: this.wall.session.joinCode,
        joinsLocked: this.wall.session.joinsLocked,
      },
    };

    const next = applyIntent(stored, intent, this.intentContext);
    if (!next) return;

    const predicted: PresentState = {
      ...next,
      version: this.wall.version + 1,
      session: { ...next.session, viewerCount: this.wall.session.viewerCount },
    };
    this.localChannel?.publish(predicted);
    this.adoptWall(predicted);
    this.notify();
  }

  /**
   * `wasLocked`, when given, is whether joins were locked before this intent
   * was sent -- captured by `send` before `predictLocal` could have already
   * moved `this.wall` on to a prediction of what this very intent produces.
   * `end` calls this directly, without a prediction ever having run, so it is
   * safe to fall back to reading `this.wall` there.
   */
  private async post(intent: PresentIntent, wasLocked?: boolean): Promise<boolean> {
    const session = this.session;
    if (!session) return false;
    try {
      const res = await fetch(`${API_BASE}/api/present/s/${session.sessionId}/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Present-Token': session.controlToken,
        },
        body: JSON.stringify({ intent }),
      });

      if (res.status === 404 || res.status === 410) {
        // The session is gone, or this token no longer drives it. Saying so is
        // better than leaving the presenter pressing a dead button.
        this.error = 'This session has ended.';
        this.leave();
        return false;
      }
      if (!res.ok) {
        this.error = 'The screen did not accept that.';
        return false;
      }

      const body = await res.json() as { state: PresentState };
      if (body.state) {
        wasLocked ??= this.wall?.session.joinsLocked ?? false;
        this.adoptWall(body.state);
        this.learnHymnTitles([body.state.live]);
        // This controller just unlocked joins while its own stream was being
        // refused: there is no reason to wait for the next poll to find out.
        // Only on that change -- a session refused for being full is unlocked
        // all along, and retrying its stream would just be refused again.
        if (this.refusedPoll && wasLocked && !body.state.session.joinsLocked) {
          this.openStream(session.joinCode);
        }
      }
      this.error = null;
      return true;
    } catch {
      // A failed intent is not a failed session: EventSource is reconnecting on
      // its own and the next press may well work.
      this.error = 'Could not reach the screen.';
      return false;
    }
  }

  /** Put a passage on the wall, anchored at `verse`. */
  show(item: PresentItem, index?: number): Promise<boolean> {
    return this.send({ type: 'show', item, index });
  }

  /**
   * Advance or retreat, at a rate a held key cannot flood.
   *
   * Resolves `false` when the press was swallowed, which callers ignore -- the
   * distinction that matters is that nothing was sent, not that it failed.
   */
  step(direction: 'next' | 'previous'): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastNavAt < NAV_THROTTLE_MS) return Promise.resolve(false);
    this.lastNavAt = now;
    return this.send({ type: direction });
  }

  /** Jump to an absolute position within what is live (a verse number, or a slide index). */
  goTo(index: number): Promise<boolean> {
    return this.send({ type: 'goTo', index });
  }

  /** Fade the wall to black, or bring it back. Never destroys what is on it. */
  toggleBlank(): Promise<boolean> {
    return this.send({ type: this.wall?.display.blanked ? 'unblank' : 'blank' });
  }

  // -------------------------------------------------------------------------
  // The running order
  // -------------------------------------------------------------------------

  async loadPlan(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      const res = await fetch(`${API_BASE}/api/present/s/${session.sessionId}/plan`, {
        headers: { 'X-Present-Token': session.controlToken },
      });
      if (!res.ok) return;
      const body = await res.json() as { plan: PresentPlanEntry[] };
      this.plan = body.plan ?? [];
      this.learnHymnTitles(this.plan.map(entry => entry.item));
      this.notify();
    } catch {
      // The plan is a convenience; failing to load it must not stop a service.
    }
  }

  /**
   * Replace the running order.
   *
   * The local copy is updated first and kept even if the save fails: losing
   * what the presenter just typed because the wifi hiccupped would be worse
   * than a running order that is briefly only on this device.
   */
  async savePlan(plan: PresentPlanEntry[]): Promise<boolean> {
    const session = this.session;
    if (!session) return false;
    this.plan = plan;
    this.notify();
    try {
      const res = await fetch(`${API_BASE}/api/present/s/${session.sessionId}/plan`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Present-Token': session.controlToken,
        },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        this.error = 'The running order could not be saved.';
        this.notify();
        return false;
      }
      // The server assigns ids to new entries; take its answer as authoritative
      // so a later reorder refers to entries it recognises.
      const body = await res.json() as { plan: PresentPlanEntry[] };
      if (body.plan) this.plan = body.plan;
      this.notify();
      return true;
    } catch {
      this.error = 'The running order could not be saved.';
      this.notify();
      return false;
    }
  }

  addToPlan(item: PresentItem, note?: string): Promise<boolean> {
    // No id: the server mints one, which keeps id generation in a single place.
    const entry = { id: '', item, ...(note ? { note } : {}) } as PresentPlanEntry;
    return this.savePlan([...this.plan, entry]);
  }

  removeFromPlan(id: string): Promise<boolean> {
    return this.savePlan(this.plan.filter(entry => entry.id !== id));
  }

  /** Move an entry to sit where another one currently is. */
  reorderPlan(fromId: string, toId: string): Promise<boolean> {
    const from = this.plan.findIndex(entry => entry.id === fromId);
    const to = this.plan.findIndex(entry => entry.id === toId);
    if (from < 0 || to < 0 || from === to) return Promise.resolve(false);
    const next = [...this.plan];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return this.savePlan(next);
  }

  // -------------------------------------------------------------------------
  // UI state
  // -------------------------------------------------------------------------

  rememberHymns(hymns: HymnSummary[]): void {
    let learned = false;
    for (const hymn of hymns) {
      if (this.hymnTitles.get(hymn.id) === hymn.title) continue;
      this.hymnTitles.set(hymn.id, hymn.title);
      learned = true;
    }
    if (learned) this.notify();
  }

  hymnTitle(hymnId: string): string | null {
    return this.hymnTitles.get(hymnId) ?? null;
  }

  /**
   * Look up the titles of hymns the picker has not shown on this device.
   *
   * After a reload, or on a phone a session was handed off to, the picker has
   * never run here -- so without this the strip and the running order would
   * name the hymn on the wall `amazing-grace`. Each id is asked for once; a
   * failure leaves the id as the label, which is where it would have been.
   *
   * The response is a full hymn detail, slides included, at the hymn's default
   * order -- so this is also where `predictLocal` learns how many slides a
   * hymn with no verse-order override makes (see `warmContext`), without a
   * second request for the one thing.
   */
  private learnHymnTitles(items: Array<PresentItem | null | undefined>): void {
    for (const item of items) {
      if (item?.kind !== 'hymn') continue;
      const id = item.hymnId;
      if (this.hymnTitles.has(id) || this.hymnTitlesAsked.has(id)) continue;
      this.hymnTitlesAsked.add(id);
      fetch(`${API_BASE}/api/hymns/${encodeURIComponent(id)}`)
        .then(res => (res.ok ? res.json() as Promise<HymnSummary & { slides?: unknown[] }> : null))
        .then(hymn => {
          if (hymn?.title) this.rememberHymns([hymn]);
          if (Array.isArray(hymn?.slides)) this.slideCounts.set(hymnSlideKey(id, undefined), hymn.slides.length);
        })
        .catch(() => { /* The id stays as the label, and no slide count is learned. */ });
    }
  }

  setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.notify();
  }

  setAcceptClickerKeys(accept: boolean): void {
    this.acceptClickerKeys = accept;
    try {
      if (accept) localStorage.removeItem(CLICKER_KEY);
      else localStorage.setItem(CLICKER_KEY, '0');
    } catch {
      // Private browsing: the choice lasts for this tab only.
    }
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Word highlight
  // -------------------------------------------------------------------------

  /** A press-and-hold on a word of the active verse: start a fresh one-word draft. */
  beginHighlight(verseId: number, index: number): void {
    this.highlightDraft = beginDraft(verseId, index);
    this.notify();
  }

  /** A plain tap on a word of the active verse while a draft exists. */
  tapHighlightWord(verseId: number, index: number): void {
    const next = tapDraft(this.highlightDraft, verseId, index);
    if (next === this.highlightDraft) return;
    const wasOnWall = draftIsOnWall(this.highlightDraft, this.wall?.position.highlight ?? null);
    this.highlightDraft = next;
    // Tapping the highlight to clear it clears it on the screen too, but
    // stretching or trimming a phrase that is already up must not: the screen
    // keeps showing what was confirmed until the new range is confirmed.
    if (next === null && wasOnWall) void this.send({ type: 'clearHighlight' });
    this.notify();
  }

  /**
   * Drop the draft (Esc, the Clear button, tapping the highlight). If the
   * screen is showing it, the screen's highlight goes too -- clearing a
   * highlight the room can still see would leave the presenter unable to tell
   * what the wall is showing.
   */
  clearHighlight(): void {
    const wasOnWall = draftIsOnWall(this.highlightDraft, this.wall?.position.highlight ?? null);
    if (!this.highlightDraft) return;
    this.highlightDraft = null;
    if (wasOnWall) void this.send({ type: 'clearHighlight' });
    this.notify();
  }

  /**
   * Forget the draft without touching the screen. For when the draft became
   * meaningless on its own (the active verse moved on; the wall's own
   * highlight was cleared elsewhere).
   */
  discardHighlightDraft(): void {
    if (!this.highlightDraft) return;
    this.highlightDraft = null;
    this.notify();
  }

  /**
   * Confirm: put the draft on the screen. If the wall is not already showing
   * this verse of this passage, the verse is sent first -- a highlight
   * against a verse nobody can see would do nothing.
   */
  async sendHighlight(item: PresentItem, verseNumber: number): Promise<boolean> {
    const draft = this.highlightDraft;
    if (!draft) return false;
    const live = this.wall?.live;
    const onWall = live?.kind === 'passage' && item.kind === 'passage'
      && live.module === item.module && live.book === item.book && live.chapter === item.chapter
      && this.wall?.position.index === verseNumber;
    if (!onWall && !(await this.show(item, verseNumber))) return false;
    // `show` clears any highlight; `this.highlightDraft` may have been dropped
    // while it was in flight, in which case there is nothing left to send.
    if (this.highlightDraft !== draft) return false;
    return this.send({ type: 'setHighlight', highlight: draftToRange(draft) });
  }

  clearError(): void {
    this.error = null;
    this.notify();
  }
}

export const presentStore = new PresentStore();
