// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setReciteEnabledForTests } from '../src/core/features';
import type { PlanView, SettingsView, SpeechAvailability } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import { renderSettings, updateSpeechBanner } from '../src/ui/settingsView';

const READY: SpeechAvailability = { state: 'ready', missingPermissions: [], engineLabel: 'Whisper', onDevice: true, handsFree: true };
const DOWNLOAD: SpeechAvailability = { ...READY, state: 'needs-download' };
const RECITE = { strictness: 'normal', promptStyle: 'reference', reciteReference: 'off', feedback: 'brief', readBack: false, autoAdvance: false, voiceCommands: false, hintDelayMs: 5000 };

function host(reply: unknown = { ok: true, data: {} }) {
  return { go: vi.fn(), reload: vi.fn(), announce: vi.fn(), request: vi.fn(async () => reply) } as unknown as PanelHost & {
    request: ReturnType<typeof vi.fn>;
    announce: ReturnType<typeof vi.fn>;
  };
}
const plan = { passages: [], speech: READY } as unknown as PlanView;
const settings = (over: Record<string, unknown> = {}) => ({ defaultAnswerMode: 'firstLetter', ...over }) as unknown as SettingsView;
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

afterEach(() => {
  setReciteEnabledForTests(true);
  document.body.innerHTML = '';
});

describe('Settings: Move on automatically', () => {
  it('is on by default and saves via setAutoAdvance', async () => {
    const h = host();
    const root = renderSettings(h, settings(), plan);
    const box = root.querySelector<HTMLInputElement>('#sm-move-on')!;
    expect(box.checked).toBe(true);
    expect(root.querySelector('.sm-move-on')!.closest('.sm-block')!.textContent).toContain('Answering');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await flush();
    expect(h.request).toHaveBeenCalledWith({ type: 'setAutoAdvance', on: false });
  });

  it('reflects an off setting and reverts when the save fails', async () => {
    const h = host({ ok: false, error: 'nope' });
    const root = renderSettings(h, settings({ autoAdvance: false }), plan);
    const box = root.querySelector<HTMLInputElement>('#sm-move-on')!;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    expect(box.checked).toBe(false);
    expect(h.announce).toHaveBeenCalledWith('nope');
  });
});

describe('Settings: speech availability', () => {
  it('shows a neutral checking state, not a download claim, while availability is unknown', () => {
    setReciteEnabledForTests(true);
    const unknown = { state: 'unavailable', missingPermissions: [], engineLabel: '', onDevice: true, handsFree: false, unknown: true } as SpeechAvailability;
    const root = renderSettings(host(), settings({ recite: RECITE, speech: unknown }), plan);
    expect(root.querySelector('[data-speech-state]')!.getAttribute('data-speech-state')).toBe('checking');
    expect(root.textContent).not.toContain('needs to be downloaded');
    expect(root.textContent).not.toContain('Ready to listen');
  });

  it('uses settings.speech, falling back to the cached plan value', () => {
    setReciteEnabledForTests(true);
    const own = renderSettings(host(), settings({ recite: RECITE, speech: DOWNLOAD }), plan);
    expect(own.querySelector('[data-speech-state]')!.getAttribute('data-speech-state')).toBe('needs-download');
    const cached = renderSettings(host(), settings({ recite: RECITE }), plan);
    expect(cached.querySelector('[data-speech-state]')!.getAttribute('data-speech-state')).toBe('ready');
  });

  it('updateSpeechBanner swaps the banner in place on a push', () => {
    const root = renderSettings(host(), settings({ recite: RECITE, speech: DOWNLOAD }), plan);
    updateSpeechBanner(root, host(), READY);
    const banners = root.querySelectorAll('[data-speech-state]');
    expect(banners).toHaveLength(1);
    expect(banners[0]!.getAttribute('data-speech-state')).toBe('ready');
  });
});
