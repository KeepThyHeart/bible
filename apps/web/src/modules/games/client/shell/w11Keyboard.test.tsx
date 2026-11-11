// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../../shared/theme.js';
import type { ControlPanel, RoomSettings, SnapshotCommon } from '../../shared/protocol.js';
import { ClockContext, type ClockPort } from './clockPort.js';
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
  teamCount: 2, openEnded: false, autoAdvanceMs: null, scoresAfterEachAnswer: true,
  showIndividualScores: false, solo: false, groupVote: false, familiarity: 'broad', gameOptions: {}, theme: DEFAULT_THEME,
};
const panel: ControlPanel = {
  pendingJudge: null, requests: [], answeredCount: 0, standings: [], teamStandings: [], overallStandings: [], spent: [], answer: null,
};
const common = { paused: false, phase: 'reveal', settings, players: [], round: 0, totalRounds: 3 } as unknown as SnapshotCommon;

function key(target: Element | null, k: string): void {
  act(() => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

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
          <HostFrame snapshot={snap} status="open" reveal={null} isOwner={true} onReclaim={() => undefined} onReconnectNow={() => undefined}>
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
