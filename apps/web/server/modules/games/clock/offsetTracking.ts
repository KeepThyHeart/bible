/**
 * The server's view of each player's clock.
 *
 * A player's phone measures how far its clock sits from the server's and
 * reports that number. The server keeps it, because it is what turns a
 * self-reported buzz timestamp into something comparable across the room:
 * ordering buzzes by the moment the server heard them ranks players by their
 * connection, which over cellular means ranking by who is nearest the window.
 *
 * A reported offset is not trusted on its word. It is applied inside a bound
 * that no honest buzz can leave — a buzz cannot have happened before the
 * question was revealed, and cannot have happened after the server heard it —
 * so the worst a wrong or invented offset can achieve is to land the player on
 * one edge of that interval, flagged.
 */

import type { PlayerId, ServerTime } from '../../../../src/modules/games/shared/protocol.js';

/** What a client reports after a measurement. */
export interface ClockReport {
  /** Add to one of this client's timestamps to get server time. */
  offsetMs: number;
  /** Round trip of the winning sample, so a wide one can be discounted. */
  rttMs: number;
  /** Disagreement across that client's samples: its own confidence signal. */
  spreadMs: number;
}

export interface PlayerClock {
  offsetMs: number;
  rttMs: number;
  spreadMs: number;
  /** How many reports have gone into this figure. */
  reports: number;
  updatedAt: ServerTime;
}

/**
 * How much of each new report is taken. Successive measurements from the same
 * phone differ mostly by measurement noise, so most of the stored value is
 * kept and the new one nudges it; a single unlucky sample cannot swing the
 * offset a player's buzzes are corrected by.
 */
const SMOOTHING = 0.35;

/**
 * Beyond this much movement the phone did not drift, it jumped: a suspend, a
 * timezone-service correction, a user setting the clock. Averaging across a
 * jump gives a figure that was never true, so the new reading is adopted
 * whole and the history discarded.
 */
const JUMP_THRESHOLD_MS = 1_000;

/**
 * A round trip this wide leaves the offset uncertain by roughly half of it,
 * which is more than the gap between two people buzzing on the same word.
 */
const TRUSTWORTHY_RTT_MS = 400;

/** Sample-to-sample disagreement above this says the link was too noisy. */
const TRUSTWORTHY_SPREAD_MS = 250;

export interface CorrectedBuzz {
  /** Where the buzz sits on the server's clock, after correction and clamping. */
  correctedAt: ServerTime;
  /** True when the raw figure fell outside the honest interval. */
  clamped: boolean;
}

/**
 * Translate a client-reported buzz timestamp into server time and hold it
 * inside the only interval it can honestly occupy.
 *
 * The reveal is the earliest a buzz can be: nobody can react to a question
 * before it exists. The moment the server received the intent is the latest:
 * the buzz necessarily happened before the message carrying it arrived.
 * Anything outside is provably wrong, whether from a bad offset, a phone whose
 * clock moved between measurement and buzz, or someone editing the number, and
 * gets pulled to the nearer edge rather than thrown away — a buzz that really
 * happened should still count, just not out of order. The flag travels with it
 * so that systematic clock trouble is visible instead of quietly deciding
 * rounds.
 */
export function correctBuzzTime(
  reportedClientTime: number,
  offsetMs: number,
  revealAt: ServerTime,
  receivedAt: ServerTime
): CorrectedBuzz {
  // A reveal after the receipt means the caller's own bounds disagree; the
  // receipt is the one the server observed directly, so it wins.
  if (revealAt > receivedAt) return { correctedAt: receivedAt, clamped: true };

  const raw = reportedClientTime + offsetMs;
  if (raw < revealAt) return { correctedAt: revealAt, clamped: true };
  if (raw > receivedAt) return { correctedAt: receivedAt, clamped: true };
  return { correctedAt: raw, clamped: false };
}

/**
 * Per-player clock offsets, held for the life of a room.
 *
 * Keyed by player rather than by connection: a phone that reloads and rejoins
 * is the same player and its clock did not change, so the offset it measured
 * before the reload is still the best thing available until the fresh
 * measurement lands.
 */
export class OffsetTracker {
  private readonly clocks = new Map<PlayerId, PlayerClock>();

  /**
   * Fold a fresh report into what is known about this player's clock. Returns
   * the stored figure so a caller can log or project it without a second
   * lookup.
   */
  report(playerId: PlayerId, report: ClockReport, at: ServerTime): PlayerClock {
    const previous = this.clocks.get(playerId);
    const jumped = previous !== undefined && Math.abs(report.offsetMs - previous.offsetMs) > JUMP_THRESHOLD_MS;

    const offsetMs =
      previous === undefined || jumped
        ? report.offsetMs
        : previous.offsetMs + SMOOTHING * (report.offsetMs - previous.offsetMs);

    const clock: PlayerClock = {
      offsetMs,
      // The freshest measurement's own quality is what matters for judging the
      // next buzz, so these are replaced rather than smoothed.
      rttMs: report.rttMs,
      spreadMs: report.spreadMs,
      reports: previous === undefined || jumped ? 1 : previous.reports + 1,
      updatedAt: at,
    };
    this.clocks.set(playerId, clock);
    return clock;
  }

  /**
   * The offset to correct this player's timestamps by. Zero for a player who
   * has not reported one: assuming the clocks agree leaves the clamp to catch
   * whatever that assumption costs.
   */
  offsetFor(playerId: PlayerId): number {
    return this.clocks.get(playerId)?.offsetMs ?? 0;
  }

  clockFor(playerId: PlayerId): PlayerClock | null {
    return this.clocks.get(playerId) ?? null;
  }

  /**
   * Whether this player's buzz times are worth ranking on. False for a player
   * who never reported, and for one whose measurement was too noisy to mean
   * anything. It does not exclude anyone — it marks a result to be sceptical of.
   */
  trusted(playerId: PlayerId): boolean {
    const clock = this.clocks.get(playerId);
    if (!clock) return false;
    return clock.rttMs <= TRUSTWORTHY_RTT_MS && clock.spreadMs <= TRUSTWORTHY_SPREAD_MS;
  }

  /**
   * Apply this player's stored offset to a buzz. The one call the transport
   * needs: it knows the player, the reported time, the reveal and when the
   * intent arrived, and nothing else about clocks.
   */
  correct(
    playerId: PlayerId,
    reportedClientTime: number,
    revealAt: ServerTime,
    receivedAt: ServerTime
  ): CorrectedBuzz {
    return correctBuzzTime(reportedClientTime, this.offsetFor(playerId), revealAt, receivedAt);
  }

  forget(playerId: PlayerId): void {
    this.clocks.delete(playerId);
  }

  clear(): void {
    this.clocks.clear();
  }
}
