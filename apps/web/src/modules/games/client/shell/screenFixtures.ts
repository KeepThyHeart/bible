/** Snapshots for the shared-screen tests. Test support only. */

import type { ControlPanel, ScreenSnapshot } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import type { ClockPort } from './clockPort.js';

export function controlPanel(overrides: Partial<ControlPanel> = {}): ControlPanel {
  return {
    pendingJudge: null,
    requests: [],
    answeredCount: 0,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    spent: [],
    answer: null,
    ...overrides,
  };
}

/** A screen that does not hold control, unless a test gives it a `control`. */
export function screenSnapshot(overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'QK7P',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 10,
    settings: {
      gameId: 'fill-in-the-blank',
      setId: null,
      translation: 'KJV',
      teamsEnabled: false,
      rounds: 10,
      answerWindowMs: 20_000,
      teamCount: 2,
      openEnded: false,
      autoAdvanceMs: null,
      scoresAfterEachAnswer: true,
      showIndividualScores: false,
      solo: false,
      groupVote: false,
      familiarity: 'broad',
      gameOptions: {},
      theme: DEFAULT_THEME,
    },
    players: [],
    controller: { kind: 'owner' },
    questionOnScreen: true,
    phaseEndsAt: 50_000,
    phaseDurationMs: 20_000,
    revealAt: null,
    serverTime: 40_000,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 0,
    view: null,
    buzz: null,
    ...overrides,
  };
}

/** A clock whose "now" a test sets by hand. */
export function handClock(state: { now: number }): ClockPort {
  return {
    serverNow: () => state.now,
    msUntil: (at) => Math.max(0, at - state.now),
    showAt: () => () => undefined,
    report: () => null,
    onChange: () => () => undefined,
  };
}
