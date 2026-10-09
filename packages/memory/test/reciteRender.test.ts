/**
 * @vitest-environment jsdom
 *
 * Render tests for the Recite aloud screens and settings group.
 */
// Ported unchanged from the extension, whose tests were not type-checked; fixtures here
// predate later type changes. Behaviour is covered by vitest, not tsc.
// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PanelHost } from '../src/ui/host';
import type { PanelReply, ReciteSettings, ReciteStateView, SettingsView, SpeechAvailability, VerseText } from '../src/core/types';
import { createReciteView, renderRecite } from '../src/ui/reciteView';
import { renderHandsFree } from '../src/ui/handsFreeView';
import { renderSettings } from '../src/ui/settingsView';

const verse: VerseText = {
  verseId: 1, label: '1:1', words: ['In', 'the', 'beginning', 'God', 'created'],
  lines: null, psalmTitle: null, paragraphStart: true,
};

function state(over: Partial<ReciteStateView> = {}): ReciteStateView {
  return {
    reciteId: 'r1', mode: 'tap', source: 'passage', phase: 'ready', passageId: 1,
    reference: 'Genesis 1:1', verses: null, heard: [], position: -1, hinted: [], result: null,
    done: 0, remaining: 0, message: '', error: null, ...over,
  };
}

const scored = state({
  phase: 'feedback',
  verses: [verse],
  result: {
    score: 0.94, level: 3, nextDueAt: null, missedQuote: ['beginning'], passageWellLearned: false,
    words: [
      { index: 0, verdict: 'correct' },
      { index: 1, verdict: 'near', heard: 'a' },
      { index: 2, verdict: 'missed' },
      { index: 3, verdict: 'swapped' },
      { index: 4, verdict: 'hinted' },
    ],
    extras: [{ afterIndex: 0, heard: 'uh' }],
  },
});

let container: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  container = document.body.appendChild(document.createElement('div'));
});

function cbs() {
  return { onControl: vi.fn(), onExit: vi.fn() };
}
const text = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ');
const buttons = (n: Element) => Array.from(n.querySelectorAll('button')).map((b) => b.textContent);

describe('tap-to-talk view', () => {
  it('shows the reference and Talk; hides verse text before scoring', () => {
    const c = cbs();
    const root = renderRecite(state(), c);
    container.appendChild(root);
    expect(text(root)).toContain('Genesis 1:1');
    expect(text(root)).not.toContain('beginning');
    root.querySelector<HTMLButtonElement>('.sm-recite-talk')!.click();
    expect(c.onControl).toHaveBeenCalledWith('listen');
  });

  it('becomes Stop while listening, shows heard words, and announces Listening', () => {
    const c = cbs();
    const root = renderRecite(state({ phase: 'listening', heard: ['in', 'the'] }), c);
    container.appendChild(root);
    const talk = root.querySelector<HTMLButtonElement>('.sm-recite-talk')!;
    expect(talk.textContent).toBe('Stop');
    expect(text(root.querySelector('.sm-recite-heard')!)).toBe('in the');
    expect(root.querySelector('[aria-live]')!.textContent).toBe('Listening');
    talk.click();
    expect(c.onControl).toHaveBeenCalledWith('stop');
  });

  it('Space toggles talk and stop', () => {
    const c = cbs();
    const screen = createReciteView(state(), c);
    container.appendChild(screen.element);
    screen.element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect(c.onControl).toHaveBeenLastCalledWith('listen');
    screen.update(state({ phase: 'listening' }));
    screen.element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect(c.onControl).toHaveBeenLastCalledWith('stop');
  });

  it('keeps one live region across updates and announces the score', () => {
    const screen = createReciteView(state(), cbs());
    container.appendChild(screen.element);
    const live = screen.element.querySelector('[aria-live]')!;
    screen.update(scored);
    expect(screen.element.querySelector('[aria-live]')).toBe(live);
    expect(live.textContent).toBe('Scored 94%');
  });

  it('labels every non-correct verdict in text, not just colour', () => {
    const root = renderRecite(scored, cbs());
    container.appendChild(root);
    const diff = root.querySelector('.sm-recite-diff')!;
    const word = (v: string) => text(diff.querySelector(`[data-verdict="${v}"]`)!);
    expect(word('correct')).toBe('In');
    expect(word('near')).toContain('(close)');
    expect(word('missed')).toContain('beginning');
    expect(word('missed')).toContain('(missed)');
    expect(word('swapped')).toContain('(swapped)');
    expect(word('hinted')).toContain('(hinted)');
    expect(word('extra')).toContain('+uh');
    // the extra sits inline after word 0
    expect(text(diff).indexOf('+uh')).toBeGreaterThan(text(diff).indexOf('In'));
    expect(text(diff).indexOf('+uh')).toBeLessThan(text(diff).indexOf('the'));
  });

  it('shows score, level, and Again/Next', () => {
    const c = cbs();
    const root = renderRecite({ ...scored, remaining: 2 }, c);
    container.appendChild(root);
    expect(text(root)).toContain('94%');
    expect(text(root)).toContain('Level 3');
    const byLabel = (l: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === l)!;
    byLabel('Again').click();
    byLabel('Next').click();
    expect(c.onControl.mock.calls.map((x) => x[0])).toEqual(['again', 'next']);
  });

  it('shows an error with Try again', () => {
    const root = renderRecite(state({ phase: 'error', error: { code: 'x', message: 'Mic failed' } }), cbs());
    expect(text(root)).toContain('Mic failed');
    expect(buttons(root)).toContain('Try again');
  });
});

describe('hands-free view', () => {
  it('shows large phase text and the five controls', () => {
    const c = cbs();
    const root = renderHandsFree(state({ mode: 'handsfree', phase: 'listening' }), c);
    container.appendChild(root);
    expect(text(root.querySelector('.sm-handsfree-phase')!)).toBe('Listening');
    expect(buttons(root)).toEqual(['Pause', 'Hint', 'Repeat', 'Skip', 'Stop']);
    root.querySelectorAll('button')[0]!.click();
    root.querySelectorAll('button')[4]!.click();
    expect(c.onControl.mock.calls.map((x) => x[0])).toEqual(['pause', 'stop']);
  });

  it('offers Resume when paused', () => {
    const root = renderHandsFree(state({ mode: 'handsfree', phase: 'paused' }), cbs());
    expect(buttons(root)[0]).toBe('Resume');
  });
});

describe('settings: Recite aloud group', () => {
  const recite: ReciteSettings = {
    strictness: 'normal', promptStyle: 'reference', feedback: 'brief',
    readBack: false, autoAdvance: true, voiceCommands: false, hintDelayMs: 5000,
  };
  const speech = (over: Partial<SpeechAvailability> = {}): SpeechAvailability => ({
    state: 'ready', missingPermissions: [], engineLabel: 'Whisper', onDevice: true, handsFree: true, ...over,
  });

  function host(): PanelHost & { requests: unknown[] } {
    const requests: unknown[] = [];
    return {
      requests,
      request: vi.fn(async (r: unknown) => { requests.push(r); return { ok: true, data: {} } as PanelReply<never>; }),
      announce: vi.fn(),
      go: vi.fn(),
    } as unknown as PanelHost & { requests: unknown[] };
  }
  const settings = (s: SpeechAvailability): SettingsView => ({ defaultAnswerMode: 'firstLetter', recite, speech: s });
  const plan = { passages: [] } as never;

  it('renders the group and saves a change', () => {
    const h = host();
    const root = renderSettings(h, settings(speech()), plan);
    container.appendChild(root);
    expect(text(root)).toContain('Recite aloud');
    const sel = root.querySelector<HTMLSelectElement>('#sm-recite-strictness')!;
    sel.value = 'strict';
    sel.dispatchEvent(new Event('change'));
    expect(h.requests).toContainEqual({ type: 'setReciteSettings', patch: { strictness: 'strict' } });
    const delay = root.querySelector<HTMLSelectElement>('#sm-recite-hintdelay')!;
    expect(delay.value).toBe('5000');
    delay.value = '8000';
    delay.dispatchEvent(new Event('change'));
    expect(h.requests).toContainEqual({ type: 'setReciteSettings', patch: { hintDelayMs: 8000 } });
    const auto = root.querySelector<HTMLInputElement>('#sm-recite-auto')!;
    expect(auto.checked).toBe(true);
    auto.checked = false;
    auto.dispatchEvent(new Event('change'));
    expect(h.requests).toContainEqual({ type: 'setReciteSettings', patch: { autoAdvance: false } });
  });

  it('omits the group on a host without recite settings', () => {
    const root = renderSettings(host(), { defaultAnswerMode: 'firstLetter' }, plan);
    expect(text(root)).not.toContain('Recite aloud');
  });

  it('shows a banner for every non-ready state', () => {
    const states: SpeechAvailability['state'][] = ['needs-download', 'unavailable', 'permission-missing', 'unsupported-language', 'host-too-old'];
    for (const st of states) {
      const root = renderSettings(host(), settings(speech({ state: st, missingPermissions: st === 'permission-missing' ? ['speech:listen'] : [] })), plan);
      const banner = root.querySelector('[data-speech-state]')!;
      expect(banner.getAttribute('data-speech-state')).toBe(st);
      expect(text(banner).length).toBeGreaterThan(20);
    }
  });

  it('uses the exact permission-missing text', () => {
    const root = renderSettings(host(), settings(speech({ state: 'permission-missing', missingPermissions: ['speech:listen'] })), plan);
    expect(text(root)).toContain('Memory needs microphone access to listen while you recite.');
    expect(text(root)).not.toContain('Preferences > Extensions');
    expect(text(root)).toContain('Open settings');
  });

  it('confirms before deleting recitation history, and explains what is kept', () => {
    const h = host();
    const root = renderSettings(h, settings(speech()), plan);
    container.appendChild(root);
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Delete recitation history')!.click();
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(text(dialog)).toContain('scores and review schedule are kept');
    expect(h.requests.some((r) => (r as { type: string }).type === 'deleteReciteHistory')).toBe(false);
    Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Delete')!.click();
    expect(h.requests).toContainEqual({ type: 'deleteReciteHistory' });
  });
});

describe('review fixes (render)', () => {
  it('Try again starts the same source again; a due run retries the due queue', () => {
    const c = { ...cbs(), onRetry: vi.fn() };
    const err = { code: 'x', message: 'Mic failed' };
    const a = renderRecite(state({ phase: 'error', error: err, passageId: 7 }), c);
    Array.from(a.querySelectorAll('button')).find((b) => b.textContent === 'Try again')!.click();
    expect(c.onRetry).toHaveBeenLastCalledWith({ kind: 'passage', passageId: 7 });
    const b = renderRecite(state({ phase: 'error', error: err, source: 'due' }), c);
    Array.from(b.querySelectorAll('button')).find((x) => x.textContent === 'Try again')!.click();
    expect(c.onRetry).toHaveBeenLastCalledWith({ kind: 'due' });
    expect(c.onControl).not.toHaveBeenCalled();
  });

  it('hands-free: Stop in the error phase leaves the screen', () => {
    const c = cbs();
    const root = renderHandsFree(state({ mode: 'handsfree', phase: 'error', error: { code: 'x', message: 'Mic failed' } }), c);
    const stop = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Stop')!;
    stop.click();
    expect(c.onExit).toHaveBeenCalled();
    expect(c.onControl).not.toHaveBeenCalled();
  });

  it('progress reads "Card 1 of 1", never "0 done, 1 to go"', () => {
    const one = renderRecite(state({ source: 'due', done: 0, remaining: 0 }), cbs());
    expect(text(one)).toContain('Card 1 of 1');
    expect(text(one)).not.toContain('to go');
    const two = renderHandsFree(state({ mode: 'handsfree', source: 'due', done: 1, remaining: 2 }), cbs());
    expect(text(two.querySelector('.sm-handsfree-progress')!)).toBe('Card 2 of 4');
  });

  it('listening shows a visible Listening label beside Stop; the heard line hides once scored', () => {
    const live = renderRecite(state({ phase: 'listening' }), cbs());
    expect(text(live.querySelector('.sm-recite-talk-row .sm-recite-listening')!)).toBe('Listening…');
    expect(live.querySelector('.sm-recite-talk-on')).not.toBeNull();
    const done = renderRecite({ ...scored, heard: ['in', 'the'] }, cbs());
    expect(done.querySelector('.sm-recite-heard')).toBeNull();
  });

  it('puts a space before the (missed) and (close) tags in the text', () => {
    const root = renderRecite(scored, cbs());
    const diff = root.querySelector('.sm-recite-diff')!;
    expect(text(diff)).toContain('beginning (missed)');
    expect(text(diff)).toContain('the (close)');
  });
});

describe('hands-free tone (car mode)', () => {
  it('is light by default in daytime', async () => {
    const { handsFreeTone } = await import('../src/ui/handsFreeView');
    expect(handsFreeTone({ themeMode: 'light', prefersDark: true, hour: 12 })).toBe('light');
    expect(handsFreeTone({ themeMode: 'sepia', prefersDark: false, hour: 18 })).toBe('light');
  });
  it('is dark when the app theme is dark or at night', async () => {
    const { handsFreeTone } = await import('../src/ui/handsFreeView');
    expect(handsFreeTone({ themeMode: 'dark', prefersDark: false, hour: 12 })).toBe('dark');
    expect(handsFreeTone({ themeMode: 'light', prefersDark: false, hour: 19 })).toBe('dark');
    expect(handsFreeTone({ themeMode: 'light', prefersDark: false, hour: 5 })).toBe('dark');
    expect(handsFreeTone({ themeMode: null, prefersDark: true, hour: 12 })).toBe('dark');
  });
});
