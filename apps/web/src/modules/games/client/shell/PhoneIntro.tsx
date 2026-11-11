/**
 * The phone during the how-to-play pause before the first question.
 *
 * With a big screen the rules are on it, so the phone only says what is
 * coming. With no big screen the phone is the only place to read them.
 */

import type { PlayerSnapshot } from '../../shared/protocol.js';
import { getGameViews } from './gameViews.js';
import { phoneGameName } from './PhoneFrame.js';
import { gt } from './t.js';
import '../styles/phone.css';

export function PhoneIntro({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { gameId } = snapshot.settings;
  const rules = snapshot.questionOnScreen ? undefined : getGameViews(gameId)?.howToPlay;

  return (
    <section class="phone-intro">
      <h2>{phoneGameName(gameId)}</h2>
      {snapshot.questionOnScreen && (
        <p class="muted">{gt('games.phone.startingSoon', 'Starting soon. Watch the screen.')}</p>
      )}
      {rules && (
        <>
          <p>{gt(rules.summaryKey, rules.summaryFallback)}</p>
          <ol class="phone-intro-steps">
            {rules.steps.map((step) => (
              <li key={step.key}>{gt(step.key, step.fallback)}</li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
