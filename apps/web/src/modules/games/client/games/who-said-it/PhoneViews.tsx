/**
 * The phone.
 *
 * Four names, each a whole row, because the person holding it is looking up at
 * the screen and down at their hand alternately, sometimes with a toddler on
 * their knee. Nothing is smaller than a thumb, a long name wraps rather than
 * pushing the row off a 320-pixel screen, and a tap is acknowledged on the
 * phone the moment it is sent — a person unsure their tap registered taps
 * again, and the room's clock does not owe them the round trip.
 *
 * When teams vote together the phone stays open until time runs out: a tap is
 * this phone's vote, another tap changes it, and the vote that stands is the
 * one highlighted — read back from the room when the phone has just reloaded.
 *
 * The reveal on this screen is the private half: whether this phone was right,
 * and what it said if not. The big screen never learns either.
 *
 * The four names also answer to the keyboard: `a`/`b`/`c`/`d` (case-
 * insensitive) select the matching name, through the exact same path a tap
 * takes, for a host with a keyboard in front of them or anyone who would
 * rather not aim a thumb.
 */

import { useEffect, useState } from 'preact/hooks';
import type { PersonalResult } from '../../../shared/protocol.js';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { AWAITING_REVEAL, AWAITING_ROUND } from '../../shell/waitingCopy.js';
import { citation, indexForLetter, letterFor, readDetail, readQuestion } from './payload.js';

function Nothing({ line }: { line: string }) {
  return <p class="wsi-nothing">{line}</p>;
}

export function PhoneQuestion({ snapshot, view }: PlayerViewProps) {
  const question = readQuestion(view);
  if (!question) return <Nothing line={AWAITING_ROUND} />;

  // Already up on the big screen; this phone only needs to say where to
  // look, not repeat it in a smaller type.
  if (snapshot.questionOnScreen) {
    return (
      <section class="wsi wsi-phone">
        <p class="wsi-ask">Who said it?</p>
        <p class="wsi-hint">Look at the screen. The names come up in a moment.</p>
      </section>
    );
  }

  return (
    <section class="wsi wsi-phone">
      <p class="wsi-ask">Who said it?</p>
      <blockquote class="wsi-quote">“{question.quote}”</blockquote>
      <p class="wsi-hint">The names come up in a moment.</p>
    </section>
  );
}

/** A tap, remembered with its round so the next question starts clean by itself. */
interface Sent {
  round: number;
  index: number;
  label: string;
}

export function PhoneAnswering({ snapshot, view, send }: PlayerViewProps) {
  const question = readQuestion(view);
  const [sent, setSent] = useState<Sent | null>(null);

  const mine = sent?.round === snapshot.round ? sent : null;
  const voting = snapshot.canChangeAnswer;
  // This phone's own last tap first, since the room's echo of it may still be
  // on its way; the echo alone for a phone that has just reloaded.
  const echoed = snapshot.yourAnswer?.type === 'choice' ? snapshot.yourAnswer.index : null;
  const chosen = mine?.index ?? echoed;
  const done = !voting && (snapshot.youAnswered || mine !== null);

  const choose = (index: number, label: string): void => {
    if (done) return;
    // The vote already standing, tapped again, would only be sent twice.
    if (voting && index === chosen) return;
    setSent({ round: snapshot.round, index, label });
    send({ kind: 'answer', round: snapshot.round, value: { type: 'choice', index } });
  };

  // A/B/C/D (case-insensitive) select the matching name through the exact
  // same path a tap takes. A hook cannot come after an early return, so this
  // is registered on every render and is simply a no-op once there is no
  // question to answer with a letter.
  useEffect(() => {
    if (!question) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      // A held modifier means a browser or OS shortcut, not an answer.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const index = indexForLetter(event.key);
      if (index === null) return;
      const option = question.options.find((candidate) => candidate.index === index);
      if (!option) return;
      choose(option.index, option.label);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [question, done, chosen, voting, snapshot.round]);

  if (!question) return <Nothing line={AWAITING_ROUND} />;

  const chosenLabel = question.options.find((option) => option.index === chosen)?.label ?? null;

  return (
    <section class="wsi wsi-phone">
      {/* A screen already showing the quote makes the taps below the whole of
          what this phone is for — the compact layout `questionOnScreen`
          asks for. A room with no screen still needs it here to answer at all. */}
      {!snapshot.questionOnScreen && (
        <blockquote class="wsi-quote wsi-quote-small">“{question.quote}”</blockquote>
      )}
      <ul class="wsi-taps">
        {question.options.map((option) => (
          <li key={option.index}>
            <button
              type="button"
              class="wsi-tap"
              disabled={done}
              aria-pressed={chosen === option.index}
              onClick={() => choose(option.index, option.label)}
            >
              <span class="wsi-letter">{letterFor(option.index)}</span>
              <span class="wsi-name">{option.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {voting ? (
        <p class="wsi-sent" role="status">
          {chosenLabel === null
            ? 'Tap a name to vote. You can change it until time runs out.'
            : `Your vote: ${chosenLabel}. Tap another name to change it until time runs out.`}
        </p>
      ) : (
        done && <p class="wsi-sent">{mine ? `Sent: ${mine.label}` : 'Answer sent.'}</p>
      )}
    </section>
  );
}

/**
 * What a team vote came to, on this phone: what the team chose, then whether
 * that was right. The result is the team's, so every phone on it reads the same.
 */
function teamVerdict(result: PersonalResult): string {
  const verdict = result.correct ? 'Right.' : 'Not this time.';
  return result.note === null ? verdict : `${result.note}. ${verdict}`;
}

export function PhoneReveal({ reveal, yourResult }: PlayerViewProps) {
  const detail = readDetail(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={AWAITING_REVEAL} />;

  const submitted = yourResult?.submitted ?? null;
  const picked = submitted?.type === 'choice' ? (detail.options[submitted.index] ?? null) : null;
  const cited = citation(detail);
  // Only a round decided by team vote carries the teams' splits.
  const teamVote = reveal.groups !== undefined;

  return (
    <section class="wsi wsi-phone">
      <p class="wsi-answer-label">Who said it</p>
      <h2 class="wsi-answer">{detail.speaker}</h2>
      {detail.listener !== null && <p class="wsi-listener">to {detail.listener}</p>}
      {detail.text.length > 0 && <blockquote class="wsi-verse wsi-verse-small">{detail.text}</blockquote>}
      {cited.length > 0 && <p class="wsi-citation">{cited}</p>}

      {yourResult === null ? (
        <p class="wsi-yours">No answer from this phone.</p>
      ) : teamVote ? (
        <p class="wsi-yours" data-correct={yourResult.correct ? 'true' : 'false'}>
          {teamVerdict(yourResult)}
          {picked !== null && !(yourResult.correct && picked.correct) && (
            <span class="wsi-muted"> You voted {picked.label}.</span>
          )}
        </p>
      ) : (
        <p class="wsi-yours" data-correct={yourResult.correct ? 'true' : 'false'}>
          {yourResult.correct ? 'Right.' : (yourResult.note ?? 'Not this time.')}
          {picked !== null && !yourResult.correct && <span class="wsi-muted"> You said {picked.label}.</span>}
        </p>
      )}
    </section>
  );
}
