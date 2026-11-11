/**
 * The phone.
 *
 * Which of three phones this is depends on the seat, and the server has
 * already decided it: the describer holds the card with Got it and Pass; the
 * describer's teammates hold nothing, because they are guessing out loud; the
 * other team holds the card and "They said one", because they are listening
 * for a forbidden word.
 *
 * Every tap names the card it is about, and a button goes quiet once it has
 * been pressed for that card. The server moves the card on and ignores a
 * second tap on the one it left, so the quiet button is only there to stop a
 * thumb wondering whether it landed.
 *
 * The card is kept off the describer's phone during the get-ready, so the
 * describer does not start thinking before the clock does.
 */

import { useState } from 'preact/hooks';
import type { PlayerSnapshot, TeamId } from '../../../shared/protocol.js';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { gt } from '../../shell/t.js';
import { teamLabel } from '../../shell/teams.js';
import { awaitingReveal, awaitingRound } from '../../shell/waitingCopy.js';
import { GotChips } from './HostViews.js';
import { nameOf, readPhoneTurn, readReveal } from './payload.js';
import type { CardFace, Describer, Guesser, Watcher } from './payload.js';

type CardAction = 'got' | 'pass' | 'slip';

function Nothing({ line }: { line: string }) {
  return <p class="di-nothing">{line}</p>;
}

function NoIcon() {
  return (
    <svg
      class="di-no-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

function Card({ face, mine }: { face: CardFace; mine: boolean }) {
  return (
    <div class="di-card" data-mine={mine ? 'true' : 'false'}>
      {mine && face.category.length > 0 && <span class="di-category">{face.category}</span>}
      <span class="di-concept">{face.concept}</span>
      {mine && <span class="di-rule" />}
      {mine && <span class="di-label">{gt('games.describeIt.view.dontSay', 'Don’t say')}</span>}
      <ul class="di-forbidden" aria-label={gt('games.describeIt.view.forbiddenWords', 'Forbidden words')}>
        {face.forbidden.map((word) => (
          <li key={word} class="di-no">
            {mine && <NoIcon />}
            {word}
          </li>
        ))}
      </ul>
      {mine && <span class="di-muted di-small">{gt('games.describeIt.view.orCardWord', '…or any word on the card itself.')}</span>}
    </div>
  );
}

function DeckOut() {
  return (
    <p class="di-notice" role="status">
      {gt('games.describeIt.view.deckOutTimer', 'That was every card in the deck. The turn ends with the timer.')}
    </p>
  );
}

/**
 * Sends one tap per card. The key is the round and the card, so a phone that
 * tapped card three is free again the moment the room shows card four.
 */
function useTap(snapshot: PlayerSnapshot, send: PlayerViewProps['send'], cardIndex: number) {
  const [tapped, setTapped] = useState<string | null>(null);
  const key = `${snapshot.round}:${cardIndex}`;
  const done = tapped === key;
  const tap = (action: CardAction): void => {
    if (done || snapshot.paused) return;
    setTapped(key);
    send({ kind: 'answer', round: snapshot.round, value: { type: 'card', action, card: cardIndex } });
  };
  return { done, tap };
}

function DescriberPhone({ turn, snapshot, send }: { turn: Describer } & Pick<PlayerViewProps, 'snapshot' | 'send'>) {
  const { done, tap } = useTap(snapshot, send, turn.cardIndex);
  if (snapshot.phase === 'question') {
    return (
      <section class="di di-phone di-centred">
        <p class="di-label">{gt('games.describeIt.view.youreDescribing', 'You’re describing')}</p>
        <p class="di-big">{gt('games.describeIt.view.getReady', 'Get ready')}</p>
        <p class="di-muted">{gt('games.describeIt.view.cardAppears', 'Your card appears when the timer starts. Got it when they say it; Pass to skip.')}</p>
      </section>
    );
  }
  const disabled = done || snapshot.paused || turn.card === null;
  return (
    <section class="di di-phone">
      <p class="di-label">{gt('games.describeIt.view.youreDescribing', 'You’re describing')}</p>
      {turn.called && (
        <p class="di-called" role="status">
          {gt('games.describeIt.view.calledOne', 'The other team called that one. Here’s the next.')}
        </p>
      )}
      {turn.card === null ? <DeckOut /> : <Card face={turn.card} mine />}
      <div class="di-actions">
        <button type="button" class="di-got-it" disabled={disabled} onClick={() => tap('got')}>
          {gt('games.describeIt.view.gotIt', 'Got it')}
        </button>
        <button type="button" class="di-pass" disabled={disabled} onClick={() => tap('pass')}>
          {gt('games.describeIt.view.pass', 'Pass')}
        </button>
      </div>
    </section>
  );
}

function soFar(teamId: TeamId | null, got: number): string {
  return teamId === null
    ? gt('games.describeIt.view.soFar', '{count} so far.', { count: got })
    : gt('games.describeIt.view.teamSoFar', '{team} team has {count} so far.', { team: teamLabel(teamId), count: got });
}

function GuesserPhone({ turn, snapshot }: { turn: Guesser; snapshot: PlayerSnapshot }) {
  const name = nameOf(snapshot.players, turn.describer);
  return (
    <section class="di di-phone di-centred">
      <p class="di-label">{gt('games.describeIt.view.isDescribing', '{name} is describing', { name })}</p>
      {snapshot.phase === 'question' ? (
        <>
          <p class="di-big">{gt('games.describeIt.view.getReady', 'Get ready')}</p>
          <p class="di-muted">{gt('games.describeIt.view.watchGuess', 'Watch {name}, and guess out loud.', { name })}</p>
        </>
      ) : (
        <>
          <p class="di-big">{gt('games.describeIt.view.guessOutLoud', 'Guess out loud')}</p>
          <p class="di-muted">{gt('games.describeIt.view.shoutIt', 'Nothing to tap — shout it.')} {soFar(turn.teamId, turn.gotCount)}</p>
        </>
      )}
    </section>
  );
}

function WatcherPhone({ turn, snapshot, send }: { turn: Watcher } & Pick<PlayerViewProps, 'snapshot' | 'send'>) {
  const { done, tap } = useTap(snapshot, send, turn.cardIndex);
  const whose = turn.teamId === null
    ? gt('games.describeIt.view.their', 'Their')
    : gt('games.describeIt.view.teamPossessive', '{team}’s', { team: teamLabel(turn.teamId) });
  const name = nameOf(snapshot.players, turn.describer);
  if (snapshot.phase === 'question') {
    return (
      <section class="di di-phone di-centred">
        <p class="di-label">{gt('games.describeIt.view.isDescribing', '{name} is describing', { name })}</p>
        <p class="di-big">{gt('games.describeIt.view.listenClosely', 'Listen closely')}</p>
        <p class="di-muted">{gt('games.describeIt.view.youllSee', 'You’ll see their card. If {name} says a word on it, tap They said one.', { name })}</p>
      </section>
    );
  }
  return (
    <section class="di di-phone">
      <p class="di-label">{gt('games.describeIt.view.keepQuiet', '{whose} card — keep it quiet', { whose })}</p>
      {turn.card === null ? <DeckOut /> : <Card face={turn.card} mine={false} />}
      <button
        type="button"
        class="di-slip"
        disabled={done || snapshot.paused || turn.card === null}
        onClick={() => tap('slip')}
      >
        {gt('games.describeIt.view.theySaidOne', 'They said one')}
      </button>
      <p class="di-muted di-small">{gt('games.describeIt.view.cardPassed', 'The card is passed. The big screen just moves on — nobody is named.')}</p>
    </section>
  );
}

export function PhoneTurnView({ snapshot, view, send }: PlayerViewProps) {
  const turn = readPhoneTurn(view);
  if (turn === null) return <Nothing line={awaitingRound()} />;
  switch (turn.role) {
    case 'waiting':
      return (
        <section class="di di-phone di-centred">
          <p class="di-big">{gt('games.describeIt.view.inNextTurn', 'You’re in from the next turn')}</p>
        </section>
      );
    case 'describer':
      return <DescriberPhone turn={turn} snapshot={snapshot} send={send} />;
    case 'guesser':
      return <GuesserPhone turn={turn} snapshot={snapshot} />;
    case 'watcher':
      return <WatcherPhone turn={turn} snapshot={snapshot} send={send} />;
  }
}

/**
 * What the turn came to. A player on the describing team is scored and told
 * "your team"; everyone else reads it as the big screen does.
 */
export function PhoneReveal({ snapshot, reveal, yourResult }: PlayerViewProps) {
  const detail = readReveal(reveal?.detail);
  if (reveal === null || detail === null) return <Nothing line={awaitingReveal()} />;

  const { you, settings } = snapshot;
  const yours = yourResult !== null || !settings.teamsEnabled || you.teamId === detail.teamId;
  const heading = yours ? gt('games.describeIt.view.teamGot', 'Your team got {count}', { count: detail.got.length }) : reveal.correctLabel;
  const next = snapshot.round + 1 < snapshot.totalRounds ? detail.next : null;

  let nextLine: string | null = null;
  if (next !== null && next.describer === you.id) {
    nextLine = gt('games.describeIt.view.describingNext', 'You’re describing next — get ready.');
  } else if (next !== null) {
    const name = nameOf(snapshot.players, next.describer);
    nextLine =
      next.teamId === null
        ? gt('games.describeIt.view.upNextPlayer', 'Up next: {name} describes.', { name })
        : gt('games.describeIt.view.upNextTeam', 'Up next: {team} team — {name} describes.', { team: teamLabel(next.teamId), name });
  }

  return (
    <section class="di di-phone">
      <p class="di-label">{gt('games.describeIt.view.time', 'Time')}</p>
      <h2 class="di-total">{heading}</h2>
      {detail.got.length > 0 && <GotChips got={detail.got} />}
      {nextLine !== null && (
        <p class="di-up-next" data-you={next?.describer === you.id ? 'true' : 'false'}>
          {nextLine}
        </p>
      )}
    </section>
  );
}
