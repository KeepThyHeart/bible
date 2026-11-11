/**
 * The very first screen: nobody has typed a code or said they are organizing
 * yet.
 *
 * Almost everyone who opens this app is joining a game someone else started,
 * so the game code and Join come first. Running a game for a group is the one
 * clear door for the person who organizes it, and playing on one's own is the
 * quiet link underneath.
 */

import { useState } from 'preact/hooks';
import type { RoomCode } from '../../shared/protocol.js';
import { Brand } from './Brand.js';
import { MIN_CODE_LENGTH } from './JoinScreen.js';
import { filterToCodeAlphabet } from './routes.js';
import { gt } from './t.js';

export interface HomeScreenProps {
  /** The code typed so far, or null when nothing usable was typed. */
  onJoin(code: RoomCode | null): void;
  onHost(): void;
  /** Absent where there is no solo route to go to. */
  onSolo?(): void;
}

export function HomeScreen({ onJoin, onHost, onSolo }: HomeScreenProps) {
  const [code, setCode] = useState('');
  const ready = code.length >= MIN_CODE_LENGTH;

  return (
    <main class="screen screen-home centre">
      <Brand />
      <p class="home-tagline">
        {gt('games.home.tagline', 'Bible trivia and party games for a group, played on everyone’s own phone.')}
      </p>

      <form
        class="stack home-join"
        onSubmit={(event) => {
          event.preventDefault();
          onJoin(ready ? code : null);
        }}
      >
        <label class="field">
          <span class="field-label">{gt('games.home.gameCode', 'Game code')}</span>
          <input
            class="code-input"
            name="game-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellcheck={false}
            maxLength={8}
            value={code}
            onInput={(event) => setCode(filterToCodeAlphabet(event.currentTarget.value))}
          />
        </label>
        <button type="submit" class="btn-primary">
          {gt('games.home.join', 'Join')}
        </button>
      </form>

      <div class="or-rule" aria-hidden="true">
        {gt('games.common.or', 'or')}
      </div>

      <button type="button" class="btn-primary home-host" onClick={onHost}>
        {gt('games.home.host', 'Run a game for a group')}
      </button>

      {onSolo !== undefined && (
        <button type="button" class="btn-quiet" onClick={onSolo}>
          {gt('games.home.solo', 'Play on my own')}
        </button>
      )}
    </main>
  );
}
