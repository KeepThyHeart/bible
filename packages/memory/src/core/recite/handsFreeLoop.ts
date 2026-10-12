/**
 * The recite loop: a pure state machine with injected dependencies.
 *
 * One driver promise (`run`) does all the awaiting. Controls (`control()`,
 * `dispose()`) never start a second driver: they change `step` synchronously,
 * bump `gen`, and cancel speech or listening. Every await in the driver is
 * followed by a `gen` check, so a stale `speak` / `nextUtterance` result is
 * dropped and the driver re-dispatches on the new `step`.
 *
 * Privacy: heard words live only in memory (`cursor.heard`, the view's
 * `heard`, the result's `heard` fields). Nothing here logs, and nothing heard
 * is written to a message, a spoken prompt or the graded `detail`.
 */

import { tc } from '../messages';
import { ReciteCursor, biasFor } from '@bible/core/recite';
import type { BiasLevel, ILanguageKit, LoopCommand, RecognizedWord } from '@bible/core/recite';
import type { ISpeechApi } from '@bible/core/speech';
import type {
  LoopPhase,
  ReciteAction,
  ReciteResultView,
  ReciteSettings,
  ReciteStateView,
  VerseText,
} from '../types';
import { LOOP } from './config';
import { expectedFor, gradeRecitation, stripPunctuation } from './grade';
import type { GradedRecitation } from './grade';

export interface LoopCard {
  cardId: number;
  passageId: number;
  reference: string;
  /** What is read aloud, e.g. "John chapter 3, verses 16 to 18". */
  spokenReference: string;
  /** BCP-47 language of the passage's module. */
  language: string;
  verses: VerseText[];
  /** Words around the passage, for recogniser bias (names only). */
  contextWords: string[];
  /** Passages still to come after this one. */
  remaining: number;
}

export interface LoopRecorded {
  level: number;
  nextDueAt: number | null;
  passageWellLearned: boolean;
}

export interface LoopDeps {
  reciteId: string;
  speech: ISpeechApi;
  now(): number;
  /** The language kit, or null when the language has none (the card is skipped). */
  kitFor(language: string): ILanguageKit | null;
  biasLevel: BiasLevel;
  rng(): number;
  settings(): ReciteSettings;
  mode: 'tap' | 'handsfree';
  source: 'passage' | 'due';
  nextCard(exclude: number[]): Promise<LoopCard | null>;
  record(card: LoopCard, g: GradedRecitation, startedAt: number): Promise<LoopRecorded>;
  emit(s: ReciteStateView): void;
}

type Step =
  | 'fetch'
  | 'announce'
  | 'ready'
  | 'listen'
  | 'score'
  | 'feedback'
  | 'paused'
  | 'summary'
  | 'end';

const NO_PLAN = /no longer in your plan/i;
const passageGoneText = (): string => tc('memory.core.passageGone', 'That passage is no longer in your plan.');

const COMMAND_ACTION: Partial<Record<LoopCommand, ReciteAction>> = {
  repeat: 'repeat',
  skip: 'skip',
  again: 'again',
  stop: 'stop',
  resume: 'resume',
  pause: 'pause',
};

function errorText(code: string): string | undefined {
  switch (code) {
    case 'mic-denied':
      return tc('memory.core.micDenied', 'The microphone is blocked. Allow microphone access and try again.');
    case 'mic-busy':
      return tc('memory.core.micBusy', 'The microphone is in use by another app.');
    case 'engine':
      return tc('memory.core.speechEngineFailed', 'Speech recognition stopped working. Try again.');
    case 'not-ready':
      return tc('memory.core.speechNotReady', 'Speech recognition is not ready yet. Check the speech settings.');
    default:
      return undefined;
  }
}

export class HandsFreeLoop {
  private gen = 0;
  private run: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private step: Step = 'fetch';

  private phase: LoopPhase;
  private message = '';
  /** A note that survives the next phase changes (e.g. a card was removed), until scoring or listening. */
  private notice = '';
  private error: { code: string; message: string } | null = null;

  private card: LoopCard | null = null;
  private kit: ILanguageKit | null = null;
  private words: string[] = [];
  private cursor: ReciteCursor | null = null;
  private hinted = new Set<number>();
  private heardTexts: string[] = [];
  private result: ReciteResultView | null = null;
  private startedAt = 0;
  private lastLanguage = 'en';
  private engineId: string | null = null;
  private modelId: string | null = null;

  private listenId: string | null = null;
  private hintReq = 0;
  /** A repeat asked for while a listen is open: spoken after the in-flight utterance returns. */
  private repeatReq = false;
  private hintCount = 0;
  private stall = 0;
  private noSpeech = 0;
  private lostCount = 0;
  private feedbackSpoken = false;

  private readonly exclude: number[] = [];
  private done = 0;
  private skipped = 0;
  private scoreSum = 0;

  constructor(private readonly deps: LoopDeps) {
    this.phase = 'announcing';
  }

  // -- public -------------------------------------------------------------------

  start(): void {
    if (this.run) return;
    this.message = tc('memory.core.loopGettingReady', 'Getting ready');
    this.run = this.drive();
  }

  view(): ReciteStateView {
    const c = this.card;
    return {
      reciteId: this.deps.reciteId,
      mode: this.deps.mode,
      source: this.deps.source,
      phase: this.phase,
      passageId: c ? c.passageId : null,
      reference: c ? c.reference : '',
      verses: c && this.result ? c.verses : null,
      heard: this.heardTexts.slice(),
      position: this.cursor ? this.cursor.position : -1,
      hinted: Array.from(this.hinted).sort((a, b) => a - b),
      result: this.result,
      done: this.done,
      remaining: c ? c.remaining : 0,
      message: this.message,
      error: this.error,
    };
  }

  /** Apply a user action. Synchronous: the driver reacts on its own. */
  control(action: ReciteAction): ReciteStateView {
    this.act(action);
    return this.view();
  }

  async dispose(): Promise<void> {
    this.step = 'end';
    this.gen++;
    this.wakeUp();
    this.deps.speech.cancel().catch(() => undefined);
    if (this.run) await this.run;
    await this.closeListen();
  }

  // -- controls -----------------------------------------------------------------

  private act(a: ReciteAction): void {
    if (this.step === 'end') return;
    const s = this.step;
    const handsFree = this.deps.mode === 'handsfree';
    switch (a) {
      case 'listen': {
        if (s === 'ready') {
          this.step = 'listen';
          this.interrupt();
        } else if (s === 'paused') {
          this.resume();
        } else if (s === 'listen' && !handsFree && this.heardTexts.length > 0) {
          this.step = 'score';
          this.interrupt();
        }
        return;
      }
      case 'hint': {
        if (s === 'listen' || s === 'ready' || s === 'announce') {
          this.hintReq = this.ladder();
          // Mid-listen: keep the session open; the driver speaks it after the
          // in-flight utterance returns, so nothing the user said is dropped.
          if (s === 'ready') this.interrupt();
        }
        return;
      }
      case 'repeat': {
        if (s === 'feedback') {
          this.feedbackSpoken = false;
          this.interrupt();
        } else if (handsFree && s === 'listen') {
          this.repeatReq = true;
        } else if (handsFree && (s === 'announce' || s === 'ready')) {
          this.step = 'announce';
          this.interrupt();
        }
        return;
      }
      case 'skip': {
        if (s === 'feedback') {
          this.step = 'fetch';
          this.interrupt();
        } else if (this.card && (s === 'announce' || s === 'ready' || s === 'listen' || s === 'paused')) {
          this.exclude.push(this.card.passageId);
          this.skipped++;
          this.clearCard();
          this.step = 'fetch';
          this.interrupt();
        }
        return;
      }
      case 'again': {
        if (this.card && (s === 'announce' || s === 'ready' || s === 'listen' || s === 'feedback' || s === 'paused')) {
          this.resetCard();
          this.step = handsFree ? 'announce' : 'ready';
          this.interrupt();
        }
        return;
      }
      case 'next': {
        if (s === 'feedback') {
          this.step = 'fetch';
          this.interrupt();
        }
        return;
      }
      case 'pause': {
        if (s === 'announce' || s === 'ready' || s === 'listen' || s === 'feedback' || s === 'fetch') {
          this.step = 'paused';
          this.setPhase('paused', tc('memory.core.loopPaused', 'Paused'));
          this.interrupt();
        }
        return;
      }
      case 'resume': {
        if (s === 'paused') this.resume();
        return;
      }
      case 'stop': {
        if (s === 'summary') return;
        // Tap-to-talk: Stop while words were heard means "I'm finished speaking";
        // before any word was heard it just cancels the listen.
        if (!handsFree && s === 'listen') {
          this.step = this.heardTexts.length > 0 ? 'score' : 'ready';
          this.interrupt();
          return;
        }
        this.step = 'summary';
        this.setPhase('summary', tc('memory.core.loopFinishingUp', 'Finishing up'));
        this.interrupt();
        return;
      }
    }
  }

  private resume(): void {
    this.noSpeech = 0;
    const handsFree = this.deps.mode === 'handsfree';
    this.step = !this.card || this.result ? 'fetch' : handsFree ? 'announce' : 'listen';
    this.interrupt();
  }

  /** Invalidate whatever the driver is awaiting and make it re-dispatch. */
  private interrupt(): void {
    this.gen++;
    void this.closeListen();
    this.deps.speech.cancel().catch(() => undefined);
    this.wakeUp();
  }

  private wakeUp(): void {
    const w = this.wake;
    this.wake = null;
    if (w) w();
  }

  private ladder(): number {
    const n = this.hintCount === 0 ? 1 : LOOP.hintWordsLater;
    this.hintCount++;
    return n;
  }

  // -- driver -------------------------------------------------------------------

  private async drive(): Promise<void> {
    try {
      while (this.step !== 'end') {
        const gen = this.gen;
        switch (this.step) {
          case 'fetch':
            await this.doFetch(gen);
            break;
          case 'announce':
            await this.doAnnounce(gen);
            break;
          case 'ready':
            await this.doReady(gen);
            break;
          case 'listen':
            await this.doListen(gen);
            break;
          case 'score':
            await this.doScore(gen);
            break;
          case 'feedback':
            await this.doFeedback(gen);
            break;
          case 'paused':
            this.setPhase('paused', tc('memory.core.loopPaused', 'Paused'));
            await this.waitWake(gen);
            break;
          case 'summary':
            await this.doSummary(gen);
            break;
        }
      }
    } catch (err) {
      this.fail('internal', err instanceof Error ? err.message : tc('memory.core.somethingWentWrong', 'Something went wrong.'));
    } finally {
      await this.closeListen();
    }
  }

  private stale(gen: number): boolean {
    return gen !== this.gen;
  }

  private waitWake(gen: number): Promise<void> {
    if (this.stale(gen)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.wake = resolve;
    });
  }

  private async doFetch(gen: number): Promise<void> {
    // Not 'ready': there is no card to talk to yet.
    this.setPhase('announcing', tc('memory.core.loopFindingNext', 'Finding the next passage'));
    const card = await this.deps.nextCard(this.exclude.slice());
    if (this.stale(gen)) return;
    if (!card) {
      this.step = 'summary';
      return;
    }
    const kit = this.deps.kitFor(card.language);
    if (!kit) {
      this.exclude.push(card.passageId);
      this.notice = tc('memory.core.loopSkippedLanguage', 'Skipped a passage in a language that cannot be recited aloud yet.');
      this.message = this.notice;
      this.emitView();
      return;
    }
    this.card = card;
    this.lastLanguage = card.language;
    this.kit = kit;
    this.words = expectedFor(card.verses).words;
    this.resetCard();
    this.step = this.deps.mode === 'handsfree' ? 'announce' : 'ready';
  }

  private async doAnnounce(gen: number): Promise<void> {
    const c = this.card;
    if (!c) {
      this.step = 'fetch';
      return;
    }
    await this.sayPrompt(gen, true);
    if (this.stale(gen)) return;
    await this.earcon('listen');
    if (this.stale(gen)) return;
    this.step = 'listen';
  }

  /** The reference (and opening words, when configured), spoken. */
  private async sayPrompt(gen: number, first: boolean): Promise<void> {
    const c = this.card;
    if (!c) return;
    this.setPhase('announcing', tc('memory.core.loopRecite', 'Recite {reference}', { reference: c.reference }));
    await this.say(c.spokenReference, c.language);
    if (this.stale(gen)) return;
    if (this.deps.settings().promptStyle === 'reference+opening') {
      const idx = this.indexRange(0, LOOP.openingWords);
      if (first) for (const i of idx) this.hinted.add(i);
      await this.say(this.quote(idx), c.language);
    }
  }

  private async doReady(gen: number): Promise<void> {
    this.setPhase('ready', tc('memory.core.loopTapTalk', 'Tap Talk and recite from memory'));
    if (this.hintReq > 0) {
      await this.giveHint(this.hintReq, gen);
      this.hintReq = 0;
      if (this.stale(gen)) return;
      this.setPhase('ready', this.message);
    }
    await this.waitWake(gen);
  }

  private async doListen(gen: number): Promise<void> {
    const c = this.card;
    const cursor = this.cursor;
    if (!c || !cursor || !this.kit) {
      this.step = 'fetch';
      return;
    }
    const speech = this.deps.speech;
    if (this.hintReq > 0) {
      const n = this.hintReq;
      this.hintReq = 0;
      await this.giveHint(n, gen);
      if (this.stale(gen)) return;
    }
    if (this.repeatReq) {
      this.repeatReq = false;
      await this.sayPrompt(gen, false);
      if (this.stale(gen)) return;
      this.setPhase('listening', tc('memory.core.loopListening', 'Listening'));
    }
    if (!this.listenId) {
      this.setPhase('listening', tc('memory.core.loopListening', 'Listening'));
      let id: string;
      try {
        const bias = biasFor(this.words, c.contextWords, this.kit, this.deps.biasLevel, this.deps.rng);
        const maxDurationMs = Math.min(
          LOOP.maxListenCeilingMs,
          LOOP.maxListenBaseMs + LOOP.maxListenPerWordMs * this.words.length,
        );
        id = (await speech.startListening({ language: c.language, bias, maxDurationMs })).listenId;
      } catch (err) {
        if (this.stale(gen)) return;
        this.failListen('not-ready', err);
        return;
      }
      if (this.stale(gen)) {
        await speech.stopListening(id).catch(() => undefined);
        return;
      }
      this.listenId = id;
    }
    const id = this.listenId;
    if (this.phase !== 'listening') this.setPhase('listening', tc('memory.core.loopListening', 'Listening'));
    const noSpeechTimeoutMs =
      cursor.furthest < 0 ? LOOP.noSpeechStartMs : this.deps.settings().hintDelayMs;
    let out;
    try {
      out = await speech.nextUtterance(id, { noSpeechTimeoutMs });
    } catch (err) {
      if (this.stale(gen) || id !== this.listenId) return;
      this.failListen('engine', err);
      return;
    }
    if (this.stale(gen) || id !== this.listenId) return;
    switch (out.kind) {
      case 'speech': {
        this.engineId = out.transcript.engineId;
        this.modelId = out.transcript.modelId;
        const ws =
          out.transcript.words.length > 0
            ? out.transcript.words
            : out.transcript.text
                .split(/\s+/)
                .filter((w) => w !== '')
                .map((w) => ({ text: w }));
        await this.onSpeech(ws, gen);
        return;
      }
      case 'no-speech':
        await this.onNoSpeech(gen);
        return;
      case 'ended':
        if (out.reason === 'max-duration') {
          this.step = 'score';
        } else {
          this.fail('aborted', tc('memory.core.loopInterrupted', 'Listening was interrupted.'));
        }
        return;
      case 'error':
        this.fail(out.code, errorText(out.code) ?? out.message);
        return;
    }
  }

  private async onSpeech(ws: RecognizedWord[], gen: number): Promise<void> {
    const cursor = this.cursor as ReciteCursor;
    const c = this.card as LoopCard;
    const ev = cursor.push(ws, { commands: this.deps.settings().voiceCommands });
    if (ev.kind === 'command') {
      this.onCommand(ev.command);
      return;
    }
    this.heardTexts = cursor.heard.map((w) => w.text);
    this.stall = 0;
    this.noSpeech = 0;
    if (ev.kind === 'lost') this.lostCount++;
    else if (ev.kind !== 'uncertain') this.lostCount = 0;
    if (cursor.isComplete) {
      this.step = 'score';
      this.emitView();
      return;
    }
    this.emitView();
    if (this.lostCount >= LOOP.lostLimit) {
      this.lostCount = 0;
      const idx = this.indexRange(cursor.position + 1, LOOP.pickUpWords);
      if (idx.length > 0) {
        for (const i of idx) this.hinted.add(i);
        const pickUp = tc('memory.core.loopPickUp', 'Let\'s pick up from: {quote}', { quote: this.quote(idx) });
        this.setPhase('hinting', pickUp);
        await this.say(pickUp, c.language);
        if (this.stale(gen)) return;
        this.setPhase('listening', tc('memory.core.loopListening', 'Listening'));
      }
    }
  }

  private onCommand(cmd: LoopCommand): void {
    if (cmd === 'hint' || cmd === 'where') {
      this.act('hint');
      return;
    }
    const a = COMMAND_ACTION[cmd];
    if (a) this.act(a);
  }

  private async onNoSpeech(gen: number): Promise<void> {
    const cursor = this.cursor as ReciteCursor;
    const c = this.card as LoopCard;
    const n = this.words.length;
    if (cursor.furthest < 0) {
      this.noSpeech++;
      if (this.noSpeech === 1) {
        const sayHint = tc('memory.core.loopSayHint', 'Say hint, repeat, or skip.');
        this.message = sayHint;
        this.emitView();
        await this.say(sayHint, c.language);
        return;
      }
      this.act('pause');
      return;
    }
    if (cursor.furthest >= n - LOOP.nearEndWords) {
      this.step = 'score';
      return;
    }
    this.stall++;
    if (this.stall >= 3) {
      this.step = 'score';
      return;
    }
    await this.giveHint(this.stall === 1 ? 1 : LOOP.hintWordsLater, gen);
    if (this.stale(gen)) return;
    this.setPhase('listening', tc('memory.core.loopListening', 'Listening'));
  }

  /** Speak (hands-free) and show the next `n` words after the matched position. */
  private async giveHint(n: number, gen: number): Promise<void> {
    const cursor = this.cursor;
    const c = this.card;
    if (!cursor || !c) return;
    const idx = this.indexRange(cursor.position + 1, n);
    if (idx.length === 0) return;
    for (const i of idx) this.hinted.add(i);
    const text = this.quote(idx);
    const hintText = tc('memory.core.loopHint', 'Hint: {text}', { text });
    this.setPhase('hinting', hintText);
    await this.say(text, c.language);
    if (this.stale(gen)) return;
    this.setPhase('listening', hintText);
  }

  private async doScore(gen: number): Promise<void> {
    const c = this.card;
    const kit = this.kit;
    const cursor = this.cursor;
    if (!c || !kit || !cursor) {
      this.step = 'fetch';
      return;
    }
    this.setPhase('scoring', tc('memory.core.loopScoring', 'Scoring'));
    await this.closeListen();
    if (this.stale(gen)) return;
    const g = gradeRecitation(c.verses, cursor.heard, this.hinted, this.deps.settings().strictness, kit);
    g.detail.engineId = this.engineId;
    g.detail.modelId = this.modelId;
    let rec: LoopRecorded;
    try {
      rec = await this.deps.record(c, g, this.startedAt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : tc('memory.core.recordFailed', 'Could not save that attempt.');
      if (NO_PLAN.test(msg) || msg === passageGoneText()) {
        if (this.stale(gen)) return;
        this.exclude.push(c.passageId);
        this.clearCard();
        this.notice = msg;
        this.message = msg;
        this.step = 'fetch';
        this.emitView();
        return;
      }
      this.fail('record', msg);
      return;
    }
    this.done++;
    this.scoreSum += g.attempt.score;
    this.exclude.push(c.passageId);
    if (this.stale(gen)) return;
    this.result = {
      score: g.attempt.score,
      level: rec.level,
      nextDueAt: rec.nextDueAt,
      words: g.result.words.map((w) =>
        w.heard !== undefined
          ? { index: w.index, verdict: w.verdict, heard: w.heard }
          : { index: w.index, verdict: w.verdict },
      ),
      extras: g.result.extras.map((x) => ({ afterIndex: x.afterIndex, heard: x.heard })),
      missedQuote: g.missedQuote,
      passageWellLearned: rec.passageWellLearned,
    };
    this.feedbackSpoken = false;
    this.step = 'feedback';
  }

  private feedbackText(): string {
    const r = this.result as ReciteResultView;
    if (r.score >= 0.9995) return tc('memory.core.loopPerfect', 'Perfect.');
    const pct = Math.round(r.score * 100);
    return r.missedQuote.length > 0
      ? tc('memory.core.loopScoreMissed', '{pct} percent. You missed: {missed}.', { pct, missed: r.missedQuote.join(' ') })
      : tc('memory.core.loopScore', '{pct} percent.', { pct });
  }

  private async doFeedback(gen: number): Promise<void> {
    const c = this.card;
    const r = this.result;
    if (!c || !r) {
      this.step = 'fetch';
      return;
    }
    const handsFree = this.deps.mode === 'handsfree';
    const settings = this.deps.settings();
    if (!this.feedbackSpoken) {
      this.feedbackSpoken = true;
      const text = this.feedbackText();
      this.setPhase('feedback', text);
      if (handsFree) {
        await this.earcon(r.score >= 0.9995 ? 'ok' : 'miss');
        if (this.stale(gen)) return;
        await this.say(text, c.language);
        if (this.stale(gen)) return;
        if (r.score < 0.9995 && (settings.readBack || settings.feedback === 'full')) {
          await this.say(this.passageText(c.verses), c.language);
          if (this.stale(gen)) return;
        }
      }
    }
    if (handsFree && settings.autoAdvance) {
      if (settings.voiceCommands) await this.commandWindow(gen);
      else if (!this.stale(gen)) this.step = 'fetch';
      return;
    }
    await this.waitWake(gen);
  }

  /** After feedback, hands-free: listen a few seconds for again / repeat / stop / skip. */
  private async commandWindow(gen: number): Promise<void> {
    const c = this.card as LoopCard;
    const kit = this.kit as ILanguageKit;
    const speech = this.deps.speech;
    let id: string;
    try {
      id = (await speech.startListening({ language: c.language, maxDurationMs: 60000 })).listenId;
    } catch {
      if (!this.stale(gen)) this.step = 'fetch';
      return;
    }
    if (this.stale(gen)) {
      await speech.stopListening(id).catch(() => undefined);
      return;
    }
    this.listenId = id;
    let out;
    try {
      out = await speech.nextUtterance(id, { noSpeechTimeoutMs: LOOP.commandWindowMs });
    } catch {
      out = null;
    }
    if (this.stale(gen) || id !== this.listenId) return;
    await this.closeListen();
    if (this.stale(gen)) return;
    if (out && out.kind === 'speech') {
      const ws = out.transcript.words.length > 0
        ? out.transcript.words
        : out.transcript.text.split(/\s+/).filter((w) => w !== '').map((w) => ({ text: w }));
      const ev = new ReciteCursor([], kit).push(ws);
      if (ev.kind === 'command') {
        if (ev.command === 'again' || ev.command === 'repeat' || ev.command === 'stop') {
          this.act(COMMAND_ACTION[ev.command] as ReciteAction);
          return;
        }
      }
    }
    this.step = 'fetch';
  }

  private async doSummary(gen: number): Promise<void> {
    await this.closeListen();
    if (this.stale(gen)) return;
    const nothingDue = this.done === 0 && this.skipped === 0 && this.deps.source === 'due';
    const text =
      this.done > 0
        ? this.done === 1
          ? tc('memory.core.loopSummaryOne', 'All done. {done} passage, average {avg} percent.', { done: this.done, avg: Math.round((this.scoreSum / this.done) * 100) })
          : tc('memory.core.loopSummaryMany', 'All done. {done} passages, average {avg} percent.', { done: this.done, avg: Math.round((this.scoreSum / this.done) * 100) })
        : nothingDue
          ? tc('memory.core.nothingDueToRecite', 'Nothing is due to recite right now.')
          : tc('memory.core.loopAllDone', 'All done.');
    const language = this.card ? this.card.language : this.lastLanguage;
    // Privacy: drop the card, heard words and result before the final summary.
    this.clearCard();
    this.setPhase('summary', text);
    await this.say(text, language);
    if (this.stale(gen)) return;
    await this.earcon('done');
    if (this.stale(gen)) return;
    this.step = 'end';
    this.setPhase('done', text);
  }

  // -- helpers ------------------------------------------------------------------

  private async say(text: string, language: string): Promise<void> {
    if (this.deps.mode !== 'handsfree') return;
    try {
      await this.deps.speech.speak(text, { language });
    } catch {
      /* speech output is optional; the text is still in the view */
    }
  }

  private async earcon(kind: 'listen' | 'ok' | 'miss' | 'done'): Promise<void> {
    if (this.deps.mode !== 'handsfree') return;
    try {
      await this.deps.speech.earcon(kind);
    } catch {
      /* optional */
    }
  }

  private async closeListen(): Promise<void> {
    const id = this.listenId;
    if (!id) return;
    this.listenId = null;
    try {
      await this.deps.speech.stopListening(id);
    } catch {
      /* idempotent on the host; nothing more to do */
    }
  }

  private indexRange(from: number, count: number): number[] {
    const out: number[] = [];
    for (let i = Math.max(0, from); i < Math.min(this.words.length, from + count); i++) out.push(i);
    return out;
  }

  private quote(idx: number[]): string {
    return idx
      .map((i) => stripPunctuation(this.words[i]))
      .filter((w) => w !== '')
      .join(' ');
  }

  private passageText(verses: VerseText[]): string {
    return verses.map((v) => v.words.join(' ')).join(' ');
  }

  private resetCard(): void {
    if (!this.kit || !this.card) return;
    this.cursor = new ReciteCursor(this.words, this.kit);
    this.hinted = new Set();
    this.heardTexts = [];
    this.result = null;
    this.hintReq = 0;
    this.hintCount = 0;
    this.stall = 0;
    this.noSpeech = 0;
    this.lostCount = 0;
    this.repeatReq = false;
    this.feedbackSpoken = false;
    this.startedAt = this.deps.now();
    this.error = null;
  }

  private clearCard(): void {
    this.card = null;
    this.kit = null;
    this.cursor = null;
    this.words = [];
    this.hinted = new Set();
    this.heardTexts = [];
    this.result = null;
  }

  private setPhase(phase: LoopPhase, message: string): void {
    if (phase === 'listening' || phase === 'scoring' || phase === 'feedback') this.notice = '';
    this.phase = phase;
    this.message = this.notice !== '' ? `${this.notice} ${message}` : message;
    this.emitView();
  }

  private fail(code: string, message: string): void {
    this.error = { code, message };
    // Privacy: nothing heard survives a failed run.
    this.heardTexts = [];
    this.result = null;
    this.cursor = null;
    this.phase = 'error';
    this.message = message;
    this.step = 'end';
    this.emitView();
  }

  private failListen(code: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : '';
    this.fail(code, errorText(code) ?? (msg || tc('memory.core.listenStartFailed', 'Could not start listening.')));
  }

  private emitView(): void {
    try {
      this.deps.emit(this.view());
    } catch {
      /* pushes are fire-and-forget */
    }
  }
}
