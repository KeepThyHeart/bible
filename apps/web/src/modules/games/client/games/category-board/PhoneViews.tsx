/**
 * The phone.
 *
 * The phone does not get the board. At 320 pixels a grid of thirty tiles is
 * noise, and the person holding it is already looking at the board on the wall.
 * What it gets is the category, what the tile is worth, the question, and four
 * buttons each the width of the screen.
 *
 * A tap target here is a whole row, because the person holding it is looking up
 * at the screen and down at their hand alternately. An answer is acknowledged
 * on the phone itself the moment it is sent — a person who is not sure their tap
 * registered taps again, and the room's clock does not owe them the round trip.
 *
 * When teams vote together the phone stays open until time runs out: a tap is
 * this phone's vote, another tap changes it, and the vote that stands is the
 * one highlighted — read back from the room when the phone has just reloaded.
 *
 * Whether this player was right is shown here and nowhere else.
 *
 * The four answers also answer to the keyboard: `a`/`b`/`c`/`d` (case-
 * insensitive) select the matching one, through the exact same path a tap
 * takes.
 */

import { useEffect, useState } from 'preact/hooks';
import type { PersonalResult } from '../../../shared/protocol.js';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { AWAITING_REVEAL, AWAITING_ROUND } from '../../shell/waitingCopy.js';
import { indexForLetter, letterFor, readDetail, readQuestion, tileCaption } from './payload.js';

function Nothing({ line }: { line: string }) {
  return <p class="cb-nothing">{line}</p>;
}

export function PhoneQuestion({ view }: PlayerViewProps) {
  const question = readQuestion(view);
  if (!question) return <Nothing line={AWAITING_ROUND} />;

  return (
    <section class="cb cb-phone">
      <p class="cb-caption">{tileCaption(question.category, question.value)}</p>
      <p class="cb-prompt">{question.prompt}</p>
      <p class="cb-hint">Answers open in a moment.</p>
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

  const submit = (index: number, label: string): void => {
    if (done) return;
    // The vote already standing, tapped again, would only be sent twice.
    if (voting && index === chosen) return;
    setSent({ round: snapshot.round, index, label });
    send({ kind: 'answer', round: snapshot.round, value: { type: 'choice', index } });
  };

  // A/B/C/D (case-insensitive) select the matching answer through the exact
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
      submit(option.index, option.label);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [question, done, chosen, voting, snapshot.round]);

  if (!question) return <Nothing line={AWAITING_ROUND} />;

  const chosenLabel = question.options.find((option) => option.index === chosen)?.label ?? null;

  return (
    <section class="cb cb-phone">
      <p class="cb-caption">{tileCaption(question.category, question.value)}</p>
      <p class="cb-prompt cb-prompt-small">{question.prompt}</p>
      <ul class="cb-taps">
        {question.options.map((option) => (
          <li key={option.index}>
            <button
              type="button"
              class="cb-tap"
              disabled={done}
              aria-pressed={chosen === option.index}
              onClick={() => submit(option.index, option.label)}
            >
              <span class="cb-letter">{letterFor(option.index)}</span>
              <span class="cb-label">{option.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {voting ? (
        <p class="cb-sent" role="status">
          {chosenLabel === null
            ? 'Tap an answer to vote. You can change it until time runs out.'
            : `Your vote: ${chosenLabel}. Tap another answer to change it until time runs out.`}
        </p>
      ) : (
        done && <p class="cb-sent">{mine ? `Sent: ${mine.label}` : 'Answer sent.'}</p>
      )}
    </section>
  );
}

/**
 * What a team vote came to, on this phone: what the team chose, then whether
 * that was right. The result is the team's, so every phone on it reads the same.
 */
function teamVerdict(result: PersonalResult): string {
  // The point delta is the phone frame's own footer (`score-delta`), not
  // repeated here — every other game's verdict says only whether it was
  // right, and this one used to be the one exception.
  const verdict = result.correct ? 'Right.' : 'Not this time.';
  return result.note === null ? verdict : `${result.note}. ${verdict}`;
}

export function PhoneReveal({ view, reveal, yourResult }: PlayerViewProps) {
  if (!readQuestion(view)) return <Nothing line="Nothing was asked this round." />;
  const detail = readDetail(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={AWAITING_REVEAL} />;

  const submitted = yourResult?.submitted ?? null;
  const picked =
    submitted !== null && submitted.type === 'choice' ? (detail.options[submitted.index] ?? null) : null;
  // Only a round decided by team vote carries the teams' splits.
  const teamVote = reveal.groups !== undefined;

  return (
    <section class="cb cb-phone">
      <p class="cb-caption">{tileCaption(detail.category, detail.value)}</p>
      <p class="cb-answer-label">The answer</p>
      <h2 class="cb-answer">{reveal.correctLabel}</h2>
      {detail.reference !== null && <p class="cb-reference">{detail.reference}</p>}

      {yourResult === null ? (
        <p class="cb-yours">No answer from this phone.</p>
      ) : teamVote ? (
        <p class="cb-yours" data-correct={yourResult.correct ? 'true' : 'false'}>
          {teamVerdict(yourResult)}
          {picked !== null && !(yourResult.correct && picked.correct) && (
            <span class="cb-muted"> You voted {picked.label}.</span>
          )}
        </p>
      ) : yourResult.correct ? (
        <p class="cb-yours" data-correct="true">
          Right.
        </p>
      ) : (
        <p class="cb-yours" data-correct="false">
          {yourResult.note ?? 'Not this time.'}
          {picked !== null && <span class="cb-muted"> You said {picked.label}.</span>}
        </p>
      )}
    </section>
  );
}
