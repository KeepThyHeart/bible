import { describe, it, expect } from 'vitest';
import type { AudioSourceChoice, IAudioProvider } from '@bible/core/browser';
import type { SourceStatus } from './AudioSourceResolver';
import { choiceOfUi, generatedChoice, uiOptions, uiSourceOf, usableEngines } from './sourceChoice';

const st = (id: string, usable: boolean, reason?: SourceStatus['reason']): SourceStatus => ({
  provider: { id, kind: id.startsWith('tts:') ? 'tts' : 'recorded', label: id === 'recorded' ? 'Recorded' : id.slice(4).toUpperCase() } as IAudioProvider,
  usable, reason, voices: [],
});
const t = (k: string, o?: Record<string, string>) => (o ? `${k}${JSON.stringify(o)}` : k);

describe('uiSourceOf', () => {
  it.each([
    ['auto', 'auto'], ['recorded', 'recorded'], ['tts:piper', 'generated'], ['tts:kokoro', 'generated'],
  ] as Array<[AudioSourceChoice, string]>)('%s -> %s', (choice, ui) => { expect(uiSourceOf(choice)).toBe(ui); });
});

describe('usableEngines', () => {
  it('keeps only usable tts providers, in order', () => {
    const list = [st('recorded', true), st('tts:a', false, 'browser'), st('tts:b', true), st('tts:c', true)];
    expect(usableEngines(list).map(s => s.provider.id)).toEqual(['tts:b', 'tts:c']);
  });
});

describe('generatedChoice', () => {
  const both = [st('recorded', true), st('tts:a', true), st('tts:b', true)];
  it('keeps the current usable engine', () => { expect(generatedChoice(both, 'tts:a', 'tts:b')).toBe('tts:a'); });
  it('prefers the playing engine over the first', () => { expect(generatedChoice(both, 'auto', 'tts:b')).toBe('tts:b'); });
  it('takes the first usable engine otherwise', () => {
    expect(generatedChoice(both, 'recorded', 'recorded')).toBe('tts:a');
    expect(generatedChoice([st('tts:a', false, 'browser'), st('tts:b', true)], 'tts:a', null)).toBe('tts:b');
  });
  it('is null with no usable engine', () => {
    expect(generatedChoice([st('recorded', true), st('tts:a', false, 'no-voice')], 'auto', null)).toBeNull();
    expect(generatedChoice([], 'auto', null)).toBeNull();
  });
});

describe('choiceOfUi', () => {
  it('passes auto/recorded through and maps generated', () => {
    const list = [st('recorded', true), st('tts:a', true)];
    expect(choiceOfUi('auto', list, 'recorded', null)).toBe('auto');
    expect(choiceOfUi('recorded', list, 'auto', null)).toBe('recorded');
    expect(choiceOfUi('generated', list, 'recorded', 'recorded')).toBe('tts:a');
    expect(choiceOfUi('generated', [st('recorded', true)], 'auto', null)).toBeNull();
  });
});

describe('uiOptions', () => {
  it('everything usable: nothing disabled', () => {
    const o = uiOptions([st('recorded', true), st('tts:a', true)], 'KJV', 'en', t);
    expect(o.map(x => [x.id, x.disabled])).toEqual([['auto', false], ['recorded', false], ['generated', false]]);
    expect(o.every(x => x.reason === undefined)).toBe(true);
  });
  it('no recording: Recorded is disabled with the reason', () => {
    const o = uiOptions([st('recorded', false, 'no-recording'), st('tts:a', true)], 'KJV', 'en', t);
    expect(o[1]).toMatchObject({ id: 'recorded', disabled: true, reason: 'audio.source.noRecording{"module":"KJV"}' });
    expect(o[2].disabled).toBe(false);
  });
  it('no usable engine: Generated is disabled with the first engine reason', () => {
    const o = uiOptions([st('recorded', true), st('tts:a', false, 'browser'), st('tts:b', false, 'no-voice')], 'KJV', 'en', t);
    expect(o[2]).toMatchObject({ id: 'generated', disabled: true, reason: 'audio.source.browserUnsupported{"engine":"A"}' });
    expect(o[0].disabled).toBe(false);
  });
  it('no providers at all: Recorded and Generated disabled, Auto stays enabled', () => {
    const o = uiOptions([], 'KJV', 'en', t);
    expect(o.map(x => x.disabled)).toEqual([false, true, true]);
    expect(o[1].reason).toContain('noRecording');
    expect(o[2].reason).toContain('noGenerated');
  });
});
