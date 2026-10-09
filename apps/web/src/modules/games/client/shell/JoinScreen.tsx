/**
 * The first screen on a phone.
 *
 * Two fields and a button. The code is read off a screen across a room and
 * typed by someone who is already slightly behind, so it is normalised as it is
 * typed rather than validated afterwards: lowercase becomes uppercase, spaces
 * and dashes fall away, and the field never rejects a keystroke — it just shows
 * what it kept.
 *
 * The keyboard matters as much as the field. Autocapitalisation is forced on,
 * autocorrect and spellcheck off, so a phone does not helpfully turn a room
 * code into a word.
 */

import { useEffect, useState } from 'preact/hooks';
import { ROOM_CODE_LENGTH } from '../../shared/protocol.js';
import type { RoomCode } from '../../shared/protocol.js';
import { Brand } from './Brand.js';
import { filterToCodeAlphabet } from './routes.js';
import { gt } from './t.js';

/** No room code is ever shorter than this, so nothing shorter is worth sending. */
export const MIN_CODE_LENGTH = ROOM_CODE_LENGTH;
export const MAX_NAME_LENGTH = 20;

/** Names are shown next to each other in a roster; runs of spaces wreck that. */
export function normaliseName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

export interface JoinScreenProps {
  initialCode: string;
  initialName: string;
  busy: boolean;
  error: string | null;
  onJoin(code: RoomCode, name: string): void;
  onSolo(): void;
}

export function JoinScreen({ initialCode, initialName, busy, error, onJoin, onSolo }: JoinScreenProps) {
  const [code, setCode] = useState(() => filterToCodeAlphabet(initialCode));
  const [name, setName] = useState(initialName);

  // A code that arrived in the link (from a QR scan) can land after first paint.
  useEffect(() => {
    const incoming = filterToCodeAlphabet(initialCode);
    if (incoming) setCode(incoming);
  }, [initialCode]);

  const trimmedName = normaliseName(name);
  const ready = code.length >= MIN_CODE_LENGTH && trimmedName.length > 0 && !busy;

  return (
    <main class="screen screen-join">
      <Brand />

      <form
        class="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onJoin(code, trimmedName);
        }}
      >
        <label class="field">
          <span class="field-label">{gt('games.join.enterCode', 'Enter room code')}</span>
          <input
            class="code-input"
            name="room-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellcheck={false}
            maxLength={8}
            aria-describedby="code-help"
            value={code}
            onInput={(event) => setCode(filterToCodeAlphabet(event.currentTarget.value))}
          />
        </label>
        <p id="code-help" class="muted small">
          {gt('games.join.codeHelp', 'Letters and numbers from the big screen.')}
        </p>

        <label class="field">
          <span class="field-label">{gt('games.join.yourName', 'Your name')}</span>
          <input
            name="display-name"
            type="text"
            inputMode="text"
            autoComplete="nickname"
            autoCapitalize="words"
            maxLength={MAX_NAME_LENGTH}
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>

        {error !== null && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}

        <button class="btn-primary" type="submit" disabled={!ready}>
          {busy ? gt('games.join.joining', 'Joining…') : gt('games.join.joinRoom', 'Join room')}
        </button>
      </form>

      <div class="or-rule" aria-hidden="true">
        {gt('games.common.or', 'or')}
      </div>

      <button type="button" class="btn-quiet" onClick={onSolo} disabled={busy}>
        {gt('games.join.solo', 'Play solo')}
      </button>
    </main>
  );
}
