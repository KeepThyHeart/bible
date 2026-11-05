// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../../shared/theme.js';
import type { ControlPanel, RoomSettings, SnapshotCommon } from '../../shared/protocol.js';
import { ClockContext, type ClockPort } from './clockPort.js';
import { ControlBar } from './ControlBar.js';
import { HostLobby } from './HostLobby.js';
import { PhoneFrame } from './PhoneFrame.js';
import { HostFrame } from './HostFrame.js';
import { TimerBar } from './TimerBar.js';

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

const clockFor = (ms: number): ClockPort => ({
  serverNow: () => 0,
  msUntil: () => ms,
  showAt: () => () => undefined,
  report: () => null,
  onChange: () => () => undefined,
});

const settings: RoomSettings = {
  gameId: 'case', setId: null, translation: 'KJV', teamsEnabled: false, rounds: 10, answerWindowMs: 20_000,
  showIndividualScores: false, solo: false, groupVote: false, familiarity: 'broad', gameOptions: {}, theme: DEFAULT_THEME,
};
const panel: ControlPanel = {
  pendingJudge: null, requests: [], answeredCount: 0, standings: [], teamStandings: [], overallStandings: [], spent: [],
};
const common = { paused: false, phase: 'reveal', settings, players: [], round: 0, totalRounds: 3 } as unknown as SnapshotCommon;

function key(target: Element | null, k: string): void {
  act(() => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

describe('Room menu keyboard model', () => {
  function draw(): void {
    act(() => {
      render(<ControlBar common={common} panel={panel} reveal={null} fullStandings={null} onCommand={() => undefined} />, host);
    });
  }
  const toggle = () => host.querySelector<HTMLButtonElement>('.host-menu-toggle')!;

  it('opens, focuses the first item, moves with arrows, closes on Escape back to the button', () => {
    draw();
    act(() => toggle().click());
    const items = () => [...host.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0], 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1], 'End');
    expect(document.activeElement).toBe(items()[items().length - 1]);
    key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    key(document.activeElement, 'Escape');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
  });

  it('opens on ArrowDown from the button', () => {
    draw();
    toggle().focus();
    key(toggle(), 'ArrowDown');
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('the scores item is a checkbox with a stable name', () => {
    draw();
    act(() => toggle().click());
    const item = host.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!;
    expect(item.getAttribute('aria-checked')).toBe('false');
    expect(item.hasAttribute('aria-pressed')).toBe(false);
    expect(item.textContent).not.toMatch(/everyone$|top three/i);
  });

  it('closes when an item opens a dialog', () => {
    draw();
    act(() => toggle().click());
    const manage = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === 'Manage players')!;
    act(() => manage.click());
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('host settings toggles', () => {
  it('Teams has a stable name and aria-pressed', () => {
    const snapshot = { viewer: 'screen', code: 'QK7P', phase: 'lobby', paused: false, round: -1, totalRounds: 10, settings, players: [], controller: { kind: 'owner' }, standings: [], teamStandings: [], overallStandings: [], control: panel } as never;
    act(() => {
      render(
        <HostLobby snapshot={snapshot} catalog={{ games: [], sets: [], translations: ['KJV'] }} catalogLoaded={true}
          joinUrl="https://x.test/j" isOwner={true} onSettings={() => undefined} onStart={() => undefined} onReclaim={() => undefined} />,
        host
      );
    });
    const label = host.querySelector('#lobby-teams-label')!;
    const btn = host.querySelector<HTMLButtonElement>('[aria-labelledby="lobby-teams-label"]')!;
    expect(label.textContent).toBe('Teams');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toBe('Off');
  });
});

describe('timer plural', () => {
  const text = (ms: number): string | null => {
    act(() => {
      render(
        <ClockContext.Provider value={clockFor(ms)}>
          <TimerBar endsAt={10_000} durationMs={10_000} paused={false} />
        </ClockContext.Provider>,
        host
      );
    });
    return host.querySelector('[role="progressbar"]')!.getAttribute('aria-valuetext');
  };
  it('reads 1 second, not 1 seconds', () => {
    expect(text(1000)).toBe('1 second left');
    expect(text(5000)).toBe('5 seconds left');
  });
});

describe('focus after Start game', () => {
  it('HostFrame and PhoneFrame move lost focus into the game screen', () => {
    const snap = { ...common, code: 'AB', phase: 'question', phaseEndsAt: null, phaseDurationMs: null, controller: { kind: 'owner' }, answeredCount: 0, you: null } as never;
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      render(
        <ClockContext.Provider value={clockFor(1000)}>
          <HostFrame snapshot={snap} status="open" reveal={null} fullStandings={null} isOwner={true} onCommand={() => undefined} onReconnectNow={() => undefined}>
            <p>screen</p>
          </HostFrame>
        </ClockContext.Provider>,
        host
      );
    });
    expect(document.activeElement).toBe(host.querySelector('main'));
    act(() => render(null, host));
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      render(
        <ClockContext.Provider value={clockFor(1000)}>
          <PhoneFrame snapshot={{ ...(snap as object), you: { id: 'p', name: 'R', teamId: null, connected: true } } as never} yourResult={null} status="open" onReconnectNow={() => undefined} actions={null as never}>
            <p>screen</p>
          </PhoneFrame>
        </ClockContext.Provider>,
        host
      );
    });
    expect(document.activeElement).toBe(host.querySelector('main'));
  });
});
