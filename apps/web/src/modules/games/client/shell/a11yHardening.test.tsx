// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIGHT_THEME, THEME_PRESETS } from '../../shared/theme.js';
import type { ThemeTokens } from '../../shared/theme.js';
import { Brand } from './Brand.js';
import { JoinScreen } from './JoinScreen.js';
import { PhoneHeaderActions } from './PhoneHeaderActions.js';
import { ThemeEditor } from './ThemeEditor.js';
import type { ThemeControl } from './theme.js';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

function key(target: Element | null, k: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

describe('PhoneHeaderActions dialogs', () => {
  const control: ThemeControl = { theme: LIGHT_THEME, isOverridden: false, setOverride: () => undefined };

  function draw(): void {
    act(() => {
      render(<PhoneHeaderActions code="5HK27" joinUrl="https://x.test/play?room=5HK27" themeControl={control} onLeave={() => undefined} />, host);
    });
  }
  const opener = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button.icon-button')].find((b) => b.textContent?.includes(name))!;

  it('Settings is a modal dialog: focus moves in, background is inert, Escape closes and focus returns to the opener', async () => {
    draw();
    const settings = opener('Settings');
    settings.focus();
    act(() => settings.click());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(opener('Leave').hasAttribute('inert')).toBe(true);
    key(document.body, 'Escape');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener('Settings'));
  });

  it('Leave -> Stay returns focus to the Leave button', async () => {
    draw();
    const leave = opener('Leave');
    leave.focus();
    act(() => leave.click());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const stay = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Stay')!;
    act(() => stay.click());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(document.activeElement).toBe(opener('Leave'));
  });

  it('the Theme button names the current theme', () => {
    draw();
    expect(opener('Theme').getAttribute('aria-label')).toContain('Light');
  });
});

describe('ThemeEditor radios', () => {
  it('uses radio semantics with a roving tabindex and arrow keys', () => {
    const picked: ThemeTokens[] = [];
    act(() => {
      render(<ThemeEditor theme={LIGHT_THEME} onChange={(t) => picked.push(t)} label="Room theme" />, host);
    });
    const radios = [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.length).toBeGreaterThan(1);
    expect(radios.some((r) => r.hasAttribute('aria-pressed'))).toBe(false);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(radios.map((r, i) => (i === 0 ? 'true' : 'false')));
    expect(radios.map((r) => r.tabIndex)).toEqual(radios.map((_, i) => (i === 0 ? 0 : -1)));
    radios[0]!.focus();
    key(radios[0]!, 'ArrowRight');
    expect(picked).toEqual([THEME_PRESETS['dark']]);
    expect(document.activeElement).toBe(radios[1]);
  });
});

describe('JoinScreen validation', () => {
  it('explains the code format when Enter is pressed with an unusable code', () => {
    act(() => {
      render(<JoinScreen initialCode="" initialName="Ann" busy={false} error={null} onJoin={() => undefined} onSolo={() => undefined} />, host);
    });
    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('');
    const input = host.querySelector<HTMLInputElement>('input[name="room-code"]')!;
    act(() => {
      input.value = 'zzzzz';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('[role="status"]')!.textContent).toContain('5 letters and numbers');
  });
});

describe('Brand heading focus', () => {
  it('takes focus on mount when focus was lost to the body', async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      render(<Brand />, host);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(document.activeElement).toBe(host.querySelector('h1'));
  });
});
