/**
 * A TV or projector computer joining a game by its code, as a display only.
 *
 * It types a code (or arrives with one in the link, and connects at once),
 * opens the code-only stream, and then draws exactly what any display screen
 * draws. The code is the only thing it holds: nothing here can control the
 * game. A refused code goes back to the entry with a plain message.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../shared/protocol.js';
import type { RoomCode } from '../../shared/protocol.js';
import { Brand } from './Brand.js';
import { filterToCodeAlphabet, normaliseCode } from './routes.js';
import { ScreenStage } from './ScreenStage.js';
import { gt } from './t.js';
import { useRoomStream } from './useRoomStream.js';
import type { StreamFactory } from './useRoomStream.js';

export interface TvJoinProps {
  code: RoomCode | null;
  onNavigate(to: string): void;
  /** A test seam: the stream is made by this instead of `EventSource`. */
  factory?: StreamFactory;
}

const NO_COMMAND = (): void => undefined;

function TvConnection({
  code,
  factory,
  onRefused,
}: {
  code: RoomCode;
  factory: StreamFactory | undefined;
  onRefused(message: string): void;
}) {
  const stream = useRoomStream({ code, token: null, as: 'codeOnly', ...(factory !== undefined ? { factory } : {}) });
  // Every end before the first snapshot is a refusal; after one, the room went away.
  const seen = useRef(false);
  if (stream.snapshot !== null) seen.current = true;
  const ended = stream.ended;

  useEffect(() => {
    if (ended === null) return;
    onRefused(seen.current ? ended : gt('games.screen.tv.refused', 'No game is using that code.'));
  }, [ended, onRefused]);

  const snapshot = stream.snapshot;
  if (snapshot === null || snapshot.viewer !== 'screen') {
    return (
      <main class="screen centre">
        <Brand />
        <p role="status">{gt('games.screen.tv.opening', 'Opening the game…')}</p>
      </main>
    );
  }
  return (
    <ScreenStage
      snapshot={snapshot}
      status={stream.status}
      reveal={stream.reveal}
      isOwner={false}
      onCommand={NO_COMMAND}
      onReconnectNow={stream.reconnectNow}
    />
  );
}

export function TvJoin({ code, factory }: TvJoinProps) {
  const [typed, setTyped] = useState(() => filterToCodeAlphabet(code ?? ''));
  const [dropped, setDropped] = useState(false);
  const [connected, setConnected] = useState<RoomCode | null>(() =>
    code !== null && normaliseCode(code).length > 0 ? normaliseCode(code) : null
  );
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (notice !== null) inputRef.current?.focus();
  }, [notice]);

  if (connected !== null) {
    return (
      <TvConnection
        key={`${connected}:${attempt}`}
        code={connected}
        factory={factory}
        onRefused={(message) => {
          setConnected(null);
          setNotice(message);
        }}
      />
    );
  }

  const ready = typed.length >= ROOM_CODE_LENGTH;
  const filteredNote = dropped
    ? gt('games.screen.tv.codeFiltered', 'Game codes only use these characters: {chars}. Others were left out.', {
        chars: ROOM_CODE_ALPHABET.split('').join(' '),
      })
    : null;

  return (
    <main class="screen screen-tv-join">
      <Brand />
      <form
        class="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          setNotice(null);
          setAttempt((value) => value + 1);
          setConnected(typed);
        }}
      >
        <label class="field">
          <span class="field-label">{gt('games.screen.tv.codeLabel', 'Game code')}</span>
          <input
            class="code-input tv-code-input"
            name="game-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellcheck={false}
            maxLength={8}
            aria-describedby="tv-code-help"
            value={typed}
            ref={inputRef}
            onInput={(event) => {
              const raw = event.currentTarget.value;
              const kept = filterToCodeAlphabet(raw);
              setDropped(kept.length < normaliseCode(raw).length);
              setTyped(kept);
            }}
          />
        </label>
        <p id="tv-code-help" class="muted">
          {gt('games.screen.tv.help', "Type the code from the organizer's phone.")}
        </p>
        <p class="muted small" role="status">
          {filteredNote}
        </p>
        {notice !== null && (
          <p class="alert" role="alert">
            {notice}
          </p>
        )}
        <button class="btn-primary" type="submit" disabled={!ready}>
          {gt('games.screen.tv.show', 'Show the game')}
        </button>
      </form>
    </main>
  );
}
