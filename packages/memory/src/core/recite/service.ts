/**
 * ReciteService: what main.ts calls. Owns the active loop, builds its
 * dependencies from injected store/speech/host functions, and keeps the
 * recite settings. No runtime import of the '@bible/core' root.
 */

import { tc } from '../messages';
import { kitFor } from '@bible/core/recite';
import type { ISpeechApi } from '@bible/core/speech';
import type {
  Card,
  Passage,
  ReciteAction,
  ReciteSettings,
  ReciteStateView,
  Rung,
  Scope,
  SpeechAvailability,
  VerseText,
} from '../types';
import type { ReciteDetailInput } from '../store';
import { BIAS_LEVEL, DEFAULT_RECITE_SETTINGS, SETTING_RECITE } from './config';
import { HandsFreeLoop } from './handsFreeLoop';
import type { LoopCard, LoopDeps } from './handsFreeLoop';
import { spokenReference } from './spokenReference';
import { probeSpeech, unavailableMessage } from './speechAvailability';

export interface RecordAndScheduleArgs {
  cardId: number;
  passageId: number;
  rung: Rung;
  tier: number;
  score: number;
  correctFirst: number;
  totalSteps: number;
  startedAt: number;
}

export interface RecordAndScheduleResult {
  attemptId: number;
  level: number;
  nextDueAt: number | null;
  passageWellLearned: boolean;
}

/** The slice of MemoryStore the service uses, as functions, so tests can fake it. */
export interface ReciteStoreAdapter {
  getPassage(id: number): Promise<Passage | undefined>;
  getCard(passageId: number, rung: Rung): Promise<Card | undefined>;
  getScope(): Promise<Scope>;
  nextDueRecite(scope: Scope, now: number, exclude: number[]): Promise<{ card: Card; passage: Passage } | undefined>;
  reciteDueCount(scope: Scope, now: number): Promise<number>;
  recordReciteDetail(attemptId: number, cardId: number, at: number, detail: ReciteDetailInput): Promise<void>;
  deleteReciteHistory(): Promise<void>;
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
}

export interface ReciteServiceOptions {
  store: ReciteStoreAdapter;
  /** `api.speech`, or undefined on an old host. */
  speech: ISpeechApi | undefined;
  now(): number;
  rng(): number;
  /** Language tag of a Bible module (by abbreviation); undefined when unknown. */
  bibleModuleLanguage(moduleId: string): Promise<string | undefined>;
  /** The passage's verses as the panel shows them. */
  loadVerses(passage: Passage): Promise<VerseText[]>;
  /** Display book names, for spoken references ("1 John"). */
  bookNames?(): string[];
  /** Words around the passage (recogniser bias; names only). */
  contextWords?(passage: Passage): Promise<string[]>;
  /** Shared with Session: record the attempt and reschedule the card. */
  recordAndSchedule(a: RecordAndScheduleArgs): Promise<RecordAndScheduleResult>;
  /** Push a state to the panel (fire-and-forget). */
  push(state: ReciteStateView): void;
}

export type ReciteStartRequest = {
  source: { kind: 'passage'; passageId: number } | { kind: 'due' };
  mode: 'tap' | 'handsfree';
};

const STRICTNESS = ['lenient', 'normal', 'strict'] as const;

export function parseReciteSettings(raw: string | undefined): ReciteSettings {
  const out: ReciteSettings = { ...DEFAULT_RECITE_SETTINGS };
  if (!raw) return out;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof o !== 'object' || o === null) return out;
  return sanitize(out, o as Record<string, unknown>);
}

function sanitize(base: ReciteSettings, p: Record<string, unknown>): ReciteSettings {
  const s = { ...base };
  if ((STRICTNESS as readonly unknown[]).includes(p.strictness)) s.strictness = p.strictness as ReciteSettings['strictness'];
  if (p.promptStyle === 'reference' || p.promptStyle === 'reference+opening') s.promptStyle = p.promptStyle;
  if (p.feedback === 'brief' || p.feedback === 'full') s.feedback = p.feedback;
  if (typeof p.readBack === 'boolean') s.readBack = p.readBack;
  if (typeof p.autoAdvance === 'boolean') s.autoAdvance = p.autoAdvance;
  if (typeof p.voiceCommands === 'boolean') s.voiceCommands = p.voiceCommands;
  if (typeof p.hintDelayMs === 'number' && Number.isFinite(p.hintDelayMs)) {
    s.hintDelayMs = Math.min(30000, Math.max(2000, Math.round(p.hintDelayMs)));
  }
  return s;
}

export class ReciteService {
  private loop: HandsFreeLoop | null = null;
  private last: ReciteStateView | null = null;
  private counter = 0;
  private settingsCache: ReciteSettings = { ...DEFAULT_RECITE_SETTINGS };

  constructor(private readonly o: ReciteServiceOptions) {}

  // -- availability -------------------------------------------------------------

  probe(force = false): Promise<SpeechAvailability> {
    return probeSpeech({ speech: this.o.speech }, this.o.now(), { force });
  }

  // -- settings -----------------------------------------------------------------

  async getSettings(): Promise<ReciteSettings> {
    this.settingsCache = parseReciteSettings(await this.o.store.getSetting(SETTING_RECITE));
    return { ...this.settingsCache };
  }

  async setSettings(patch: Partial<ReciteSettings>): Promise<ReciteSettings> {
    const next = sanitize(await this.getSettings(), patch as Record<string, unknown>);
    await this.o.store.setSetting(SETTING_RECITE, JSON.stringify(next));
    this.settingsCache = next;
    return { ...next };
  }

  async deleteHistory(): Promise<void> {
    await this.o.store.deleteReciteHistory();
  }

  // -- loop ---------------------------------------------------------------------

  get(): ReciteStateView | null {
    return this.loop ? this.loop.view() : this.last;
  }

  async start(req: ReciteStartRequest): Promise<ReciteStateView> {
    const active = this.loop;
    if (active) {
      const v = active.view();
      const finished = v.phase === 'done' || v.phase === 'error' || v.phase === 'summary';
      const replaceable = finished || (v.phase === 'paused' && req.mode === 'tap' && req.source.kind === 'passage');
      if (!replaceable) return v;
      await this.stopLoop();
    }

    const avail = await this.probe();
    if (avail.state !== 'ready') throw new Error(unavailableMessage(avail));
    const speech = this.o.speech as ISpeechApi;
    if (req.mode === 'handsfree' && !avail.handsFree) {
      throw new Error(tc('memory.core.handsFreeNeedsSpeak', 'Hands-free recitation needs the app to be able to speak, which is not available right now.'));
    }
    await this.getSettings();

    let first: Passage | undefined;
    if (req.source.kind === 'passage') {
      first = await this.o.store.getPassage(req.source.passageId);
      if (!first) throw new Error(tc('memory.core.passageGone', 'That passage is no longer in your plan.'));
      if (kitFor(await this.languageOf(first)) === null) {
        throw new Error(unavailableMessage({ ...avail, state: 'unsupported-language' }));
      }
    }

    const reciteId = `recite-${++this.counter}`;
    const store = this.o.store;
    const source = req.source;
    const deps: LoopDeps = {
      reciteId,
      speech,
      now: this.o.now,
      kitFor,
      biasLevel: BIAS_LEVEL,
      rng: this.o.rng,
      settings: () => this.settingsCache,
      mode: req.mode,
      source: source.kind,
      nextCard: async (exclude) => {
        if (source.kind === 'passage') {
          if (exclude.includes(source.passageId)) return null;
          const p = await store.getPassage(source.passageId);
          if (!p) return null;
          const card = await store.getCard(p.id, 'recite');
          return card ? this.toLoopCard(card, p, 0) : null;
        }
        const scope = await store.getScope();
        const now = this.o.now();
        const hit = await store.nextDueRecite(scope, now, exclude);
        if (!hit) return null;
        const due = await store.reciteDueCount(scope, now);
        // `due` still counts excluded passages that remain due (skipped ones); count only those.
        let excludedDue = 0;
        for (const id of exclude) {
          const c = await store.getCard(id, 'recite');
          if (c && (c.dueAt === null || c.dueAt <= now)) excludedDue++;
        }
        return this.toLoopCard(hit.card, hit.passage, Math.max(0, due - excludedDue - 1));
      },
      record: async (card, g, startedAt) => {
        const rec = await this.o.recordAndSchedule({
          cardId: card.cardId,
          passageId: card.passageId,
          rung: 'recite',
          tier: 0,
          score: g.attempt.score,
          correctFirst: g.attempt.correctFirst,
          totalSteps: g.attempt.totalSteps,
          startedAt,
        });
        try {
          await store.recordReciteDetail(rec.attemptId, card.cardId, this.o.now(), g.detail);
        } catch {
          /* the attempt and schedule are already saved; per-word detail is a nicety */
        }
        return { level: rec.level, nextDueAt: rec.nextDueAt, passageWellLearned: rec.passageWellLearned };
      },
      emit: (s) => {
        this.last = this.sanitized(s);
        this.o.push(s);
      },
    };

    const loop = new HandsFreeLoop(deps);
    this.loop = loop;
    loop.start();
    return loop.view();
  }

  control(req: { reciteId: string; action: ReciteAction }): ReciteStateView {
    const loop = this.loop;
    if (!loop) throw new Error(tc('memory.core.reciteEnded', 'That recitation has ended.'));
    if (loop.view().reciteId !== req.reciteId) return loop.view();
    return loop.control(req.action);
  }

  async dispose(): Promise<void> {
    await this.stopLoop();
  }

  private async stopLoop(): Promise<void> {
    const loop = this.loop;
    this.loop = null;
    if (loop) {
      this.last = this.sanitized(loop.view());
      await loop.dispose();
    }
  }

  /** Privacy: a finished or failed run keeps no heard words or per-word result. */
  private sanitized(s: ReciteStateView): ReciteStateView {
    if (s.phase !== 'done' && s.phase !== 'error' && s.phase !== 'summary') return s;
    return { ...s, heard: [], result: null, verses: null };
  }

  private async languageOf(passage: Passage): Promise<string> {
    // 'und' (undetermined) has no kit, so an unknown module is unsupported rather than English.
    return (await this.o.bibleModuleLanguage(passage.moduleId)) ?? 'und';
  }

  private async toLoopCard(card: Card, passage: Passage, remaining: number): Promise<LoopCard> {
    const language = await this.languageOf(passage);
    const verses = await this.o.loadVerses(passage);
    const context = this.o.contextWords ? await this.o.contextWords(passage) : [];
    return {
      cardId: card.id,
      passageId: passage.id,
      reference: passage.reference,
      spokenReference: spokenReference(passage, this.o.bookNames ? this.o.bookNames() : []),
      language,
      verses,
      contextWords: context,
      remaining,
    };
  }
}
