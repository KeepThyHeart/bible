/**
 * The rules, shown on the big screen once before a game's first question.
 *
 * What it says comes from the game's registered `howToPlay` (a summary line and
 * a few steps); a game that has not registered any gets a plain line with its
 * name instead of an empty card. The countdown reads the server's deadline
 * through the clock port, like the timer bar, so every screen agrees on it.
 */

import { useEffect, useState } from 'preact/hooks';
import type { GameId, ServerTime } from '../../shared/protocol.js';
import { useClock } from './clockPort.js';
import { getGameViews } from './gameViews.js';
import { gt } from './t.js';

export interface HowToPlayProps {
  gameId: GameId;
  /** The game's name as the room reads it. */
  name: string;
  /** When the intro ends, or null when it waits on the organizer. */
  endsAt: ServerTime | null;
  paused: boolean;
}

/** How often the countdown re-reads the clock; whole seconds only change on this grid. */
const TICK_MS = 250;

function useSecondsLeft(endsAt: ServerTime | null, paused: boolean): number | null {
  const clock = useClock();
  const [seconds, setSeconds] = useState<number | null>(() =>
    endsAt === null ? null : Math.ceil(clock.msUntil(endsAt) / 1000)
  );

  useEffect(() => {
    if (endsAt === null) {
      setSeconds(null);
      return undefined;
    }
    const read = () => setSeconds(Math.ceil(clock.msUntil(endsAt) / 1000));
    read();
    // The deadline does not move while paused but the clock does, so a pause
    // reads once and holds still, as the timer bar does.
    if (paused) return undefined;
    const id = setInterval(read, TICK_MS);
    const stopListening = clock.onChange(read);
    return () => {
      clearInterval(id);
      stopListening();
    };
  }, [endsAt, paused, clock]);

  return seconds;
}

export function HowToPlay({ gameId, name, endsAt, paused }: HowToPlayProps) {
  const rules = getGameViews(gameId)?.howToPlay;
  const seconds = useSecondsLeft(endsAt, paused);

  return (
    <section class="how-to-play" aria-labelledby="how-to-play-title">
      <div class="how-to-play-card">
        <h2 id="how-to-play-title" class="how-to-play-title">
          {name}
        </h2>
        <p class="how-to-play-summary">
          {rules !== undefined
            ? gt(rules.summaryKey, rules.summaryFallback)
            : gt('games.screen.howToPlayFallback', 'Get ready to play {name}.', { name })}
        </p>
        {rules !== undefined && rules.steps.length > 0 && (
          <ol class="how-to-play-steps">
            {rules.steps.map((step) => (
              <li key={step.key}>{gt(step.key, step.fallback)}</li>
            ))}
          </ol>
        )}
      </div>
      {seconds !== null && (
        <p class="how-to-play-countdown" role="timer">
          {paused ? gt('games.screen.paused', 'Paused') : gt('games.screen.startingIn', 'Starting in {seconds}', { seconds })}
        </p>
      )}
    </section>
  );
}
