/**
 * The reminder engine both apps run: sources in, notifications out, one timer.
 *
 * Platform work goes through small ports so the same engine runs in the
 * Electron main process (OS notifications, JSON file, powerMonitor) and in a
 * browser tab (Notifications API, localStorage), and in tests with fakes:
 *
 *   clock      now()
 *   timer      one pending callback at a time
 *   presenter  shows a notification (the host routes clicks back via `activate`)
 *   state      persists checkpoints and item sources' pending sets
 *
 * Two kinds of source:
 *   - rule sources (app features: verse of the day, reading plans, prayer)
 *     give a {@link ReminderPlan}; content is rendered at fire time, so it is
 *     never stale and a source can skip a fire (today's reading already read);
 *   - item sources (extensions) hand over concrete {@link ReminderItem}s with
 *     content bound at scheduling time; the engine persists and fires them
 *     even when the extension is not running.
 *
 * Firing model. The engine never trusts its timer: every `wake()` (timer,
 * resume from sleep, clock or zone change, settings change, a guard tick)
 * looks at what came due since each source's checkpoint, classifies it with
 * {@link reconcileMissed} and presents at most one collapsed notification per
 * source for late ones. During global quiet hours it does nothing, so what
 * came due is shown, collapsed, when they end.
 */
import { expandPlan, firesBetween, endOfQuietHours, isInQuietHours } from './plan';
import { reconcileMissed } from './reconcile';
import { isSourceEnabled, normalizeNotificationSettings, type NotificationSettings } from './settings';
import { systemTimeZone } from './time';
import {
  DEFAULT_MISSED_POLICY,
  REMINDER_LIMITS,
  type FireTime,
  type JsonValue,
  type MissedPolicy,
  type NotificationContent,
  type ReminderItem,
  type ReminderPlan,
  type ReminderTarget,
} from './types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface ReminderClock {
  now(): number;
}

export interface ReminderTimer {
  /** Call `cb` after `delayMs`. At most one is pending; `set` replaces it. */
  set(delayMs: number, cb: () => void): void;
  clear(): void;
}

/** A notification the engine asks the host to show. */
export interface PresentedNotification extends NotificationContent {
  /** Unique per presentation; pass back to {@link ReminderScheduler.activate} on click. */
  id: string;
  sourceId: string;
  /** Item keys (item sources) or fire keys (`slotId@epochMs`, rule sources) this covers. */
  keys: string[];
  /** When it was due (the latest one, for a collapsed notification). */
  dueAt: number;
  /** True when shown late (after sleep, a quit or quiet hours). */
  missed: boolean;
  /** How many reminders it stands for (> 1 only when collapsed). */
  count: number;
  /** An item's `data`, for a single item-source reminder. */
  data?: JsonValue;
}

export interface ReminderPresenter {
  show(n: PresentedNotification): void | Promise<void>;
}

/** What the engine persists between runs. */
export interface ReminderState {
  version: 1;
  /** Per source: everything due at or before this instant has been handled. */
  checkpoints: Record<string, number>;
  /** Item sources' pending sets, by source id. */
  items: Record<string, ReminderItem[]>;
  /** Display labels of item sources (shown even before the source registers again). */
  labels: Record<string, string>;
}

export interface ReminderStatePort {
  load(): ReminderState | null | Promise<ReminderState | null>;
  save(state: ReminderState): void | Promise<void>;
}

/** Host-supplied, localized strings the engine needs. */
export interface ReminderStrings {
  /** A collapsed notification for an item source: e.g. title = label, body = "3 reminders waiting". */
  collapsed(sourceLabel: string, count: number): { title: string; body: string };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface FireContext {
  sourceId: string;
  /** The fire being shown (the latest one when several were missed). */
  fire: FireTime;
  /** True when shown late. */
  missed: boolean;
  /** How many fires this notification stands for. */
  count: number;
  timeZone: string;
}

export interface ReminderActivation {
  sourceId: string;
  keys: string[];
  /** The single item's data, if any. */
  data?: JsonValue;
  dueAt: number;
  activatedAt: number;
  target?: ReminderTarget;
}

interface SourceCommon {
  /** Stable id: `app:<feature>` for app features, `ext:<extensionId>` for extensions. */
  id: string;
  /** Display name, already localized by the host. */
  label: string;
  description?: string;
  /** Whether the source is on when the user has not chosen. Default false (opt-in). */
  defaultEnabled?: boolean;
  /** Clicked notification of this source. */
  onActivated?(activation: ReminderActivation): void;
  /** Reminders shown collapsed or dropped as too old (item sources only). */
  onMissed?(event: { sourceId: string; summarized: string[]; dropped: string[] }): void;
}

export interface RuleSource extends SourceCommon {
  kind: 'rules';
  /** The source's own plan (null: nothing to schedule now). The user's plan in settings wins. */
  plan(): ReminderPlan | null;
  /** May the user replace the plan in settings? Default true. */
  userEditable?: boolean;
  /** Content for a fire, bound at fire time. Null skips it. */
  render(ctx: FireContext): NotificationContent | null | Promise<NotificationContent | null>;
}

export interface ItemSource extends SourceCommon {
  kind: 'items';
  /** Optional content for a collapsed notification (else {@link ReminderStrings.collapsed}). */
  collapse?(items: ReminderItem[]): NotificationContent | null;
  /** Click target for this source's items (e.g. the extension). */
  target?: ReminderTarget;
}

export type ReminderSource = RuleSource | ItemSource;

/** A source as the settings page sees it. */
export interface ReminderSourceInfo {
  id: string;
  kind: 'rules' | 'items';
  label: string;
  description?: string;
  enabled: boolean;
  defaultEnabled: boolean;
  /** Registered in this run (an item source may be known only from saved state). */
  registered: boolean;
  /** The plan in effect (rule sources). */
  plan: ReminderPlan | null;
  userEditable: boolean;
  /** Next fire, epoch ms, or null. */
  nextAt: number | null;
  /** Pending items (item sources). */
  pending: number;
}

export interface ReminderSchedulerOptions {
  clock?: ReminderClock;
  timer: ReminderTimer;
  presenter: ReminderPresenter;
  state?: ReminderStatePort;
  settings: () => NotificationSettings;
  /** IANA zone; default the platform's. Read on every wake, so a zone change is picked up. */
  timeZone?: () => string;
  strings?: Partial<ReminderStrings>;
  policy?: Partial<MissedPolicy>;
  /** Longest single timer wait; the engine re-checks at least this often. Default 1 h. */
  guardMs?: number;
  /** Called after any change to sources, items or schedule (settings pages refresh on it). */
  onChange?: () => void;
  /** Errors from sources and ports (the engine itself carries on). */
  onError?: (err: unknown, context: string) => void;
}

const DEFAULT_STRINGS: ReminderStrings = {
  collapsed: (label, count) => ({ title: label, body: `${count} reminders waiting` }),
};

function jsonBytes(v: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(v)).length;
  } catch {
    return Infinity;
  }
}

/** Clean and cap an item source's list: valid items only, unique keys, earliest first. */
export function sanitizeReminderItems(items: unknown, now: number): ReminderItem[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: ReminderItem[] = [];
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.key !== 'string' || r.key === '' || r.key.length > REMINDER_LIMITS.keyChars || seen.has(r.key)) continue;
    if (typeof r.fireAt !== 'number' || !Number.isFinite(r.fireAt)) continue;
    if (typeof r.title !== 'string' || typeof r.body !== 'string') continue;
    if (r.fireAt < now - DAY) continue; // long past: nothing to fire
    const item: ReminderItem = {
      key: r.key,
      fireAt: Math.floor(r.fireAt),
      title: r.title.slice(0, REMINDER_LIMITS.titleChars),
      body: r.body.slice(0, REMINDER_LIMITS.bodyChars),
    };
    if (typeof r.tag === 'string' && r.tag !== '') item.tag = r.tag.slice(0, 100);
    if (r.data !== undefined) {
      if (jsonBytes(r.data) > REMINDER_LIMITS.dataBytes) continue;
      item.data = JSON.parse(JSON.stringify(r.data)) as JsonValue;
    }
    seen.add(item.key);
    out.push(item);
  }
  out.sort((a, b) => a.fireAt - b.fireAt);
  return out.slice(0, REMINDER_LIMITS.itemsPerSource);
}

const fireKey = (f: FireTime) => `${f.slotId}@${f.at}`;

export class ReminderScheduler {
  private readonly clock: ReminderClock;
  private readonly policy: MissedPolicy;
  private readonly strings: ReminderStrings;
  private readonly guardMs: number;
  private readonly sources = new Map<string, ReminderSource>();
  private state: ReminderState = { version: 1, checkpoints: {}, items: {}, labels: {} };
  private started = false;
  private waking: Promise<void> | null = null;
  private wakeAgain = false;
  private presented = new Map<string, PresentedNotification>();
  private seq = 0;

  constructor(private readonly opts: ReminderSchedulerOptions) {
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.policy = { ...DEFAULT_MISSED_POLICY, ...opts.policy };
    this.strings = { ...DEFAULT_STRINGS, ...opts.strings };
    this.guardMs = opts.guardMs ?? HOUR;
  }

  // --- lifecycle ------------------------------------------------------------

  /** Load saved state, then handle anything due while the app was not running. */
  async start(): Promise<void> {
    if (this.started) return;
    try {
      const loaded = await this.opts.state?.load();
      if (loaded && loaded.version === 1) {
        // Sources registered before start keep their labels; saved checkpoints win.
        this.state = {
          version: 1,
          checkpoints: { ...this.state.checkpoints, ...(loaded.checkpoints ?? {}) },
          items: {},
          labels: { ...(loaded.labels ?? {}), ...this.state.labels },
        };
        for (const [id, list] of Object.entries(loaded.items ?? {})) {
          const clean = sanitizeReminderItems(list, this.clock.now());
          if (clean.length) this.state.items[id] = clean;
        }
      }
    } catch (err) {
      this.report(err, 'state.load');
    }
    this.started = true;
    await this.wake();
  }

  /** Stop the timer (the host is quitting). State is already saved. */
  stop(): void {
    this.started = false;
    this.opts.timer.clear();
  }

  // --- sources ----------------------------------------------------------------

  /**
   * Register a source. A rule source's checkpoint survives restarts, so fires
   * missed while the app was closed are found when it registers again.
   * Returns an unregister function.
   */
  registerSource(source: ReminderSource): () => void {
    this.sources.set(source.id, source);
    if (source.kind === 'items') this.state.labels[source.id] = source.label;
    if (this.state.checkpoints[source.id] === undefined) this.state.checkpoints[source.id] = this.clock.now();
    this.poke();
    return () => {
      if (this.sources.get(source.id) === source) {
        this.sources.delete(source.id);
        this.poke();
      }
    };
  }

  /**
   * Replace an item source's pending set (idempotent). Returns how many were
   * kept after validation and the per-source cap. The source need not be
   * registered (an extension that is not running keeps its reminders).
   */
  async replaceItems(sourceId: string, items: unknown, label?: string): Promise<{ accepted: number }> {
    const clean = sanitizeReminderItems(items, this.clock.now());
    if (clean.length) this.state.items[sourceId] = clean;
    else delete this.state.items[sourceId];
    if (label) this.state.labels[sourceId] = label;
    if (this.state.checkpoints[sourceId] === undefined) this.state.checkpoints[sourceId] = this.clock.now();
    await this.wake();
    return { accepted: clean.length };
  }

  /** Pending items of an item source (a copy). */
  listItems(sourceId: string): ReminderItem[] {
    return (this.state.items[sourceId] ?? []).map((i) => ({ ...i }));
  }

  /** Forget everything about a source (an extension was uninstalled). */
  async forgetSource(sourceId: string): Promise<void> {
    delete this.state.items[sourceId];
    delete this.state.labels[sourceId];
    delete this.state.checkpoints[sourceId];
    this.sources.delete(sourceId);
    await this.wake();
  }

  /** Re-read plans and settings (call after a source's plan or the settings change). */
  refresh(): Promise<void> {
    return this.wake();
  }

  // --- queries ----------------------------------------------------------------

  /**
   * A source's default on/off: its own `defaultEnabled`, else off for rule
   * sources (app features are opt-in) and on for item sources (an extension
   * was granted `notifications:schedule` at install and has its own switch).
   */
  defaultEnabled(sourceId: string): boolean {
    const s = this.sources.get(sourceId);
    return s?.defaultEnabled ?? (s?.kind !== 'rules');
  }

  timeZone(): string {
    try {
      return this.opts.timeZone?.() || systemTimeZone();
    } catch {
      return systemTimeZone();
    }
  }

  private settings(): NotificationSettings {
    try {
      return normalizeNotificationSettings(this.opts.settings());
    } catch (err) {
      this.report(err, 'settings');
      return normalizeNotificationSettings(null);
    }
  }

  /** The plan in effect for a rule source: the user's (if editable) else the source's own. */
  effectivePlan(source: RuleSource, settings = this.settings()): ReminderPlan | null {
    const user = source.userEditable === false ? undefined : settings.sources[source.id]?.plan;
    if (user) return user;
    try {
      return source.plan();
    } catch (err) {
      this.report(err, `plan:${source.id}`);
      return null;
    }
  }

  /** Every source the settings page should list, registered or only remembered. */
  listSources(): ReminderSourceInfo[] {
    const settings = this.settings();
    const tz = this.timeZone();
    const now = this.clock.now();
    const out: ReminderSourceInfo[] = [];
    const ids = new Set<string>([...this.sources.keys(), ...Object.keys(this.state.items), ...Object.keys(this.state.labels)]);
    for (const id of ids) {
      const s = this.sources.get(id);
      const def = this.defaultEnabled(id);
      const enabled = isSourceEnabled(settings, id, def);
      if (s?.kind === 'rules') {
        const plan = this.effectivePlan(s, settings);
        const next = plan ? expandPlan(plan, now + 1, 8 * DAY, tz, { seed: id })[0] : undefined;
        out.push({
          id, kind: 'rules', label: s.label, description: s.description, enabled, defaultEnabled: def,
          registered: true, plan, userEditable: s.userEditable !== false, nextAt: enabled && next ? next.at : null, pending: 0,
        });
      } else {
        const items = this.state.items[id] ?? [];
        const next = items.find((i) => i.fireAt > now);
        out.push({
          id, kind: 'items', label: s?.label ?? this.state.labels[id] ?? id, description: s?.description, enabled,
          defaultEnabled: def, registered: !!s, plan: null, userEditable: false,
          nextAt: enabled && next ? next.fireAt : null, pending: items.length,
        });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** The earliest upcoming fire across enabled sources, or null. */
  nextDue(): { sourceId: string; at: number } | null {
    const settings = this.settings();
    const tz = this.timeZone();
    const now = this.clock.now();
    let best: { sourceId: string; at: number } | null = null;
    const consider = (sourceId: string, at: number) => {
      if (!best || at < best.at) best = { sourceId, at };
    };
    for (const s of this.sources.values()) {
      if (s.kind !== 'rules' || !isSourceEnabled(settings, s.id, s.defaultEnabled ?? false)) continue;
      const plan = this.effectivePlan(s, settings);
      const f = plan ? expandPlan(plan, now + 1, 8 * DAY, tz, { seed: s.id })[0] : undefined;
      if (f) consider(s.id, f.at);
    }
    for (const [id, items] of Object.entries(this.state.items)) {
      if (!isSourceEnabled(settings, id, this.defaultEnabled(id))) continue;
      const i = items.find((x) => x.fireAt > now);
      if (i) consider(id, i.fireAt);
    }
    return best;
  }

  // --- clicks -----------------------------------------------------------------

  /**
   * The user clicked a notification. Tells the source and returns what the
   * host should open (null for an unknown or expired id).
   */
  activate(presentedId: string): ReminderActivation | null {
    const p = this.presented.get(presentedId);
    if (!p) return null;
    this.presented.delete(presentedId);
    const activation: ReminderActivation = {
      sourceId: p.sourceId, keys: p.keys, data: p.data, dueAt: p.dueAt, activatedAt: this.clock.now(), target: p.target,
    };
    try {
      this.sources.get(p.sourceId)?.onActivated?.(activation);
    } catch (err) {
      this.report(err, `activate:${p.sourceId}`);
    }
    return activation;
  }

  /** Show a notification now, outside any schedule (the "Send a test notification" button). */
  async presentNow(sourceId: string, content: NotificationContent): Promise<void> {
    await this.present({ ...content, sourceId, keys: [], dueAt: this.clock.now(), missed: false, count: 1 });
  }

  // --- the engine -------------------------------------------------------------

  /** Look at what is due and re-arm. Safe to call any time, any number of times. */
  wake(): Promise<void> {
    if (!this.started) return Promise.resolve();
    if (this.waking) {
      this.wakeAgain = true;
      return this.waking;
    }
    this.waking = (async () => {
      try {
        do {
          this.wakeAgain = false;
          await this.runOnce();
        } while (this.wakeAgain && this.started);
      } finally {
        this.waking = null;
      }
    })();
    return this.waking;
  }

  private poke(): void {
    if (this.started) void this.wake();
  }

  private async runOnce(): Promise<void> {
    const now = this.clock.now();
    const tz = this.timeZone();
    const settings = this.settings();

    // A clock that jumped far back (a wrong date corrected) must not mute
    // reminders until the old date comes round again.
    for (const [id, cp] of Object.entries(this.state.checkpoints)) {
      if (cp > now + DAY) this.state.checkpoints[id] = now;
    }

    const quietNow = settings.enabled && isInQuietHours(now, settings.quiet ?? undefined, tz);
    if (!quietNow) {
      for (const s of this.sources.values()) if (s.kind === 'rules') await this.runRuleSource(s, now, tz, settings);
      for (const id of Object.keys(this.state.items)) await this.runItemSource(id, now, settings);
    }

    await this.persist();
    this.arm(now, tz, settings, quietNow);
    this.changed();
  }

  private async runRuleSource(s: RuleSource, now: number, tz: string, settings: NotificationSettings): Promise<void> {
    const since = this.state.checkpoints[s.id] ?? now;
    this.state.checkpoints[s.id] = Math.max(since, now);
    if (!isSourceEnabled(settings, s.id, s.defaultEnabled ?? false)) return;
    const plan = this.effectivePlan(s, settings);
    if (!plan) return;
    const fires = firesBetween(plan, since, now, tz, { seed: s.id });
    if (!fires.length) return;
    const r = reconcileMissed(fires.map((f) => ({ ...f, fireAt: f.at })), now, this.policy);
    // On-time fires each get their own notification; late ones collapse into the latest.
    for (const f of r.onTime) await this.renderAndPresent(s, f, false, 1, tz);
    if (r.summarize.length) {
      const latest = r.summarize[r.summarize.length - 1];
      await this.renderAndPresent(s, latest, true, r.summarize.length, tz, r.summarize.map(fireKey));
    }
  }

  private async renderAndPresent(
    s: RuleSource, fire: FireTime, missed: boolean, count: number, tz: string, keys = [fireKey(fire)],
  ): Promise<void> {
    let content: NotificationContent | null = null;
    try {
      content = await s.render({ sourceId: s.id, fire, missed, count, timeZone: tz });
    } catch (err) {
      this.report(err, `render:${s.id}`);
    }
    if (content) await this.present({ ...content, sourceId: s.id, keys, dueAt: fire.at, missed, count });
  }

  private async runItemSource(id: string, now: number, settings: NotificationSettings): Promise<void> {
    const items = this.state.items[id] ?? [];
    const due = items.filter((i) => i.fireAt <= now);
    if (!due.length) return;
    const rest = items.filter((i) => i.fireAt > now);
    if (rest.length) this.state.items[id] = rest;
    else delete this.state.items[id];
    this.state.checkpoints[id] = Math.max(this.state.checkpoints[id] ?? now, now);

    const s = this.sources.get(id);
    const source = s?.kind === 'items' ? s : undefined;
    if (!isSourceEnabled(settings, id, this.defaultEnabled(id))) return;

    const r = reconcileMissed(due, now, this.policy);
    const target = source?.target ?? (id.startsWith('ext:') ? { kind: 'extension' as const, extensionId: id.slice(4) } : undefined);
    for (const i of r.onTime) {
      await this.present({
        title: i.title, body: i.body, tag: i.tag, target, sourceId: id, keys: [i.key], dueAt: i.fireAt,
        missed: false, count: 1, data: i.data,
      });
    }
    if (r.summarize.length === 1) {
      const i = r.summarize[0];
      await this.present({
        title: i.title, body: i.body, tag: i.tag, target, sourceId: id, keys: [i.key], dueAt: i.fireAt,
        missed: true, count: 1, data: i.data,
      });
    } else if (r.summarize.length > 1) {
      const label = source?.label ?? this.state.labels[id] ?? id;
      let content: NotificationContent | null = null;
      try {
        content = source?.collapse?.(r.summarize) ?? null;
      } catch (err) {
        this.report(err, `collapse:${id}`);
      }
      const c = content ?? { ...this.strings.collapsed(label, r.summarize.length), target };
      await this.present({
        ...c, target: c.target ?? target, sourceId: id, keys: r.summarize.map((i) => i.key),
        dueAt: r.summarize[r.summarize.length - 1].fireAt, missed: true, count: r.summarize.length,
      });
    }
    if (r.summarize.length || r.drop.length) {
      try {
        source?.onMissed?.({ sourceId: id, summarized: r.summarize.map((i) => i.key), dropped: r.drop.map((i) => i.key) });
      } catch (err) {
        this.report(err, `missed:${id}`);
      }
    }
  }

  private async present(n: Omit<PresentedNotification, 'id'>): Promise<void> {
    const p: PresentedNotification = { ...n, id: `r${this.clock.now().toString(36)}-${++this.seq}` };
    this.presented.set(p.id, p);
    // Keep the click map bounded: notifications older than the last 100 are gone from the OS anyway.
    if (this.presented.size > 100) this.presented.delete(this.presented.keys().next().value as string);
    try {
      await this.opts.presenter.show(p);
    } catch (err) {
      this.report(err, `present:${n.sourceId}`);
    }
  }

  private arm(now: number, tz: string, settings: NotificationSettings, quietNow: boolean): void {
    if (!this.started) return;
    let at = now + this.guardMs;
    if (quietNow) {
      at = Math.min(at, endOfQuietHours(now, settings.quiet ?? undefined, tz));
    } else {
      const next = this.nextDue();
      if (next) at = Math.min(at, next.at);
    }
    this.opts.timer.set(Math.max(0, at - now), () => void this.wake());
  }

  private async persist(): Promise<void> {
    if (!this.opts.state) return;
    try {
      await this.opts.state.save(JSON.parse(JSON.stringify(this.state)) as ReminderState);
    } catch (err) {
      this.report(err, 'state.save');
    }
  }

  private changed(): void {
    try {
      this.opts.onChange?.();
    } catch (err) {
      this.report(err, 'onChange');
    }
  }

  private report(err: unknown, context: string): void {
    try {
      this.opts.onError?.(err, context);
    } catch {
      /* never let reporting break the engine */
    }
  }
}
