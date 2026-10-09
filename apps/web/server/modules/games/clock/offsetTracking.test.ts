import { describe, it, expect } from 'vitest';
import { OffsetTracker, correctBuzzTime } from './offsetTracking.js';

const REVEAL = 1_700_000_000_000;
const RECEIVED = REVEAL + 900;

describe('correctBuzzTime', () => {
  it('translates a client timestamp into server time when it lands in range', () => {
    const result = correctBuzzTime(REVEAL + 400 - 5_000, 5_000, REVEAL, RECEIVED);
    expect(result).toEqual({ correctedAt: REVEAL + 400, clamped: false });
  });

  it('clamps a buzz that claims to precede the reveal', () => {
    // A phone running 200ms behind what it reported: the corrected figure
    // lands before the question existed, which cannot have happened.
    const result = correctBuzzTime(REVEAL - 200 - 5_000, 5_000, REVEAL, RECEIVED);
    expect(result).toEqual({ correctedAt: REVEAL, clamped: true });
  });

  it('clamps a buzz that claims to follow the moment the server heard it', () => {
    const result = correctBuzzTime(RECEIVED + 300 - 5_000, 5_000, REVEAL, RECEIVED);
    expect(result).toEqual({ correctedAt: RECEIVED, clamped: true });
  });

  it('treats the interval as closed at both edges', () => {
    expect(correctBuzzTime(REVEAL, 0, REVEAL, RECEIVED)).toEqual({
      correctedAt: REVEAL,
      clamped: false,
    });
    expect(correctBuzzTime(RECEIVED, 0, REVEAL, RECEIVED)).toEqual({
      correctedAt: RECEIVED,
      clamped: false,
    });
  });

  it('cannot be improved by inventing an offset', () => {
    // Claiming to have buzzed a full second before the reveal earns the reveal
    // instant, which is the best anyone can do, and it is flagged.
    const cheat = correctBuzzTime(REVEAL - 1_000, 0, REVEAL, RECEIVED);
    const honest = correctBuzzTime(REVEAL + 10, 0, REVEAL, RECEIVED);
    expect(cheat.correctedAt).toBe(REVEAL);
    expect(cheat.clamped).toBe(true);
    expect(honest.correctedAt).toBeGreaterThan(cheat.correctedAt);
  });

  it('falls back to the receipt when the bounds themselves disagree', () => {
    const result = correctBuzzTime(REVEAL, 0, RECEIVED + 1, RECEIVED);
    expect(result).toEqual({ correctedAt: RECEIVED, clamped: true });
  });
});

describe('OffsetTracker', () => {
  const player = 'player-1';

  it('assumes agreement for a player who has not reported', () => {
    const tracker = new OffsetTracker();
    expect(tracker.offsetFor(player)).toBe(0);
    expect(tracker.clockFor(player)).toBeNull();
    expect(tracker.trusted(player)).toBe(false);
  });

  it('takes the first report whole', () => {
    const tracker = new OffsetTracker();
    const clock = tracker.report(player, { offsetMs: 120, rttMs: 40, spreadMs: 8 }, REVEAL);
    expect(clock.offsetMs).toBe(120);
    expect(clock.reports).toBe(1);
    expect(tracker.offsetFor(player)).toBe(120);
  });

  it('rolls a later report in rather than replacing the stored offset', () => {
    const tracker = new OffsetTracker();
    tracker.report(player, { offsetMs: 100, rttMs: 40, spreadMs: 8 }, REVEAL);
    tracker.report(player, { offsetMs: 200, rttMs: 40, spreadMs: 8 }, REVEAL + 1_000);

    // Moved toward the new reading without jumping to it.
    expect(tracker.offsetFor(player)).toBeGreaterThan(100);
    expect(tracker.offsetFor(player)).toBeLessThan(200);
    expect(tracker.clockFor(player)?.reports).toBe(2);
  });

  it('adopts a large movement whole, because that is a reset and not drift', () => {
    const tracker = new OffsetTracker();
    tracker.report(player, { offsetMs: 100, rttMs: 40, spreadMs: 8 }, REVEAL);
    tracker.report(player, { offsetMs: 45_000, rttMs: 40, spreadMs: 8 }, REVEAL + 1_000);

    expect(tracker.offsetFor(player)).toBe(45_000);
    expect(tracker.clockFor(player)?.reports).toBe(1);
  });

  it('distrusts a measurement taken over a slow or noisy link', () => {
    const tracker = new OffsetTracker();
    tracker.report(player, { offsetMs: 100, rttMs: 30, spreadMs: 12 }, REVEAL);
    expect(tracker.trusted(player)).toBe(true);

    tracker.report(player, { offsetMs: 110, rttMs: 30, spreadMs: 900 }, REVEAL + 1);
    expect(tracker.trusted(player)).toBe(false);

    tracker.report(player, { offsetMs: 110, rttMs: 1_800, spreadMs: 10 }, REVEAL + 2);
    expect(tracker.trusted(player)).toBe(false);
  });

  it('corrects a buzz with the offset stored for that player', () => {
    const tracker = new OffsetTracker();
    tracker.report(player, { offsetMs: 5_000, rttMs: 30, spreadMs: 10 }, REVEAL);

    const result = tracker.correct(player, REVEAL + 250 - 5_000, REVEAL, RECEIVED);
    expect(result).toEqual({ correctedAt: REVEAL + 250, clamped: false });
  });

  it('orders two buzzes by reaction time rather than by arrival', () => {
    const tracker = new OffsetTracker();
    // Two phones, wildly different clocks and wildly different connections.
    tracker.report('quick', { offsetMs: -30_000, rttMs: 20, spreadMs: 5 }, REVEAL);
    tracker.report('slow', { offsetMs: 8_000, rttMs: 20, spreadMs: 5 }, REVEAL);

    // The quick player reacted in 300ms but their message took 500ms to land;
    // the slow player reacted in 450ms over a fast link.
    const quick = tracker.correct('quick', REVEAL + 300 + 30_000, REVEAL, REVEAL + 800);
    const slow = tracker.correct('slow', REVEAL + 450 - 8_000, REVEAL, REVEAL + 470);

    expect(quick.correctedAt).toBe(REVEAL + 300);
    expect(slow.correctedAt).toBe(REVEAL + 450);
    expect(quick.correctedAt).toBeLessThan(slow.correctedAt);
    expect(quick.clamped).toBe(false);
    expect(slow.clamped).toBe(false);
  });

  it('forgets a player on request', () => {
    const tracker = new OffsetTracker();
    tracker.report(player, { offsetMs: 100, rttMs: 30, spreadMs: 5 }, REVEAL);
    tracker.forget(player);
    expect(tracker.clockFor(player)).toBeNull();
  });
});
