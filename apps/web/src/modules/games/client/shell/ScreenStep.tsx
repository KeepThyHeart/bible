/**
 * Where the big screen is. The game code is shown here, large, for typing on
 * the TV or projector computer; it never carries a credential.
 */

import type { RoomCode } from '../../shared/protocol.js';
import '../styles/organize.css';
import { gt } from './t.js';
import { useHeadingFocus } from './useHeadingFocus.js';

export interface ScreenStepProps {
  code: RoomCode;
  /** The address to open on the big screen, without a scheme. */
  tvAddress: string;
  /** The game is easier to run from a phone than from the screen. */
  usesBuzz: boolean;
  /** An organizer who is playing keeps their phone; it cannot also be the screen. */
  playingToo: boolean;
  onUseThisDevice(): void;
  onNoScreen(): void;
  onContinue(): void;
}

export function ScreenStep({ code, tvAddress, usesBuzz, playingToo, onUseThisDevice, onNoScreen, onContinue }: ScreenStepProps) {
  const headingRef = useHeadingFocus();
  return (
    <main class="screen org-screen">
      <h1 class="org-title" tabIndex={-1} ref={headingRef}>
        {gt('games.organize.screenTitle', 'Show it on a big screen')}
      </h1>
      <p>
        {gt('games.organize.screenOpen', 'On the TV or projector computer, open')} <strong>{tvAddress}</strong>{' '}
        {gt('games.organize.screenAndType', 'and type')}
      </p>
      <p class="org-code" aria-label={gt('games.organize.codeAria', 'Game code {code}', { code: code.split('').join(' ') })}>
        {code}
      </p>

      <button type="button" class="btn-primary" onClick={onContinue}>
        {gt('games.organize.continue', 'Continue')}
      </button>

      {!playingToo && (
        <div class="stack">
          <button type="button" onClick={onUseThisDevice}>
            {gt('games.organize.useThisDevice', 'Use this device as the screen instead')}
          </button>
          {usesBuzz && (
            <p class="muted" role="note">
              {gt('games.organize.easierOnPhone', 'This game is easier to run from a phone.')}
            </p>
          )}
        </div>
      )}

      <button type="button" class="btn-quiet" onClick={onNoScreen}>
        {gt('games.organize.noScreen', 'No big screen, play on phones only')}
      </button>
    </main>
  );
}
