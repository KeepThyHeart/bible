import { afterEach, describe, expect, it, vi } from 'vitest';
import { kitFor } from '@bible/core/recite';
import { FakeSpeechApi } from '@bible/core/speech';
import type { ScriptItem } from '@bible/core/speech';
import type { Card, Passage, ReciteAction, ReciteSettings, ReciteStateView, VerseText } from '../src/core/types';
import { DEFAULT_RECITE_SETTINGS } from '../src/core/recite/config';
import { HandsFreeLoop } from '../src/core/recite/handsFreeLoop';
import type { LoopCard, LoopDeps } from '../src/core/recite/handsFreeLoop';
import type { GradedRecitation } from '../src/core/recite/grade';
import { ReciteService } from '../src/core/recite/service';
import type { ReciteStoreAdapter } from '../src/core/recite/service';
import { moduleKit, moduleLanguage, probeSpeech, resetModuleCache, resetProbeCache } from '../src/core/recite/speechAvailability';

// -- fixtures -------------------------------------------------------------------

function verse(id: number, label: string, text: string): VerseText {
  return { verseId: id, label, words: text.split(' '), lines: null, psalmTitle: null, paragraphStart: false };
}
const VERSES = [
  verse(1, '23:1', 'The LORD is my shepherd; I shall not want.'),
  verse(2, '23:2', 'He maketh me to lie down in green pastures: he leadeth me beside the still waters.'),
];
const V1 = 'the lord is my shepherd i shall not want';
const V2 = 'he maketh me to lie down in green pastures he leadeth me beside the still waters';
const FULL = `${V1} ${V2}`;
const GARBAGE = 'alpha bravo charlie delta echo';

function loopCard(id: number, remaining = 0): LoopCard {
  return {
    cardId: id * 10,
    passageId: id,
    reference: 'Psalm 23:1-2',
    spokenReference: 'Psalm chapter 23, verses 1 to 2',
    language: 'en-US',
    verses: VERSES,
    contextWords: [],
    remaining,
  };
}

/** The last view that carried a result (the loop clears its card before the summary). */
function scored(s: { views: ReciteStateView[] }): ReciteStateView {
  const v = [...s.views].reverse().find((x) => x.result !== null);
  if (!v) throw new Error('no scored view');
  return v;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function until(pred: () => boolean, what = 'condition'): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (pred()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Drop every `heard` field (the only place heard text may live in a view). */
function withoutHeard(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v), (k, val) => (k === 'heard' ? undefined : val));
}

interface Gate {
  hold(method: string, skip?: number): { release(): void; reached: Promise<void> };
}

const allReleases: (() => void)[] = [];

function makeGate() {
  const holds = new Map<string, { promise: Promise<void>; release: () => void; reached: () => void; skip: number }>();
  const fn = (method: string): Promise<void> | void => {
    const h = holds.get(method);
    if (!h) return;
    if (h.skip > 0) {
      h.skip--;
      return;
    }
    holds.delete(method);
    h.reached();
    return h.promise;
  };
  const gate: Gate = {
    hold(method, skip = 0) {
      let release!: () => void;
      let reachedFn!: () => void;
      const promise = new Promise<void>((r) => (release = r));
      const reached = new Promise<void>((r) => (reachedFn = r));
      allReleases.push(() => release());
      holds.set(method, { promise, release, reached: reachedFn, skip });
      return { release, reached };
    },
  };
  return { fn, gate };
}

interface Setup {
  api: FakeSpeechApi;
  loop: HandsFreeLoop;
  views: ReciteStateView[];
  recorded: { card: LoopCard; g: GradedRecitation }[];
  stops: string[];
  gate: Gate;
  view(): ReciteStateView;
  act(a: ReciteAction): ReciteStateView;
  nextCalls: number[];
}

let live: Setup[] = [];

function setup(
  o: {
    script?: ScriptItem[];
    mode?: 'tap' | 'handsfree';
    settings?: Partial<ReciteSettings>;
    cards?: LoopCard[];
    record?: (card: LoopCard, g: GradedRecitation) => Promise<void>;
    api?: FakeSpeechApi;
    emit?: (s: ReciteStateView) => void;
    start?: boolean;
  } = {},
): Setup {
  const { fn, gate } = makeGate();
  const api = o.api ?? new FakeSpeechApi({ script: o.script ?? [], gate: fn });
  const stops: string[] = [];
  const origStop = api.stopListening.bind(api);
  api.stopListening = async (id: string) => {
    stops.push(id);
    return origStop(id);
  };
  const views: ReciteStateView[] = [];
  const recorded: Setup['recorded'] = [];
  const cards = o.cards ?? [loopCard(1)];
  const nextCalls: number[] = [];
  const settings: ReciteSettings = { ...DEFAULT_RECITE_SETTINGS, hintDelayMs: 2000, ...o.settings };
  const deps: LoopDeps = {
    reciteId: 'r1',
    speech: api,
    now: () => 1000,
    kitFor,
    biasLevel: 'names',
    rng: () => 0.5,
    settings: () => settings,
    mode: o.mode ?? 'handsfree',
    source: 'due',
    nextCard: async (exclude) => {
      nextCalls.push(exclude.length);
      return cards.find((c) => !exclude.includes(c.passageId)) ?? null;
    },
    record: async (card, g) => {
      if (o.record) await o.record(card, g);
      recorded.push({ card, g });
      return { level: 3, nextDueAt: 5000, passageWellLearned: false };
    },
    emit: (s) => {
      views.push(s);
      if (o.emit) o.emit(s);
    },
  };
  const loop = new HandsFreeLoop(deps);
  const s: Setup = {
    api,
    loop,
    views,
    recorded,
    stops,
    gate,
    nextCalls,
    view: () => loop.view(),
    act: (a) => loop.control(a),
  };
  live.push(s);
  if (o.start !== false) loop.start();
  return s;
}

afterEach(async () => {
  for (const r of allReleases.splice(0)) r();
  for (const s of live) await s.loop.dispose();
  // Every listen that was started was stopped exactly once.
  for (const s of live) {
    expect(new Set(s.stops).size).toBe(s.stops.length);
    expect(s.stops.length).toBe(s.api.starts.length);
  }
  live = [];
  vi.restoreAllMocks();
});

// -- happy paths ----------------------------------------------------------------

describe('hands-free loop', () => {
  it('announces, listens, scores, gives feedback and summarises', async () => {
    const s = setup({ script: [{ say: FULL }] });
    await until(() => s.view().phase === 'done', 'done');
    const spoken = s.api.spoken.map((x) => x.text);
    expect(spoken[0]).toBe('Psalm chapter 23, verses 1 to 2');
    expect(spoken).toContain('Perfect.');
    expect(spoken[spoken.length - 1]).toBe('All done. 1 passage, average 100 percent.');
    expect(s.api.earcons).toEqual(['listen', 'ok', 'done']);
    expect(s.recorded).toHaveLength(1);
    expect(s.recorded[0].g.attempt.score).toBe(1);
    expect(s.view().done).toBe(1);
    expect(scored(s).result?.level).toBe(3);
    expect(s.api.starts[0].language).toBe('en-US');
    expect(s.api.starts[0].maxDurationMs).toBe(30000 + 600 * 25);
    // The bias never lists the passage in order.
    expect(s.api.starts[0].bias?.level).toBe('names');
  });

  it('reads the passage back when something was missed, and quotes the missed words', async () => {
    const s = setup({ script: [{ say: FULL.replace('shepherd ', '') }] });
    await until(() => s.view().phase === 'done');
    const spoken = s.api.spoken.map((x) => x.text);
    expect(spoken.some((t) => /^\d+ percent\. You missed: shepherd\.$/.test(t))).toBe(true);
    expect(spoken).toContain(VERSES.map((v) => v.words.join(' ')).join(' '));
    expect(s.api.earcons).toContain('miss');
    expect(scored(s).result?.missedQuote).toEqual(['shepherd']);
  });

  it('readBack off (brief feedback) does not read the passage', async () => {
    const s = setup({ script: [{ say: FULL.replace('shepherd ', '') }], settings: { readBack: false } });
    await until(() => s.view().phase === 'done');
    expect(s.api.spoken.map((x) => x.text)).not.toContain(VERSES.map((v) => v.words.join(' ')).join(' '));
  });

  it('reference+opening speaks the first three words and marks them hinted', async () => {
    const s = setup({ script: [{ say: FULL }], settings: { promptStyle: 'reference+opening' } });
    await until(() => s.view().phase === 'done');
    const spoken = s.api.spoken.map((x) => x.text);
    expect(spoken[1]).toBe('The LORD is');
    expect(s.recorded[0].g.detail.verdicts.slice(0, 3)).toBe('hhh');
    expect(scored(s).result?.score).toBeLessThan(1);
  });

  it('shows verses only after scoring', async () => {
    const s = setup({ script: [{ say: FULL }] });
    await until(() => s.view().phase === 'done');
    const beforeResult = s.views.filter((v) => v.result === null);
    expect(beforeResult.length).toBeGreaterThan(0);
    for (const v of beforeResult) expect(v.verses).toBeNull();
    expect(scored(s).verses).toEqual(VERSES);
  });

  it('nothing due: says so and finishes', async () => {
    const s = setup({ cards: [] });
    await until(() => s.view().phase === 'done');
    expect(s.api.spoken.map((x) => x.text)).toEqual(['Nothing is due to recite right now.']);
    expect(s.api.starts).toHaveLength(0);
  });

  it('runs several cards in turn', async () => {
    const s = setup({ script: [{ say: FULL }, { silence: true }, { say: FULL }], cards: [loopCard(1, 1), loopCard(2, 0)] });
    await until(() => s.view().phase === 'done');
    expect(s.recorded.map((r) => r.card.passageId)).toEqual([1, 2]);
    expect(s.api.spoken[s.api.spoken.length - 1].text).toBe('All done. 2 passages, average 100 percent.');
  });

  it('a voice command after feedback can ask for another go', async () => {
    const s = setup({ script: [{ say: FULL }, { say: 'try again' }, { say: FULL }, { silence: true }] });
    await until(() => s.view().phase === 'done');
    expect(s.recorded).toHaveLength(2);
    expect(s.api.spoken.filter((x) => x.text === 'Psalm chapter 23, verses 1 to 2')).toHaveLength(2);
  });

  it('voice commands off: "skip" after feedback does nothing special and the loop moves on', async () => {
    const s = setup({ script: [{ say: FULL }], settings: { voiceCommands: false } });
    await until(() => s.view().phase === 'done');
    expect(s.api.starts).toHaveLength(1); // no command window opened
  });
});

describe('tap mode', () => {
  it('waits for Talk, never speaks, and waits for Next after scoring', async () => {
    const s = setup({ mode: 'tap', script: [{ say: FULL }] });
    await until(() => s.view().phase === 'ready');
    expect(s.view().reference).toBe('Psalm 23:1-2');
    expect(s.api.starts).toHaveLength(0);
    s.act('listen');
    await until(() => s.view().phase === 'feedback');
    expect(s.view().result?.score).toBe(1);
    expect(s.api.spoken).toEqual([]);
    expect(s.api.earcons).toEqual([]);
    expect(s.api.starts).toHaveLength(1);
    s.act('next');
    await until(() => s.view().phase === 'done');
    expect(s.recorded).toHaveLength(1);
  });

  it('Stop with words heard scores what was said; Stop with nothing heard goes back to ready', async () => {
    const { fn, gate } = makeGate();
    const api = new FakeSpeechApi({ script: [{ say: V1 }], gate: fn });
    const held = gate.hold('nextUtterance', 1); // hold the second pull, after V1 was heard
    const s = setup({ mode: 'tap', api });
    await until(() => s.view().phase === 'ready');
    s.act('listen');
    await held.reached;
    expect(s.view().heard.length).toBeGreaterThan(0);
    s.act('stop');
    held.release();
    await until(() => s.view().phase === 'feedback');
    expect(s.view().result?.score).toBeGreaterThan(0);
    expect(s.view().result?.score).toBeLessThan(1);

    const t = setup({ mode: 'tap' });
    await until(() => t.view().phase === 'ready');
    t.act('stop');
    await until(() => t.view().phase === 'done'); // Stop outside a listen still ends the run
    expect(t.recorded).toHaveLength(0);

    // Stop after Talk but before any word: back to ready, listen closed, Talk works again.
    const g2 = makeGate();
    const held2 = g2.gate.hold('nextUtterance');
    const u = setup({ mode: 'tap', api: new FakeSpeechApi({ script: [{ say: FULL }], gate: g2.fn }) });
    await until(() => u.view().phase === 'ready');
    u.act('listen');
    await held2.reached;
    u.act('stop');
    held2.release();
    await until(() => u.view().phase === 'ready' && u.stops.length === 1);
    expect(u.view().phase).not.toBe('summary');
    u.act('listen');
    await until(() => u.view().phase === 'feedback');
  });

  it('again after feedback discards heard and hints and waits for Talk', async () => {
    const s = setup({ mode: 'tap', script: [{ say: FULL }, { say: FULL }] });
    await until(() => s.view().phase === 'ready');
    s.act('hint');
    await until(() => s.view().hinted.length === 1, 'hint');
    s.act('listen');
    await until(() => s.view().phase === 'feedback');
    s.act('again');
    await until(() => s.view().phase === 'ready');
    expect(s.view().heard).toEqual([]);
    expect(s.view().hinted).toEqual([]);
    expect(s.view().result).toBeNull();
    s.act('listen');
    await until(() => s.view().phase === 'feedback');
    expect(s.view().result?.score).toBe(1);
    expect(s.recorded).toHaveLength(2);
  });

  it('a hint before listening shows the first word without speaking', async () => {
    const s = setup({ mode: 'tap' });
    await until(() => s.view().phase === 'ready');
    s.act('hint');
    await until(() => s.view().hinted.length === 1);
    expect(s.view().message).toBe('Hint: The');
    expect(s.api.spoken).toEqual([]);
  });
});

// -- derails and nudges ---------------------------------------------------------

describe('derails', () => {
  it('skipping ahead is accepted; the skipped words score as missed', async () => {
    const s = setup({ script: [{ say: V1 }, { say: 'he leadeth me beside the still waters' }], settings: { voiceCommands: false } });
    await until(() => s.view().phase === 'done');
    const r = s.recorded[0].g;
    expect(r.result.words[12].verdict).toBe('missed');
    expect(r.result.words[24].verdict).toBe('correct');
    expect(r.missedQuote.length).toBe(5);
    expect(r.attempt.score).toBeLessThan(1);
  });

  it('lost twice in a row gives a pick-up hint from the next three words', async () => {
    const s = setup({ script: [{ say: GARBAGE }, { say: GARBAGE }, { say: FULL }], settings: { voiceCommands: false } });
    await until(() => s.view().phase === 'done');
    expect(s.api.spoken.map((x) => x.text)).toContain("Let's pick up from: The LORD is");
    expect(s.recorded[0].g.detail.verdicts.slice(0, 3)).toBe('hhh');
  });

  it('one lost chunk followed by progress gives no hint', async () => {
    const s = setup({ script: [{ say: GARBAGE }, { say: FULL }, { silence: true }] });
    await until(() => s.view().phase === 'done');
    expect(s.api.spoken.some((x) => x.text.startsWith("Let's pick up"))).toBe(false);
  });

  it('no speech before any match: nudge, then pause; resume re-announces', async () => {
    const s = setup({ script: [{ silence: true }, { silence: true }, { say: FULL }, { silence: true }] });
    await until(() => s.view().phase === 'paused', 'paused');
    expect(s.api.spoken.map((x) => x.text)).toContain('Say hint, repeat, or skip.');
    expect(s.stops.length).toBe(1);
    s.act('resume');
    await until(() => s.view().phase === 'done');
    expect(s.api.spoken.filter((x) => x.text === 'Psalm chapter 23, verses 1 to 2')).toHaveLength(2);
    expect(s.recorded).toHaveLength(1);
  });

  it('stalling mid-passage hints one word, then three, then scores', async () => {
    const s = setup({ script: [{ say: V1 }, { silence: true }, { silence: true }, { silence: true }] , settings: { voiceCommands: false }});
    await until(() => s.view().phase === 'done');
    const spoken = s.api.spoken.map((x) => x.text);
    expect(spoken).toContain('He');
    expect(spoken).toContain('He maketh me');
    expect(s.recorded).toHaveLength(1);
    expect(s.recorded[0].g.detail.verdicts.slice(9, 12)).toBe('hhh');
  });

  it('stalling near the end scores immediately', async () => {
    const almost = FULL.split(' ').slice(0, -2).join(' ');
    const s = setup({ script: [{ say: almost }, { silence: true }], settings: { voiceCommands: false } });
    await until(() => s.view().phase === 'done');
    expect(s.recorded).toHaveLength(1);
    expect(s.api.spoken.map((x) => x.text)).not.toContain('me');
    expect(s.recorded[0].g.detail.verdicts.slice(-2)).toBe('mm');
  });

  it('a spoken "hint" gives a hint and keeps listening with a fresh listen', async () => {
    const s = setup({ script: [{ say: 'hint' }, { say: FULL }, { silence: true }] });
    await until(() => s.view().phase === 'done');
    expect(s.api.spoken.map((x) => x.text)).toContain('The');
    expect(s.api.starts.length).toBe(2); // one listen kept open across the hint, plus the command window
    expect(s.recorded[0].g.detail.verdicts[0]).toBe('h');
  });

  it('a mic error moves to the error phase and closes the mic once', async () => {
    const s = setup({ script: [{ error: 'mic-denied' }] });
    await until(() => s.view().phase === 'error');
    expect(s.view().error?.code).toBe('mic-denied');
    expect(s.view().error?.message).toMatch(/microphone/i);
    await s.loop.dispose();
    expect(s.stops).toEqual(['listen-1']);
  });
});

// -- controls --------------------------------------------------------------------

describe('controls', () => {
  it('skip records nothing and moves on; stop summarises scored cards', async () => {
    const s = setup({ mode: 'tap', cards: [loopCard(1), loopCard(2)], script: [{ say: FULL }] });
    await until(() => s.view().phase === 'ready');
    expect(s.view().passageId).toBe(1);
    s.act('skip');
    await until(() => s.view().passageId === 2 && s.view().phase === 'ready');
    s.act('listen');
    await until(() => s.view().phase === 'feedback');
    expect(s.recorded.map((r) => r.card.passageId)).toEqual([2]);
    s.act('stop');
    await until(() => s.view().phase === 'done');
    expect(s.view().done).toBe(1);
  });

  it('double stop, double pause and a stray resume are idempotent', async () => {
    const { fn, gate } = makeGate();
    const api = new FakeSpeechApi({ gate: fn });
    const held = gate.hold('nextUtterance');
    const s = setup({ api });
    await held.reached;
    expect(s.view().phase).toBe('listening');
    s.act('resume');
    expect(s.view().phase).toBe('listening');
    s.act('pause');
    s.act('pause');
    await until(() => s.view().phase === 'paused');
    s.act('stop');
    s.act('stop');
    held.release();
    await until(() => s.view().phase === 'done');
    s.act('stop');
    s.act('pause');
    expect(s.view().phase).toBe('done');
    await s.loop.dispose();
    await s.loop.dispose();
    expect(s.stops).toHaveLength(1);
  });

  it('again hands-free discards heard and hints and re-announces', async () => {
    const { fn, gate } = makeGate();
    const api = new FakeSpeechApi({ script: [{ say: GARBAGE }, { say: GARBAGE }, { say: FULL }, { silence: true }], gate: fn });
    const heldListen = gate.hold('nextUtterance', 1);
    const heldSpeak = gate.hold('speak', 1); // let the announcement through, hold the hint
    const s = setup({ api, settings: { voiceCommands: false } });
    await heldListen.reached;
    expect(s.view().heard.length).toBeGreaterThan(0);
    s.act('hint');
    heldListen.release();
    await heldSpeak.reached;
    expect(s.view().hinted.length).toBeGreaterThan(0);
    s.act('again');
    heldSpeak.release();
    await until(() => s.view().phase === 'done');
    expect(s.api.spoken.filter((x) => x.text === 'Psalm chapter 23, verses 1 to 2').length).toBeGreaterThanOrEqual(2);
    expect(s.recorded[0].g.detail.verdicts.includes('h')).toBe(false);
  });
});

// -- race rules -------------------------------------------------------------------

describe('race rules', () => {
  it('1. one driver: controls never overlap listens', async () => {
    let active = 0;
    let maxActive = 0;
    const { fn, gate } = makeGate();
    const api = new FakeSpeechApi({ script: [{ say: FULL }], gate: fn });
    const held = gate.hold('nextUtterance');
    const orig = api.nextUtterance.bind(api);
    api.nextUtterance = async (id, o) => {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        return await orig(id, o);
      } finally {
        active--;
      }
    };
    const s = setup({ api });
    await held.reached;
    s.act('hint');
    s.act('repeat');
    s.act('hint');
    held.release(); // the host resolves the pending pull when cancelled
    await until(() => s.view().phase === 'done');
    expect(maxActive).toBe(1);
  });

  it('2. skip during the spoken announcement: the stale speak is dropped and the next card is announced', async () => {
    const { fn, gate } = makeGate();
    const held = gate.hold('speak');
    const api = new FakeSpeechApi({ script: [{ say: FULL }, { silence: true }], gate: fn });
    const s = setup({ api, cards: [loopCard(1), loopCard(2)], mode: 'handsfree' });
    await held.reached;
    expect(s.view().phase).toBe('announcing');
    const cancels = vi.spyOn(api, 'cancel');
    s.act('skip');
    expect(cancels).toHaveBeenCalled();
    held.release();
    await until(() => s.view().phase === 'done');
    // Card 1 never got to its listen earcon or startListening; card 2 did, and was scored.
    expect(api.earcons.filter((e) => e === 'listen')).toHaveLength(1);
    expect(s.recorded.map((r) => r.card.passageId)).toEqual([2]);
    expect(api.starts).toHaveLength(2); // card 2's listen and its command window
  });

  it('2b. stop during the announcement ends without ever listening', async () => {
    const { fn, gate } = makeGate();
    const held = gate.hold('speak');
    const api = new FakeSpeechApi({ gate: fn });
    const s = setup({ api });
    await held.reached;
    s.act('stop');
    held.release();
    await until(() => s.view().phase === 'done');
    expect(api.starts).toHaveLength(0);
    expect(s.stops).toHaveLength(0);
  });

  it('3. a stale listen outcome after skip is ignored; the new card gets a new listenId', async () => {
    const api = new FakeSpeechApi({ script: [{ say: FULL }] });
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    // A host that resolves the cancelled pull with the old utterance anyway.
    const origCancel = api.cancel.bind(api);
    let armed = false;
    api.cancel = async () => {
      if (armed) release();
      return origCancel();
    };
    const orig = api.nextUtterance.bind(api);
    let first = true;
    const seen: string[] = [];
    api.nextUtterance = async (id, o) => {
      seen.push(id);
      if (first) {
        first = false;
        await hold;
        const ws = FULL.split(' ').map((t) => ({ text: t }));
        return { kind: 'speech', transcript: { text: FULL, words: ws, final: true, engineId: 'x', modelId: 'y', audioMs: 0, decodeMs: 0 } };
      }
      return orig(id, o);
    };
    const s = setup({ api, mode: 'tap', cards: [loopCard(1), loopCard(2)] });
    await until(() => s.view().phase === 'ready');
    s.act('listen');
    await until(() => seen.length === 1);
    armed = true;
    s.act('skip');
    await until(() => s.view().passageId === 2 && s.view().phase === 'ready');
    // The stale utterance was not scored or heard.
    expect(s.recorded).toHaveLength(0);
    expect(s.view().heard).toEqual([]);
    s.act('listen');
    await until(() => s.view().phase === 'feedback');
    expect(seen[0]).not.toBe(seen[1]);
    expect(s.recorded.map((r) => r.card.passageId)).toEqual([2]);
  });

  it('3b. a listen started while a skip arrives is stopped, not leaked', async () => {
    const { fn, gate } = makeGate();
    const api = new FakeSpeechApi({ gate: fn });
    const held = gate.hold('startListening');
    const s = setup({ api, mode: 'tap', cards: [loopCard(1), loopCard(2)] });
    await until(() => s.view().phase === 'ready');
    s.act('listen');
    await held.reached;
    s.act('skip');
    held.release();
    await until(() => s.view().passageId === 2);
    await tick();
    expect(s.stops).toEqual(['listen-1']);
  });

  it('4. a panel that goes away does not matter: emit may throw and state is still readable', async () => {
    const s = setup({
      script: [{ say: FULL }],
      emit: () => {
        throw new Error('panel closed');
      },
    });
    await until(() => s.view().phase === 'done');
    expect(s.recorded[0].g.attempt.score).toBe(1);
  });

  it('5. a card removed mid-run is reported and the loop continues', async () => {
    const s = setup({
      mode: 'tap',
      cards: [loopCard(1), loopCard(2)],
      script: [{ say: FULL }, { say: FULL }],
      record: async (card) => {
        if (card.passageId === 1) throw new Error('That passage is no longer in your plan.');
      },
    });
    await until(() => s.view().phase === 'ready');
    s.act('listen');
    await until(() => s.view().passageId === 2 && s.view().phase === 'ready');
    expect(s.view().message).toMatch(/no longer in your plan/);
    s.act('listen');
    await until(() => s.view().phase === 'feedback');
    expect(s.recorded.map((r) => r.card.passageId)).toEqual([2]);
    expect(s.view().done).toBe(1);
  });

  it('7. every exit path stops listening exactly once (dispose while listening)', async () => {
    const { fn, gate } = makeGate();
    const api = new FakeSpeechApi({ gate: fn });
    const held = gate.hold('nextUtterance');
    const s = setup({ api });
    await held.reached;
    const d = s.loop.dispose();
    held.release();
    await d;
    await s.loop.dispose();
    expect(s.stops).toEqual(['listen-1']);
  });

  it('7b. dispose while a listen is in flight stops the listen that arrives late', async () => {
    const { fn, gate } = makeGate();
    const api = new FakeSpeechApi({ gate: fn });
    const held = gate.hold('startListening');
    const s = setup({ api });
    await held.reached;
    const d = s.loop.dispose();
    held.release();
    await d;
    expect(api.starts).toHaveLength(1);
    expect(s.stops).toEqual(['listen-1']);
  });

  it('8. a record failure never leaves the mic open', async () => {
    let stopsAtRecord = -1;
    const s = setup({
      script: [{ say: FULL }],
      record: async () => {
        stopsAtRecord = s.stops.length;
        throw new Error('disk full');
      },
    });
    await until(() => s.view().phase === 'error');
    expect(stopsAtRecord).toBe(1);
    expect(s.view().error?.code).toBe('record');
    expect(s.stops).toEqual(['listen-1']);
  });
});

// -- privacy ---------------------------------------------------------------------

describe('privacy', () => {
  it('a heard sentinel appears nowhere but the in-memory heard fields', async () => {
    const SENT = 'zebrafish';
    const logs: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    }
    const heard = FULL.replace('my shepherd', `my ${SENT} shepherd`);
    const s = setup({ script: [{ say: heard }, { silence: true }, { say: FULL }, { silence: true }], cards: [loopCard(1, 1), loopCard(2)] });
    await until(() => s.view().phase === 'done');

    // Something was heard and kept in memory.
    expect(s.views.some((v) => v.heard.includes(SENT))).toBe(true);
    expect(s.views.some((v) => v.result?.extras.some((x) => x.heard === SENT))).toBe(true);
    // Outside `heard` fields: nothing.
    for (const v of s.views) expect(JSON.stringify(withoutHeard(v))).not.toContain(SENT);
    // Not spoken, not stored, not logged.
    expect(JSON.stringify(s.api.spoken)).not.toContain(SENT);
    expect(JSON.stringify(s.recorded[0].g.detail)).not.toContain(SENT);
    expect(s.recorded[0].g.detail.extras).toBe(1);
    expect(logs.join('\n')).not.toContain(SENT);
    // Once the next card starts, the heard list is gone.
    const afterSwitch = s.views.filter((v) => v.passageId === 2);
    expect(afterSwitch.length).toBeGreaterThan(0);
    expect(JSON.stringify(afterSwitch.slice(0, 1))).not.toContain(SENT);
    expect(JSON.stringify(s.view())).not.toContain(SENT);
  });
});

// -- service ----------------------------------------------------------------------

function passage(id: number): Passage {
  return {
    id,
    collectionId: 1,
    moduleId: 'KJV',
    startVerseId: 1,
    endVerseId: 2,
    reference: 'Psalm 23:1-2',
    verseCount: 2,
    addedAt: 0,
    answerMode: null,
    reciteOn: true,
  };
}
function card(id: number): Card {
  return { id: id * 10, passageId: id, rung: 'recite' } as unknown as Card;
}

function makeService(o: { speech?: FakeSpeechApi | null; script?: ScriptItem[]; language?: () => Promise<string | undefined>; moduleId?: string; dueCount?: number; dueAt?: (pid: number) => number | null } = {}) {
  const settings = new Map<string, string>();
  const details: { attemptId: number; cardId: number; detail: unknown }[] = [];
  const attempts: unknown[] = [];
  const pushed: ReciteStateView[] = [];
  let deleted = 0;
  const speech = o.speech === null ? undefined : (o.speech ?? new FakeSpeechApi({ script: o.script ?? [] }));
  const store: ReciteStoreAdapter = {
    getPassage: async (id) => (id === 1 || id === 2 ? { ...passage(id), moduleId: o.moduleId ?? 'KJV' } : undefined),
    getCard: async (pid) => ({ ...card(pid), dueAt: o.dueAt ? o.dueAt(pid) : null }) as Card,
    getScope: async () => ({ kind: 'all' }),
    nextDueRecite: async (_s, _n, ex) =>
      ex.includes(1) ? (o.dueCount && !ex.includes(2) ? { card: card(2), passage: passage(2) } : undefined) : { card: card(1), passage: passage(1) },
    reciteDueCount: async () => o.dueCount ?? 1,
    recordReciteDetail: async (attemptId, cardId, _at, detail) => void details.push({ attemptId, cardId, detail }),
    deleteReciteHistory: async () => void deleted++,
    getSetting: async (k) => settings.get(k),
    setSetting: async (k, v) => void settings.set(k, v),
  };
  const svc = new ReciteService({
    store,
    speech,
    now: () => 10_000,
    rng: () => 0.5,
    bibleModuleLanguage: o.language ?? (async () => 'en'),
    loadVerses: async () => VERSES,
    recordAndSchedule: async (a) => {
      attempts.push(a);
      return { attemptId: 77, level: 2, nextDueAt: 99, passageWellLearned: false };
    },
    push: (s) => pushed.push(s),
  });
  return { svc, settings, details, attempts, pushed, speech, deleted: () => deleted };
}

describe('ReciteService', () => {
  afterEach(() => resetProbeCache());

  it('settings default, validate, persist', async () => {
    const t = makeService();
    expect(await t.svc.getSettings()).toEqual(DEFAULT_RECITE_SETTINGS);
    const next = await t.svc.setSettings({ strictness: 'strict', hintDelayMs: 1, readBack: false, feedback: 'nope' as never });
    expect(next.strictness).toBe('strict');
    expect(next.hintDelayMs).toBe(2000);
    expect(next.readBack).toBe(false);
    expect(next.feedback).toBe('brief');
    expect((await t.svc.getSettings()).strictness).toBe('strict');
    t.settings.set('reciteSettings', '{not json');
    expect(await t.svc.getSettings()).toEqual(DEFAULT_RECITE_SETTINGS);
  });

  it('runs a due loop end to end: records via recordAndSchedule, then detail with the attempt id', async () => {
    const t = makeService({ script: [{ say: FULL }, { silence: true }] });
    const v = await t.svc.start({ source: { kind: 'due' }, mode: 'handsfree' });
    expect(v.reciteId).toBe('recite-1');
    await until(() => t.svc.get()?.phase === 'done');
    expect(t.attempts).toHaveLength(1);
    expect(t.attempts[0]).toMatchObject({ cardId: 10, passageId: 1, rung: 'recite', tier: 0, score: 1, totalSteps: 25, correctFirst: 25 });
    expect(t.details).toHaveLength(1);
    expect(t.details[0].attemptId).toBe(77);
    expect(t.details[0].cardId).toBe(10);
    expect(t.pushed.length).toBeGreaterThan(3);
    expect(t.pushed.find((p) => p.result !== null)?.result?.level).toBe(2);
    await t.svc.dispose();
  });

  it('passage source runs once; control by id; a wrong id returns the active state', async () => {
    const t = makeService({ script: [{ say: FULL }] });
    const v = await t.svc.start({ source: { kind: 'passage', passageId: 2 }, mode: 'tap' });
    await until(() => t.svc.get()?.phase === 'ready' && t.svc.get()?.passageId === 2);
    expect(t.svc.control({ reciteId: 'other', action: 'stop' }).phase).toBe('ready');
    t.svc.control({ reciteId: v.reciteId, action: 'listen' });
    await until(() => t.svc.get()?.phase === 'feedback');
    t.svc.control({ reciteId: v.reciteId, action: 'next' });
    await until(() => t.svc.get()?.phase === 'done');
    expect(t.attempts).toHaveLength(1);
    await t.svc.dispose();
  });

  it('start while active returns the active state; a finished loop is replaced', async () => {
    const t = makeService({ script: [] });
    const a = await t.svc.start({ source: { kind: 'passage', passageId: 1 }, mode: 'tap' });
    await until(() => t.svc.get()?.phase === 'ready');
    const b = await t.svc.start({ source: { kind: 'passage', passageId: 2 }, mode: 'tap' });
    expect(b.reciteId).toBe(a.reciteId);
    // A paused tap loop is replaced by a new tap-from-passage request.
    t.svc.control({ reciteId: a.reciteId, action: 'pause' });
    await until(() => t.svc.get()?.phase === 'paused');
    const c = await t.svc.start({ source: { kind: 'passage', passageId: 2 }, mode: 'tap' });
    expect(c.reciteId).not.toBe(a.reciteId);
    t.svc.control({ reciteId: c.reciteId, action: 'stop' });
    await until(() => t.svc.get()?.phase === 'done');
    const d = await t.svc.start({ source: { kind: 'due' }, mode: 'handsfree' });
    expect(d.reciteId).not.toBe(c.reciteId);
    await t.svc.dispose();
  });

  it('refuses to start when speech is unavailable, naming the reason', async () => {
    const noPerm = makeService({ speech: new FakeSpeechApi({ granted: { listen: false, speak: true } }) });
    await expect(noPerm.svc.start({ source: { kind: 'due' }, mode: 'tap' })).rejects.toThrow(/speech:listen/);
    resetProbeCache();
    const old = makeService({ speech: null });
    await expect(old.svc.start({ source: { kind: 'due' }, mode: 'tap' })).rejects.toThrow(/does not support speech/);
    resetProbeCache();
    const mute = makeService({ speech: new FakeSpeechApi({ granted: { listen: true, speak: false } }) });
    await expect(mute.svc.start({ source: { kind: 'due' }, mode: 'handsfree' })).rejects.toThrow(/able to speak/);
    resetProbeCache();
    const gone = makeService();
    await expect(gone.svc.start({ source: { kind: 'passage', passageId: 99 }, mode: 'tap' })).rejects.toThrow(/no longer in your plan/);
  });

  it('deleteHistory and dispose', async () => {
    const t = makeService({ script: [] });
    const { fn: gateFn, gate } = makeGate();
    await t.svc.deleteHistory();
    expect(t.deleted()).toBe(1);
    (t.speech as FakeSpeechApi).gate = gateFn;
    const held = gate.hold('nextUtterance');
    await t.svc.start({ source: { kind: 'due' }, mode: 'handsfree' });
    await held.reached;
    const d = t.svc.dispose();
    held.release();
    await d;
    expect((t.speech as FakeSpeechApi).starts).toHaveLength(1);
  });
});

describe('probeSpeech', () => {
  afterEach(() => resetProbeCache());

  it('maps host status to availability and caches for 30 s', async () => {
    const api = new FakeSpeechApi({ status: { engineLabel: 'Whisper', onDevice: true } });
    const a = await probeSpeech({ speech: api }, 1000);
    expect(a).toEqual({ state: 'ready', missingPermissions: [], engineLabel: 'Whisper', onDevice: true, handsFree: true });
    api.granted = { listen: false, speak: false };
    expect((await probeSpeech({ speech: api }, 2000)).state).toBe('ready'); // cached
    expect((await probeSpeech({ speech: api }, 40_000)).state).toBe('permission-missing');
    expect((await probeSpeech({ speech: api }, 40_001, { force: true })).missingPermissions).toEqual(['speech:listen', 'speech:speak']);
  });

  it('unknown RPC means host-too-old; other failures mean unavailable; states pass through', async () => {
    const old = { speech: { status: async () => { throw new Error('Unknown RPC method: speech.status'); } } } as never;
    expect((await probeSpeech(old, 1, { force: true })).state).toBe('host-too-old');
    const broken = { speech: { status: async () => { throw new Error('boom'); } } } as never;
    expect((await probeSpeech(broken, 1, { force: true })).state).toBe('unavailable');
    const dl = new FakeSpeechApi({ status: { listen: 'needs-download' } });
    expect((await probeSpeech({ speech: dl }, 1, { force: true })).state).toBe('needs-download');
    const un = new FakeSpeechApi({ status: { listen: 'unavailable', speak: 'unavailable' } });
    const r = await probeSpeech({ speech: un }, 1, { force: true });
    expect(r.state).toBe('unavailable');
    expect(r.handsFree).toBe(false);
  });
});

// -- review fixes ------------------------------------------------------------------

describe('review fixes', () => {
  it('2. tap: Talk while paused after two no-speech timeouts resumes listening', async () => {
    const s = setup({ mode: 'tap', script: [{ silence: true }, { silence: true }, { say: FULL }], settings: { voiceCommands: false } });
    await until(() => s.view().phase === 'ready');
    s.act('listen');
    await until(() => s.view().phase === 'paused', 'paused');
    s.act('listen');
    await until(() => s.view().phase === 'feedback');
    expect(s.recorded).toHaveLength(1);
  });

  it('3. error phase: loop stays finished (controls no-ops) and the error view keeps no heard text', async () => {
    const s = setup({ mode: 'tap', script: [{ say: V1 }, { error: 'mic-busy' }] });
    await until(() => s.view().phase === 'ready');
    s.act('listen');
    await until(() => s.view().phase === 'error');
    expect(s.view().heard).toEqual([]);
    expect(s.view().result).toBeNull();
    expect(s.view().passageId).toBe(1); // kept so the view can retry the same passage
    expect(s.act('stop').phase).toBe('error');
    expect(s.act('listen').phase).toBe('error');
  });

  it('6. the summary for a single passage run is not "Nothing is due"', async () => {
    const s = setup({ mode: 'handsfree', cards: [] });
    await until(() => s.view().phase === 'done');
    expect(s.view().message).toBe('Nothing is due to recite right now.');
    const t = makeService();
    await t.svc.start({ source: { kind: 'passage', passageId: 1 }, mode: 'tap' });
    await until(() => t.svc.get()?.phase === 'ready');
    t.svc.control({ reciteId: 'recite-1', action: 'skip' });
    await until(() => t.svc.get()?.phase === 'done');
    expect(t.svc.get()?.message).toBe('All done.');
    await t.svc.dispose();
  });

  it('7. hint mid-listen keeps the session open and does not drop the in-flight utterance', async () => {
    const { fn, gate } = makeGate();
    const rest = V2.split(' ').slice(3).join(' ');
    const api = new FakeSpeechApi({ script: [{ say: V1 }, { say: 'he maketh me' }, { say: rest }, { silence: true }], gate: fn });
    const held = gate.hold('nextUtterance', 1); // the second pull is in flight
    const s = setup({ api, settings: { voiceCommands: false } });
    await held.reached;
    s.act('hint');
    s.act('repeat');
    expect(s.stops).toHaveLength(0); // the listen was not closed
    held.release();
    await until(() => s.view().phase === 'done');
    // The in-flight utterance (V2) was heard and scored; no second listen was opened for the hint.
    expect(s.recorded).toHaveLength(1);
    expect(s.api.starts).toHaveLength(1); // one listen, kept open across the hint and repeat
    expect(s.recorded[0].g.detail.verdicts).toContain('h'); // the queued hint was given
    const spoken = s.api.spoken.map((x) => x.text);
    expect(spoken.filter((t) => t === 'Psalm chapter 23, verses 1 to 2')).toHaveLength(2); // announce + repeat
  });

  it('9. a summary phase is replaceable by a new start, and so is a stopped-then-left run', async () => {
    const t = makeService({ script: [] });
    const a = await t.svc.start({ source: { kind: 'passage', passageId: 1 }, mode: 'tap' });
    await until(() => t.svc.get()?.phase === 'ready');
    t.svc.control({ reciteId: a.reciteId, action: 'stop' });
    expect(t.svc.get()?.phase).toBe('summary');
    const b = await t.svc.start({ source: { kind: 'passage', passageId: 2 }, mode: 'tap' });
    expect(b.reciteId).not.toBe(a.reciteId);
    await t.svc.dispose();
  });

  it('4. privacy: nothing heard stays readable once the run is done or failed', async () => {
    const SENT = 'zebrafish';
    const t = makeService({ script: [{ say: FULL.replace('my shepherd', `my ${SENT} shepherd`) }, { silence: true }] });
    await t.svc.start({ source: { kind: 'due' }, mode: 'handsfree' });
    await until(() => t.svc.get()?.phase === 'done');
    const v = t.svc.get();
    expect(v?.heard).toEqual([]);
    expect(v?.result).toBeNull();
    expect(v?.verses).toBeNull();
    expect(JSON.stringify(v)).not.toContain(SENT);
    await t.svc.dispose(); // last is sanitized as well
    expect(JSON.stringify(t.svc.get())).not.toContain(SENT);
    const last = t.pushed[t.pushed.length - 1];
    expect(last.heard).toEqual([]);

    const e = makeService({ script: [{ say: FULL.replace('my shepherd', `my ${SENT} shepherd`).split(' ').slice(0, 6).join(' ') }, { error: 'engine' }] });
    await e.svc.start({ source: { kind: 'due' }, mode: 'handsfree' });
    await until(() => e.svc.get()?.phase === 'error');
    expect(e.svc.get()?.heard).toEqual([]);
    await e.svc.dispose();
    expect(e.svc.get()?.heard).toEqual([]);
    expect(e.svc.get()?.result).toBeNull();
  });

  it('5. the "to go" count only subtracts excluded passages that are still due', async () => {
    const t = makeService({ script: [{ say: FULL }, { silence: true }], dueCount: 2, dueAt: (pid) => (pid === 1 ? 999_999 : null) });
    await t.svc.start({ source: { kind: 'due' }, mode: 'tap' });
    await until(() => t.svc.get()?.phase === 'ready');
    expect(t.svc.get()?.remaining).toBe(1); // two due now, this is one of them
    t.svc.control({ reciteId: 'recite-1', action: 'listen' });
    await until(() => t.svc.get()?.phase === 'feedback');
    t.svc.control({ reciteId: 'recite-1', action: 'next' });
    await until(() => t.svc.get()?.passageId === 2);
    // Passage 1 was scored and is no longer due, so it is not subtracted again.
    expect(t.svc.get()?.remaining).toBe(1);
    await t.svc.dispose();
  });

  it('10. an unknown module language is unsupported, not English', async () => {
    const t = makeService({ language: async () => undefined, moduleId: 'XYZ' });
    await expect(t.svc.start({ source: { kind: 'passage', passageId: 1 }, mode: 'tap' })).rejects.toThrow(/language/);
    resetProbeCache();
    const ok = makeService({ language: async () => 'en-GB' });
    await ok.svc.start({ source: { kind: 'passage', passageId: 1 }, mode: 'tap' });
    await ok.svc.dispose();
    const md = { bible: { listModules: async () => [{ id: 'kjv', abbreviation: 'KJV' }, { id: 'zz', abbreviation: 'ZZ' }] } };
    resetModuleCache();
    expect(await moduleLanguage(md, 'KJV')).toBe('en');
    expect(await moduleKit(md, 'KJV')).not.toBeNull();
    expect(await moduleKit(md, 'ZZ')).toBeNull();
    resetModuleCache();
  });
});
