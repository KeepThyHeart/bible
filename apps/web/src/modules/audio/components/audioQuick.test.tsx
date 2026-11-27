/** Quick settings (popover/sheet content), the source control and the speed stepper. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}${JSON.stringify(opts)}` : key),
    i18n: { language: 'en' },
  }),
}));

// The real Popover pulls in preact/compat, which breaks change events on the plain selects tested here.
vi.mock('@bible/ui', () => ({
  Popover: ({ open, children }: { open: boolean; children: preact.ComponentChildren }) => (open ? <div role="dialog">{children}</div> : null),
  SettingsForm: ({ fields }: { fields: Array<{ key: string }> }) => <div data-testid="settings-form">{fields.map(f => <span key={f.key} data-key={f.key} />)}</div>,
}));

import { audioStore } from '../audioStore';
import { buildUiRig, flush, openChapter } from '../lib/uiRig';
import type { UiRig } from '../lib/uiRig';
import type { SourceStatus } from '@bible/audio';
import { AudioQuickSettings } from './AudioQuickSettings';
import { AudioSpeedControl } from './AudioSpeedControl';
import { EngineSelect } from './AudioControls';
import { sourceChipText } from './sourceChip';

let rig: UiRig;

async function start(opts: Parameters<typeof buildUiRig>[0] = {}) {
  rig = buildUiRig(opts);
  await openChapter();
  await flush();
}

beforeEach(() => { audioStore.reset(); });
afterEach(() => { cleanup(); audioStore.reset(); vi.restoreAllMocks(); });

const choose = (select: Element, value: string) => { fireEvent.change(select, { target: { value } }); };

const sourceSelect = () => screen.getByTestId('audio-quick-source') as HTMLSelectElement;
const option = (value: string) => sourceSelect().querySelector<HTMLOptionElement>(`option[value="${value}"]`)!;

describe('AudioQuickSettings: voice (source)', () => {
  it('one select, recordings first; picking writes the default for every translation and drops the override', async () => {
    await start({ recordings: true });
    audioStore.setTranslationSource('KJV', 'recorded');
    render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" />);
    await waitFor(() => expect(sourceSelect().options.length).toBe(2));
    expect(Array.from(sourceSelect().options).map(o => o.value)).toEqual(['recorded', 'tts:fake']);
    expect(option('recorded').textContent).toBe('audio.source.recordingOption');
    expect(option('tts:fake').textContent).toContain('audio.source.generatedOption');
    choose(sourceSelect(), 'tts:fake');
    expect(audioStore.prefs.source).toBe('tts:fake');
    expect(audioStore.prefs.perTranslation.KJV?.source).toBeUndefined();
  });

  it('an unusable recording is disabled and says why underneath', async () => {
    await start({ recordings: false });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="phone" />);
    await waitFor(() => expect(screen.getByTestId('audio-source-reasons')).toBeTruthy());
    expect(option('recorded').disabled).toBe(true);
    expect(screen.getByTestId('audio-source-reasons').textContent).toContain('audio.source.noRecording');
  });

  it('with no engine, only the recording is offered and nothing about a generated voice shows', async () => {
    await start({ recordings: true, engine: false });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="phone" />);
    await waitFor(() => expect(option('recorded')).toBeTruthy());
    expect(option('tts:fake')?.disabled ?? true).toBe(true);
    expect(screen.queryByTestId('audio-quick-voice-state')).toBeNull();
  });
});

describe('AudioQuickSettings: the rest', () => {
  it('under Generated: a speaker select for two or more voices, which writes the engine voice', async () => {
    await start({ recordings: true });
    rig.tts.voiceList = [
      { id: 'amy', label: 'Amy', language: 'en-US' },
      { id: 'ben', label: 'Ben', language: 'en-US' },
    ];
    audioStore.setPrefs({ source: 'tts:fake' });
    audioStore.invalidateSources('KJV');
    render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" />);
    const select = await screen.findByLabelText('audio.voice.which') as HTMLSelectElement;
    choose(select, 'ben');
    expect(audioStore.prefs.voiceByEngineLang['fake:en']).toBe('ben');
  });

  it('under Generated with one voice: no speaker select, but its state line', async () => {
    await start({ recordings: true });
    audioStore.setPrefs({ source: 'tts:fake' });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" />);
    await waitFor(() => expect(screen.getByTestId('audio-quick-voice-state')).toBeTruthy());
    expect(screen.queryByLabelText('audio.voice.which')).toBeNull();
  });

  it('a recording chosen: no generated-voice settings', async () => {
    await start({ recordings: true });
    audioStore.setPrefs({ source: 'recorded' });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" />);
    await waitFor(() => expect(sourceSelect().value).toBe('recorded'));
    expect(screen.queryByTestId('audio-quick-voice-state')).toBeNull();
  });

  it('the while-playing switches, without "continue" (a toggle on the player)', async () => {
    await start({ recordings: true });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="phone" />);
    const keys = Array.from((await screen.findByTestId('settings-form')).querySelectorAll('[data-key]')).map(e => e.getAttribute('data-key'));
    expect(keys).toContain('followAlong');
    expect(keys).not.toContain('continueToNextChapter');
  });

  it('no Player style setting: the bar and the full player switch with their own buttons', async () => {
    await start({ recordings: true });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" />);
    expect(screen.queryByRole('radio', { name: 'audio.style.bar' })).toBeNull();
  });
});

describe('EngineSelect', () => {
  const s = (id: string, usable: boolean) => ({ provider: { id, kind: 'tts', label: id.slice(4) }, usable, voices: [] }) as unknown as SourceStatus;
  it('renders only with two or more usable engines, and reports tts:<id>', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<EngineSelect id="e" sources={[s('tts:a', true), s('tts:b', false)]} value="tts:a" onChange={onChange} />);
    expect(container.querySelector('select')).toBeNull();
    rerender(<EngineSelect id="e" sources={[s('tts:a', true), s('tts:b', true)]} value="tts:a" onChange={onChange} />);
    choose(container.querySelector('select')!, 'tts:b');
    expect(onChange).toHaveBeenCalledWith('tts:b');
  });
});

describe('AudioSpeedControl', () => {
  it('is disabled while nothing plays (no speed range)', async () => {
    await start({ recordings: true });
    render(<AudioSpeedControl />);
    expect((screen.getByTestId('audio-speed-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the rate, opens a list of presets and picks one', async () => {
    await start({ recordings: true });
    const p = audioStore.play();
    await flush();
    await p;
    await flush();
    render(<AudioSpeedControl large />);
    expect(screen.getByTestId('audio-speed').className).toContain('audio-speed--large');
    expect(screen.queryByRole('listbox')).toBeNull();
    const btn = screen.getByTestId('audio-speed-button');
    // The large (phone tile) form shows the rate over a "Speed" caption.
    expect(btn.querySelector('.audio-speed__value')?.textContent).toBe('1.0×');
    expect(btn.textContent).toContain('audio.speed.label');
    expect(screen.queryByLabelText('audio.speed.slower')).toBeNull(); // no +/- steppers
    fireEvent.click(btn);
    const list = await screen.findByRole('listbox');
    const opts = Array.from(list.querySelectorAll('[role="option"]')).map(o => o.textContent);
    expect(opts).toEqual(['0.5×', '0.75×', '1.0×', '1.25×', '1.5×', '1.75×', '2.0×']);
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toBe('1.0×');
    fireEvent.click(Array.from(list.querySelectorAll('[role="option"]')).find(o => o.textContent === '1.5×')!);
    await waitFor(() => expect(audioStore.prefs.rate).toBe(1.5));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByTestId('audio-speed-button').querySelector('.audio-speed__value')?.textContent).toBe('1.5×');
  });
});

describe('AudioSpeedControl keyboard', () => {
  it('moves through the speeds with the arrow keys and closes on Escape without the event reaching the window', async () => {
    await start({ recordings: true });
    const p = audioStore.play();
    await flush();
    await p;
    await flush();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<AudioSpeedControl />);
    fireEvent.click(screen.getByTestId('audio-speed-button'));
    const list = await screen.findByRole('listbox');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('1.0×'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('1.25×');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('2.0×');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement?.textContent).toBe('0.5×');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(list.isConnected).toBe(false);
    expect(onWindowKey.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByTestId('audio-speed-button'));
    window.removeEventListener('keydown', onWindowKey);
  });
});

describe('sourceChipText', () => {
  const t = (k: string, o?: Record<string, string>) => (o ? `${k}${JSON.stringify(o)}` : k);
  it('Recorded, Generated with voice, and Generated', () => {
    expect(sourceChipText(t, 'recorded', 'Recorded', undefined, 'KJV')).toBe('audio.chip.recorded{"module":"KJV"}');
    expect(sourceChipText(t, 'tts:piper', 'Piper', 'Amy', 'KJV')).toBe('audio.chip.generatedVoice{"voice":"Amy"}');
    expect(sourceChipText(t, 'tts:piper', 'Piper', undefined, 'KJV')).toBe('audio.chip.generated');
    expect(sourceChipText(t, null, undefined, undefined, 'KJV')).toBe('');
  });
});
