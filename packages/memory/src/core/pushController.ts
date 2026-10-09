/**
 * The push-card service (task 0072), run inside the worker.
 *
 * It owns one job: keep the set of scheduled "memory card" reminders in step
 * with the user's settings and progress, and serve the in-app card stack.
 *
 * Two modes, chosen by what the host reports:
 *
 *   - host mode: the host has `api.reminders`, permission is granted and the
 *     feature is on. Each recompute hands the host the next few reminders
 *     (`replaceAll`). The database rows mirror them.
 *   - degraded mode: no host API, permission denied/prompt/unsupported. The same
 *     rows are kept but never sent; a one-minute tick promotes due rows to
 *     `waiting`, which the panel shows as a "cards waiting" banner.
 *
 * Everything the controller touches from outside (clock, calendar, rng, verse
 * fetch, posting to the panel) is injected so it is testable without a DOM.
 * Notification text never contains verse text; see `pushCards.ts`.
 */

import { applicableRungs, passageWellLearned } from './ladder';
import {
  buildReminderItems,
  cueFor,
  normalizePushSettings,
  reminderKey,
  selectForFires,
  statusMessage,
} from './pushCards';
import { RECALL_SCORES } from './pushTypes';
import type {
  CardStackView,
  IRemindersApi,
  JsonValue,
  PushCandidate,
  PushCardRow,
  PushCardSettings,
  PushSettingsView,
  RecallCardView,
  RecallGrade,
  ReminderCapabilities,
} from './pushTypes';
import { expandPlan, nextAllowed, reconcileMissed } from './reminderPlan';
import type { Calendar } from './reminderPlan';
import { schedule, makeRng } from './scheduler';
import { activityLevels, byCard, scopeOf } from './store';
import type { MemoryStore } from './store';
import { RUNG_ORDER } from './types';
import type { Passage, VerseText, WorkerPush } from './types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** How far ahead reminders are planned and handed to the host. */
export const PLAN_HORIZON_MS = 3 * DAY;
/** Missed-while-away rows older than this are dropped instead of waiting. */
export const WAITING_MAX_AGE_MS = 12 * HOUR;
/** A notification click the panel never asked about stops counting after this. */
export const LAUNCH_INTENT_MAX_AGE_MS = 5 * 60 * 1000;
export const PRUNE_AGE_MS = 30 * DAY;
const MAX_ATTEMPT_MS = 30 * 60 * 1000;
const MIN_LEAD_MS = 60 * 1000;

export interface DetectedReminders {
  api: IRemindersApi;
  caps: ReminderCapabilities;
}

/**
 * Feature-detect the host's reminder API. Returns null when it is absent,
 * malformed, throws, or does not answer within `timeoutMs`.
 */
export async function detectReminders(
  api: unknown,
  timeoutMs = 2000,
): Promise<DetectedReminders | null> {
  const r = (api as { reminders?: unknown } | null | undefined)?.reminders;
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (
    typeof o.replaceAll !== 'function' ||
    typeof o.capabilities !== 'function' ||
    typeof o.requestPermission !== 'function'
  ) {
    return null;
  }
  const caps = await readCaps(r as IRemindersApi, timeoutMs);
  return caps ? { api: r as IRemindersApi, caps } : null;
}

async function readCaps(api: IRemindersApi, timeoutMs: number): Promise<ReminderCapabilities | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const caps = await Promise.race([Promise.resolve().then(() => api.capabilities()), timeout]);
    return caps ?? null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface PushDeps {
  store: MemoryStore;
  /** The host api object; `detectReminders` looks for `.reminders` on it. */
  api: unknown;
  now: () => number;
  calendar: Calendar;
  rng: () => number;
  fetchVerses: (passage: Passage) => Promise<VerseText[]>;
  post: (push: WorkerPush) => void;
  refreshStatus: () => Promise<void>;
  /** Open the panel on a notification click. Failures are ignored. */
  openPanel?: () => Promise<void>;
  /** Debounce for requestRecompute. Default 250. */
  debounceMs?: number;
  /** Degraded-mode tick period. Default 60000. */
  tickMs?: number;
  /** Timeout for capabilities(). Default 2000. */
  capabilitiesTimeoutMs?: number;
}

interface Handle {
  dispose(): void | Promise<void>;
}

export class PushController {
  private reminders: DetectedReminders | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private handles: Handle[] = [];
  /** A notification click the panel has not yet asked about. Expires. */
  private pendingOpen: { key: string; at: number } | null = null;
  /** The clicked card, shown first in the stack until it is graded or snoozed. */
  private priorityKey: string | null = null;
  private disposed = false;
  private lastRecomputeAt = 0;
  private lastRecomputeDay = -1;

  constructor(private readonly deps: PushDeps) {}

  // -- lifecycle ------------------------------------------------------------

  async start(): Promise<void> {
    const d = this.deps;
    this.reminders = await detectReminders(d.api, d.capabilitiesTimeoutMs ?? 2000);
    if (this.reminders) {
      const api = this.reminders.api as unknown as Record<string, unknown>;
      await this.subscribe(api, 'onActivated', (e) => this.handleActivated(e as never));
      await this.subscribe(api, 'onMissed', (e) => this.handleMissed(e as never));
    }
    try {
      await d.store.prunePushCards(d.now(), PRUNE_AGE_MS);
    } catch {
      /* housekeeping only */
    }
    await this.recomputeNow();
    if (this.disposed) return;
    this.interval = setInterval(() => void this.tick(), d.tickMs ?? 60_000);
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const h of this.handles) {
      try {
        void Promise.resolve(h.dispose()).catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
    this.handles = [];
  }

  private async subscribe(
    api: Record<string, unknown>,
    name: 'onActivated' | 'onMissed',
    listener: (e: unknown) => Promise<void>,
  ): Promise<void> {
    const fn = api[name];
    if (typeof fn !== 'function') return;
    try {
      const h = (await (fn as (l: typeof listener) => unknown).call(api, listener)) as Handle | undefined;
      if (h && typeof h.dispose === 'function') this.handles.push(h);
    } catch {
      /* the host lacks this event; degrade silently */
    }
  }

  // -- recompute --------------------------------------------------------------

  /** Schedule a recompute soon; bursts coalesce. */
  requestRecompute(_reason: string): void {
    if (this.disposed) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.recomputeNow();
    }, this.deps.debounceMs ?? 250);
  }

  /** Recompute now, after any recompute already running. */
  recomputeNow(): Promise<void> {
    return this.enqueue(() => this.doRecompute());
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn);
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  private async loadSettings(): Promise<PushCardSettings> {
    const raw = await this.deps.store.getPushSettingsRaw();
    if (raw === undefined) return normalizePushSettings(undefined);
    try {
      return normalizePushSettings(JSON.parse(raw) as unknown);
    } catch {
      return normalizePushSettings(undefined);
    }
  }

  private hostMode(settings: PushCardSettings): boolean {
    return !!this.reminders && this.reminders.caps.permission === 'granted' && settings.enabled;
  }

  private async refreshCaps(): Promise<void> {
    if (!this.reminders) return;
    const caps = await readCaps(this.reminders.api, this.deps.capabilitiesTimeoutMs ?? 2000);
    if (caps) this.reminders = { api: this.reminders.api, caps };
  }

  private async doRecompute(): Promise<void> {
    if (this.disposed) return;
    const { store, calendar } = this.deps;
    const now = this.deps.now();
    await this.refreshCaps();
    const settings = await this.loadSettings();
    const host = this.hostMode(settings);
    this.lastRecomputeAt = now;
    this.lastRecomputeDay = calendar.startOfDay(now);

    if (!settings.enabled) {
      // Keep snooze rows: a snooze made while cards are off survives re-enabling.
      await store.deleteFutureScheduled(Number.MIN_SAFE_INTEGER, 'plan');
      if (this.reminders && this.reminders.caps.permission === 'granted') {
        await this.replaceAll([]);
      }
      return;
    }

    // Rows whose time has passed: the host fired them (host mode) or the tick
    // turns them into waiting cards (degraded).
    if (host) await store.promoteScheduled(now, 'fired');
    else await this.promoteDegraded(now);

    await store.deleteFutureScheduled(now, 'plan');

    const facts = await store.listPushCandidateFacts();
    const wellLearned = await this.wellLearnedIds();
    const candidates: PushCandidate[] = facts.map((f) => ({
      ...f,
      wellLearned: wellLearned.has(f.passageId),
    }));

    const fires = expandPlan(settings.plan, now, PLAN_HORIZON_MS, calendar).filter(
      (f) => f.at > now + MIN_LEAD_MS,
    );
    const dayStart = calendar.startOfDay(now);
    const assignments = selectForFires(fires, candidates, {
      source: settings.source,
      pinned: settings.pinnedPassageIds,
      usedByDay: await store.usedPassageIdsByDay(dayStart, (ms) => calendar.startOfDay(ms)),
      cal: calendar,
    });
    await store.insertPushCards(
      assignments.map((a) => ({
        key: reminderKey(a.passageId, a.at),
        passageId: a.passageId,
        fireAt: a.at,
        origin: 'plan' as const,
        state: 'scheduled' as const,
        updatedAt: now,
      })),
    );

    if (host) {
      const scheduled = (await store.listPushCards(['scheduled'])).filter((r) => r.fireAt > now);
      const refs = new Map(facts.map((f) => [f.passageId, f.reference]));
      const items = buildReminderItems(
        scheduled.map((r) => ({ at: r.fireAt, passageId: r.passageId })),
        refs,
        settings,
        20,
        PLAN_HORIZON_MS,
        now,
      );
      await this.replaceAll(items);
    }
  }

  private async replaceAll(items: Parameters<IRemindersApi['replaceAll']>[0]): Promise<void> {
    if (!this.reminders) return;
    try {
      await this.reminders.api.replaceAll(items);
    } catch {
      /* the next recompute retries */
    }
  }

  /** Scheduled rows now in the past become waiting (recent) or dropped (old). */
  private async promoteDegraded(now: number): Promise<number> {
    const { store } = this.deps;
    const past = (await store.listPushCards(['scheduled'])).filter((r) => r.fireAt <= now);
    if (past.length === 0) return 0;
    const split = reconcileMissed(
      past.map((r) => ({ at: r.fireAt, key: r.key })),
      now,
      { collapseWithinMs: WAITING_MAX_AGE_MS },
    );
    for (const r of split.summarize) await store.setPushCardState(r.key, 'waiting', now);
    for (const r of split.drop) await store.setPushCardState(r.key, 'dropped', now);
    if (split.summarize.length > 0) await this.postWaiting();
    return split.summarize.length;
  }

  private async postWaiting(): Promise<void> {
    await this.deps.refreshStatus();
    this.deps.post({ type: 'cardsWaitingChanged', count: await this.deps.store.waitingCount() });
  }

  /** Called every minute. */
  async tick(): Promise<void> {
    if (this.disposed) return;
    await this.enqueue(async () => {
      const { calendar } = this.deps;
      const now = this.deps.now();
      const settings = await this.loadSettings();
      if (!settings.enabled) return;
      if (this.hostMode(settings)) {
        const newDay = calendar.startOfDay(now) !== this.lastRecomputeDay;
        if (newDay || now - this.lastRecomputeAt >= HOUR) await this.doRecompute();
        return;
      }
      await this.promoteDegraded(now);
    });
  }

  // -- host events --------------------------------------------------------------

  handleMissed(e: { keys: string[] }): Promise<void> {
    return this.enqueue(async () => {
      const { store } = this.deps;
      const now = this.deps.now();
      let changed = false;
      for (const key of e?.keys ?? []) {
        const row = await store.getPushCard(key);
        if (!row || row.state === 'done' || row.state === 'dropped') continue;
        if (now - row.fireAt > WAITING_MAX_AGE_MS) {
          await store.setPushCardState(key, 'dropped', now);
        } else {
          await store.setPushCardState(key, 'waiting', now);
        }
        changed = true;
      }
      if (changed) await this.postWaiting();
    });
  }

  handleActivated(e: { key: string; data?: JsonValue; firedAt: number }): Promise<void> {
    return this.enqueue(async () => {
      const { store } = this.deps;
      const now = this.deps.now();
      const row = await store.getPushCard(e.key);
      if (row && (row.state === 'done' || row.state === 'dropped')) {
        // Already handled: do not revive it, just bring the app up.
        await this.openPanelSafe();
        return;
      }
      if (row) {
        await store.setPushCardState(e.key, 'waiting', now);
      } else {
        const pid = (e.data as { passageId?: unknown } | null | undefined)?.passageId;
        if (typeof pid !== 'number' || !(await store.getPassage(pid))) return;
        await store.insertPushCards([
          {
            key: e.key,
            passageId: pid,
            fireAt: typeof e.firedAt === 'number' ? e.firedAt : now,
            origin: 'plan',
            state: 'waiting',
            updatedAt: now,
          },
        ]);
      }
      this.pendingOpen = { key: e.key, at: now };
      this.priorityKey = e.key;
      await this.openPanelSafe();
      this.deps.post({ type: 'showCard', key: e.key });
      await this.postWaiting();
    });
  }

  private async openPanelSafe(): Promise<void> {
    try {
      await this.deps.openPanel?.();
    } catch {
      /* the panel may already be open */
    }
  }

  private clearIntent(key: string | undefined): void {
    if (!key) return;
    if (this.pendingOpen?.key === key) this.pendingOpen = null;
    if (this.priorityKey === key) this.priorityKey = null;
  }

  // -- panel requests -------------------------------------------------------------

  async getSettingsView(): Promise<PushSettingsView> {
    const settings = await this.loadSettings();
    const facts = await this.deps.store.listPushCandidateFacts();
    const caps = this.reminders?.caps ?? null;
    return {
      settings,
      status: {
        hostApi: this.reminders !== null,
        permission: caps?.permission ?? null,
        whenClosed: caps?.whenClosed ?? null,
        message: statusMessage(this.reminders !== null, caps, settings.enabled),
      },
      passages: facts.map((f) => ({ id: f.passageId, reference: f.reference })),
    };
  }

  async setSettings(raw: unknown): Promise<PushSettingsView> {
    const settings = normalizePushSettings(raw);
    await this.deps.store.setPushSettingsRaw(JSON.stringify(settings));
    await this.recomputeNow();
    await this.postWaiting();
    return this.getSettingsView();
  }

  async requestPermission(): Promise<PushSettingsView> {
    if (!this.reminders) {
      this.reminders = await detectReminders(this.deps.api, this.deps.capabilitiesTimeoutMs ?? 2000);
    }
    if (this.reminders) {
      try {
        await this.reminders.api.requestPermission();
      } catch {
        /* treated as unchanged */
      }
      await this.recomputeNow();
    }
    return this.getSettingsView();
  }

  waitingCount(): Promise<number> {
    return this.deps.store.waitingCount();
  }

  /** Whether a recent notification click asked for a card. Keeps the stack ordering. */
  consumeLaunchIntent(): { showCard: boolean; key?: string } {
    const p = this.pendingOpen;
    this.pendingOpen = null;
    if (p && this.deps.now() - p.at <= LAUNCH_INTENT_MAX_AGE_MS) return { showCard: true, key: p.key };
    return { showCard: false };
  }

  async getStack(): Promise<CardStackView> {
    const { store } = this.deps;
    const now = this.deps.now();
    const settings = await this.loadSettings();
    const waiting = await store.listPushCards(['waiting']);
    const ordered = [
      ...waiting.filter((r) => r.key === this.priorityKey),
      ...waiting.filter((r) => r.key !== this.priorityKey),
    ];
    const facts = await store.listPushCandidateFacts();
    const factById = new Map(facts.map((f) => [f.passageId, f]));
    const inStack = new Set<number>();
    const picks: { row: PushCardRow; passageId: number }[] = [];
    const stale: PushCardRow[] = [];

    for (const row of ordered) {
      const f = factById.get(row.passageId);
      const fresh = !!f && !(f.lastAttemptAt !== null && f.lastAttemptAt > row.fireAt);
      if (fresh && !inStack.has(row.passageId)) {
        inStack.add(row.passageId);
        picks.push({ row, passageId: row.passageId });
      } else {
        stale.push(row);
      }
    }

    if (stale.length > 0) {
      const wellLearned = await this.wellLearnedIds();
      for (const row of stale) {
        // Never substitute a passage that is itself one of the stale cards.
        const candidates: PushCandidate[] = facts
          .filter((f) => !inStack.has(f.passageId) && !stale.some((r) => r.passageId === f.passageId))
          .map((f) => ({ ...f, wellLearned: wellLearned.has(f.passageId) }));
        const [sub] = selectForFires([{ at: now, slotId: 'substitute' }], candidates, {
          source: settings.source,
          pinned: settings.pinnedPassageIds,
          usedByDay: new Map(),
          cal: this.deps.calendar,
        });
        if (sub) {
          inStack.add(sub.passageId);
          picks.push({ row, passageId: sub.passageId });
        } else {
          await store.setPushCardState(row.key, 'dropped', now);
        }
      }
    }

    const cards: RecallCardView[] = [];
    for (const { row, passageId } of picks) {
      const passage = await store.getPassage(passageId);
      if (!passage) continue;
      let verses: VerseText[] = [];
      try {
        verses = await this.deps.fetchVerses(passage);
      } catch {
        verses = [];
      }
      const words = verses.flatMap((v) => v.words);
      cards.push({
        key: row.key,
        passageId,
        reference: passage.reference,
        cue: cueFor(words, settings.prompt),
        verses,
        firedAt: row.fireAt,
      });
    }
    return { cards, waitingCount: cards.length };
  }

  grade(req: {
    passageId: number;
    grade: RecallGrade;
    key?: string;
    durationMs?: number;
  }): Promise<{ nextDueAt: number | null; stack: CardStackView }> {
    return this.enqueue(() => this.gradeNow(req));
  }

  private async gradeNow(req: {
    passageId: number;
    grade: RecallGrade;
    key?: string;
    durationMs?: number;
  }): Promise<{ nextDueAt: number | null; stack: CardStackView }> {
    const { store } = this.deps;
    const passage = await store.getPassage(req.passageId);
    if (!passage) throw new Error('That passage is no longer in your plan.');
    const now = this.deps.now();
    const score = Object.prototype.hasOwnProperty.call(RECALL_SCORES, req.grade)
      ? RECALL_SCORES[req.grade]
      : undefined;
    if (score === undefined) throw new Error('Unknown grade.');

    const card = await store.ensureRecallCard(passage.id);
    await store.recordAttempt({
      cardId: card.id,
      at: now,
      score,
      correctFirst: req.grade === 'knew' ? 1 : 0,
      totalSteps: 1,
      durationMs: Math.min(MAX_ATTEMPT_MS, Math.max(0, Math.round(req.durationMs ?? 0))),
      tier: 0,
    });
    const result = schedule({
      intervalStep: card.intervalStep,
      streak: card.streak,
      score,
      now,
      rng: makeRng(now ^ card.id),
    });
    await store.applySchedule(card.id, result, score);

    if (req.grade === 'missed') await this.reopenHardestRung(passage, now);

    // Settle this passage's waiting/fired cards (and the tapped key).
    if (req.key) await store.setPushCardState(req.key, 'done', now);
    this.clearIntent(req.key);
    for (const r of await store.listPushCards(['waiting', 'fired'])) {
      if (r.passageId === passage.id) await store.setPushCardState(r.key, 'done', now);
    }

    await this.deps.refreshStatus();
    this.deps.post({ type: 'planChanged' });
    await this.postWaiting();
    await this.doRecompute();
    return { nextDueAt: result.dueAt, stack: await this.getStack() };
  }

  /** A miss on a well-learned passage makes its hardest activity due now. */
  private async reopenHardestRung(passage: Passage, now: number): Promise<void> {
    const { store } = this.deps;
    const siblings = await store.listPassages(passage.collectionId);
    const scope = scopeOf(siblings);
    const cards = await store.listCards(passage.id);
    const tierRows = byCard(await store.listTierProgress([passage.id]));
    if (!passageWellLearned(activityLevels(passage, cards, tierRows, scope))) return;
    const applicable = new Set(
      applicableRungs(passage.verseCount, scope.siblingCount, scope.scopeVerseCount),
    );
    const candidates = cards.filter((c) => applicable.has(c.rung));
    candidates.sort((a, b) => RUNG_ORDER.indexOf(a.rung) - RUNG_ORDER.indexOf(b.rung));
    const hardest = candidates[candidates.length - 1];
    if (hardest) await store.setCardDueAt(hardest.id, now);
  }

  snooze(req: { passageId: number; key?: string }): Promise<{ snoozedUntil: number }> {
    return this.enqueue(() => this.snoozeNow(req));
  }

  private async snoozeNow(req: { passageId: number; key?: string }): Promise<{ snoozedUntil: number }> {
    const { store, calendar } = this.deps;
    const now = this.deps.now();
    const settings = await this.loadSettings();
    const at = nextAllowed(now + HOUR, settings.plan.quiet, calendar);
    if (req.key) await store.setPushCardState(req.key, 'done', now);
    this.clearIntent(req.key);
    for (const r of await store.listPushCards(['waiting'])) {
      if (r.passageId === req.passageId) await store.setPushCardState(r.key, 'done', now);
    }
    await store.insertPushCards([
      {
        key: reminderKey(req.passageId, at),
        passageId: req.passageId,
        fireAt: at,
        origin: 'snooze',
        state: 'scheduled',
        updatedAt: now,
      },
    ]);
    await this.postWaiting();
    await this.doRecompute();
    return { snoozedUntil: at };
  }

  // -- helpers ------------------------------------------------------------------------

  /** Ids of live passages that are well learned, from the existing ladder rules. */
  private async wellLearnedIds(): Promise<Set<number>> {
    const { store } = this.deps;
    const passages = await store.listPassagesInScope({ kind: 'all' });
    const byCollection = new Map<number, Passage[]>();
    for (const p of passages) {
      const list = byCollection.get(p.collectionId);
      if (list) list.push(p);
      else byCollection.set(p.collectionId, [p]);
    }
    const tierRows = byCard(await store.listTierProgress(passages.map((p) => p.id)));
    const out = new Set<number>();
    for (const group of byCollection.values()) {
      const scope = scopeOf(group);
      for (const p of group) {
        const cards = await store.listCards(p.id);
        if (passageWellLearned(activityLevels(p, cards, tierRows, scope))) out.add(p.id);
      }
    }
    return out;
  }
}
