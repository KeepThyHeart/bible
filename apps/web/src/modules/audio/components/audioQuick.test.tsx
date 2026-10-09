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
}));

import { audioStore } from '../audioStore';
import { buildUiRig, flush, openChapter } from '../lib/uiRig';
import type { UiRig } from '../lib/uiRig';
import type { SourceStatus } from '../lib/AudioSourceResolver';
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

const radio = (name: string) => screen.getByRole('radio', { name });

describe('AudioQuickSettings: source', () => {
  it('Generated writes tts:<id> for this translation even when a recording exists', async () => {
    await start({ recordings: true });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" />);
    await waitFor(() => expect((radio('audio.source.generated') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(radio('audio.source.generated'));
    expect(audioStore.prefs.perTranslation.KJV?.source).toBe('tts:fake');
    await waitFor(() => expect(radio('audio.source.generated').getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(radio('audio.source.recorded'));
    expect(audioStore.prefs.perTranslation.KJV?.source).toBe('recorded');
    fireEvent.click(radio('audio.source.auto'));
    expect(audioStore.prefs.perTranslation.KJV?.source).toBe('auto');
  });

  it('shows why Recorded is unavailable inline, not only as a tooltip', async () => {
    await start({ recordings: false });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="phone" />);
    await waitFor(() => expect(screen.getByTestId('audio-source-reasons')).toBeTruthy());
    const rec = radio('audio.source.recorded') as HTMLButtonElement;
    expect(rec.disabled).toBe(true);
    expect(screen.getByTestId('audio-source-reasons').textContent).toContain('audio.source.noRecording');
    fireEvent.click(rec);
    expect(audioStore.prefs.perTranslation.KJV?.source).toBeUndefined();
  });

  it('with no engine, Generated is disabled and says why', async () => {
    await start({ recordings: true, engine: false });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="phone" />);
    await waitFor(() => expect((radio('audio.source.generated') as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByTestId('audio-source-reasons').textContent).toContain('audio.source.noGenerated');
  });
});

describe('AudioQuickSettings: the rest', () => {
  it('offers a voice select only for two or more voices, and writes the engine voice', async () => {
    await start({ recordings: true });
    rig.tts.voiceList = [
      { id: 'amy', label: 'Amy', language: 'en-US' },
      { id: 'ben', label: 'Ben', language: 'en-US' },
    ];
    audioStore.setTranslationSource('KJV', 'tts:fake');
    audioStore.invalidateSources('KJV');
    render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" />);
    const select = await screen.findByLabelText('audio.voice.label') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ben' } });
    expect(audioStore.prefs.voiceByEngineLang['fake:en']).toBe('ben');
  });

  it('has no voice select with one voice, and no engine select with one engine', async () => {
    await start({ recordings: true });
    audioStore.setTranslationSource('KJV', 'tts:fake');
    render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" />);
    await waitFor(() => expect(radio('audio.source.generated').getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByLabelText('audio.voice.label')).toBeNull();
    expect(screen.queryByLabelText('audio.source.engine')).toBeNull();
  });

  it('Player Bar/Pop-up only on desktop', async () => {
    await start({ recordings: true });
    const { unmount } = render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" />);
    fireEvent.click(radio('audio.style.bar'));
    expect(audioStore.prefs.playerStyle).toBe('bar');
    fireEvent.click(radio('audio.style.popup'));
    expect(audioStore.prefs.playerStyle).toBe('popup');
    unmount();
    render(<AudioQuickSettings moduleAbbr="KJV" variant="phone" />);
    expect(screen.queryByRole('radio', { name: 'audio.style.bar' })).toBeNull();
  });

  it('"All audio settings" calls onOpenSettings("audio")', async () => {
    await start({ recordings: true });
    const open = vi.fn();
    render(<AudioQuickSettings moduleAbbr="KJV" variant="desktop" onOpenSettings={open} />);
    fireEvent.click(screen.getByText(/audio.quick.all/));
    expect(open).toHaveBeenCalledWith('audio');
  });
});

describe('EngineSelect', () => {
  const s = (id: string, usable: boolean) => ({ provider: { id, kind: 'tts', label: id.slice(4) }, usable, voices: [] }) as unknown as SourceStatus;
  it('renders only with two or more usable engines, and reports tts:<id>', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<EngineSelect id="e" sources={[s('tts:a', true), s('tts:b', false)]} value="tts:a" onChange={onChange} />);
    expect(container.querySelector('select')).toBeNull();
    rerender(<EngineSelect id="e" sources={[s('tts:a', true), s('tts:b', true)]} value="tts:a" onChange={onChange} />);
    fireEvent.change(container.querySelector('select')!, { target: { value: 'tts:b' } });
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
    expect(btn.textContent).toBe('1.0×');
    expect(screen.queryByLabelText('audio.speed.slower')).toBeNull(); // no +/- steppers
    fireEvent.click(btn);
    const list = await screen.findByRole('listbox');
    const opts = Array.from(list.querySelectorAll('[role="option"]')).map(o => o.textContent);
    expect(opts).toEqual(['0.5×', '0.75×', '1.0×', '1.25×', '1.5×', '1.75×', '2.0×']);
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toBe('1.0×');
    fireEvent.click(Array.from(list.querySelectorAll('[role="option"]')).find(o => o.textContent === '1.5×')!);
    await waitFor(() => expect(audioStore.prefs.rate).toBe(1.5));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByTestId('audio-speed-button').textContent).toBe('1.5×');
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
