/**
 * The phone.
 *
 * The phone is not where the game is played: the Bible in the other hand is.
 * So the screen is the reference, large enough to glance at while turning
 * pages, and one button a thumb can find without looking. Nothing is typed.
 *
 * The same component serves the search and the reading, because to the person
 * holding it they are one moment: the reference stays put and only the line
 * under it changes — tap, wait your turn, read aloud.
 *
 * When this phone reaches the head of the queue it tells the room so by
 * itself. That "found it" is what stops the clock while the host listens and
 * gives the host's ruling something to land on; asking a player with a Bible
 * open in both hands to press a second button would lose them their turn to
 * the timer. This holds however this phone got there — its own tap, or the
 * host calling on it (`buzzModeOf`) — so the two modes share every screen
 * below the search but the "Found it" button itself.
 *
 * Anything that went wrong is said here and only here. A phone whose reading
 * the host moved on from is told so gently; the big screen never is.
 */

import { useEffect, useState } from 'preact/hooks';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { AWAITING_REVEAL, AWAITING_ROUND } from '../../shell/waitingCopy.js';
import { buzzModeOf, placeOf, pressedAt, readDrill, readReveal } from './payload.js';
import type { Place } from './payload.js';

function Nothing({ line }: { line: string }) {
  return <p class="sd-nothing">{line}</p>;
}

function waitingLine(ahead: number): string {
  return ahead === 1 ? 'You are next.' : `${ahead} ahead of you.`;
}

function Status({ place, tapped }: { place: Place; tapped: boolean }) {
  switch (place.kind) {
    case 'reading':
      return (
        <div class="sd-status" data-tone="now" role="status">
          <p class="sd-status-main">Read it aloud now</p>
          <p class="sd-status-sub">The host is listening.</p>
        </div>
      );
    case 'waiting':
      return (
        <div class="sd-status" role="status">
          <p class="sd-status-main">Found it — you’re in line</p>
          <p class="sd-status-sub">Keep your finger on the verse. {waitingLine(place.ahead)}</p>
        </div>
      );
    case 'confirmed':
      return (
        <div class="sd-status" data-tone="good" role="status">
          <p class="sd-status-main">Confirmed — well found</p>
        </div>
      );
    case 'passed':
      return (
        <div class="sd-status" role="status">
          <p class="sd-status-main">Not that one this time</p>
          <p class="sd-status-sub">The verse goes up at the reveal.</p>
        </div>
      );
    case 'free':
      // Tapped, and the room has not caught up yet. Saying so at once matters:
      // someone unsure their tap landed taps again.
      return tapped ? (
        <div class="sd-status" role="status">
          <p class="sd-status-main">Found it — you’re in line</p>
        </div>
      ) : null;
  }
}

/** What a still-free phone says instead of a button, when the host is the one calling on readers. */
function RaiseYourHand() {
  return (
    <div class="sd-status" role="status">
      <p class="sd-status-main">Found it? Raise your hand.</p>
      <p class="sd-status-sub">The host will call on you.</p>
    </div>
  );
}

export function PhoneSearch({ snapshot, view, send }: PlayerViewProps) {
  const drill = readDrill(view);
  /** The round this phone tapped in, so the next reference starts clean by itself. */
  const [tappedRound, setTappedRound] = useState<number | null>(null);

  const { round, phase, paused, youAnswered } = snapshot;
  const place = placeOf(snapshot.buzz, snapshot.you.id, snapshot.youAreSpent ? [snapshot.you.id] : []);
  const reading = place.kind === 'reading';
  const mode = buzzModeOf(snapshot.settings.gameOptions);

  // Getting here is not only a tap any more: the host may have called this
  // phone onto the buzzer itself (`callOn`), which lands it at the head of
  // the queue exactly as a tap would. Either way, reaching the head is what
  // tells the room so — see the module doc comment.
  useEffect(() => {
    if (!reading || youAnswered || paused || phase !== 'answering') return;
    send({ kind: 'answer', round, value: { type: 'found' } });
  }, [reading, youAnswered, paused, phase, round, send]);

  if (!drill) return <Nothing line={AWAITING_ROUND} />;

  const tapped = tappedRound === round;
  const canTap = mode === 'buttons' && place.kind === 'free' && !tapped;

  const tap = (): void => {
    if (!canTap || paused) return;
    setTappedRound(round);
    // Nothing streams in this game, so there is nothing to have read.
    send({ kind: 'buzz', round, charsSeen: 0, tClient: pressedAt() });
  };

  return (
    <section class="sd sd-phone">
      <p class="sd-ask">Find</p>
      <p class="sd-ref sd-ref-phone">{drill.reference}</p>
      {drill.translation.length > 0 && <p class="sd-translation">{drill.translation}</p>}
      {canTap ? (
        <button type="button" class="sd-found" disabled={paused} onClick={tap}>
          Found it
        </button>
      ) : mode === 'hostCalls' && place.kind === 'free' ? (
        <RaiseYourHand />
      ) : (
        <Status place={place} tapped={tapped} />
      )}
    </section>
  );
}

/**
 * The verse, and one private line about how the round went for this phone.
 * Someone the host never reached is told they found it, because they did —
 * with no score beside it and nothing on the big screen.
 */
export function PhoneReveal({ snapshot, reveal, yourResult }: PlayerViewProps) {
  const detail = readReveal(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={AWAITING_REVEAL} />;

  const place = placeOf(snapshot.buzz, snapshot.you.id, snapshot.youAreSpent ? [snapshot.you.id] : []);
  let line: string;
  let tone: 'good' | 'quiet' = 'quiet';
  if (yourResult?.correct || place.kind === 'confirmed') {
    line = 'Confirmed — well found.';
    tone = 'good';
  } else if (yourResult !== null) {
    line = yourResult.note ?? 'Not that one this time.';
  } else if (place.kind === 'passed') {
    line = 'Not that one this time.';
  } else if (place.kind === 'reading' || place.kind === 'waiting') {
    line = 'You found it too.';
  } else {
    line = 'Here it is, for next time.';
  }

  return (
    <section class="sd sd-phone sd-reveal">
      <p class="sd-label">The verse</p>
      <h2 class="sd-answer">{detail.reference}</h2>
      {detail.text.length > 0 && <blockquote class="sd-verse sd-verse-phone">{detail.text}</blockquote>}
      {detail.translation.length > 0 && <p class="sd-translation">{detail.translation}</p>}
      <p class="sd-yours" data-tone={tone}>
        {line}
      </p>
    </section>
  );
}
