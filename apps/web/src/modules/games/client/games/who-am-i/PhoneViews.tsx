/**
 * The phone.
 *
 * Tap before type: four names, each a whole row, reachable with a thumb at
 * 320 px. There is one guess per person and a wrong one sits the player out of
 * the rest of the question, so a tap only *chooses*; a second, separate button
 * commits, and it says in words what committing means before it is pressed.
 * Nobody should find out about the lockout by walking into it.
 *
 * Once the guess is in, the phone says so and keeps showing the clues, so a
 * player who is out can still watch the story arrive. Whether the guess was
 * right is not known to the phone until the reveal — the server tells nobody
 * early — and when it is known it is said here and nowhere else.
 *
 * In solo the player turns the clues over, so the phone offers the next one and
 * says what it will cost. It never shows fewer clues than the room's clock
 * would, so reading slowly is never a way to fall behind the window.
 *
 * When teams vote together there is no lockout, and so none of that ceremony:
 * a tap is the vote, sent at once, and another tap changes it until time runs
 * out. The phone says so, and says why agreeing early matters, because the team
 * is paid at the clue its answer settled.
 *
 * The four names also answer to the keyboard: `a`/`b`/`c`/`d` (case-
 * insensitive) select the matching name, through the exact same path a tap
 * takes — choosing in `LiveGuess`, voting outright in `TeamVote`.
 */

import { useEffect, useState } from 'preact/hooks';
import type { PersonalResult, PlayerSnapshot } from '../../../shared/protocol.js';
import type { ClockPort } from '../../shell/clockPort.js';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { AWAITING_REVEAL, AWAITING_ROUND } from '../../shell/waitingCopy.js';
import { decodeChoice, encodeChoice } from './answerCode.js';
import { LiveClues, RevealClues } from './ClueList.js';
import { useCluesShown } from './clues.js';
import { indexForLetter, letterFor, readReveal, readRound, worthAt } from './payload.js';
import type { WhoAmIRound } from './payload.js';

function Nothing({ line }: { line: string }) {
  return <p class="wai-nothing">{line}</p>;
}

/** The rule, in words, where the player reads it before committing. */
export const ONE_GUESS_RULE = 'One guess only. If it is wrong, you sit out the rest of this one.';

/** The rules of a team vote, where the player reads them before voting. */
export const TEAM_VOTE_RULE =
  'Your team answers by majority, and you can change your vote until time runs out. The sooner your team agrees, the more it is worth.';

export function PhoneQuestion({ view }: PlayerViewProps) {
  const round = readRound(view);
  if (!round) return <Nothing line={AWAITING_ROUND} />;

  return (
    <section class="wai wai-phone">
      <p class="wai-ask">Who am I?</p>
      <LiveClues clues={round.clues} shown={1} size="small" />
      <p class="wai-muted">Answers open in a moment.</p>
    </section>
  );
}

interface LiveProps {
  round: WhoAmIRound;
  snapshot: PlayerSnapshot;
  clock: ClockPort;
  send: PlayerViewProps['send'];
}

/** Local choices, each remembered with its round so the next question starts clean. */
interface Marked {
  round: number;
  value: number;
}

function LiveGuess({ round, snapshot, clock, send }: LiveProps) {
  const scheduled = useCluesShown(round, snapshot, clock);
  const [turned, setTurned] = useState<Marked | null>(null);
  const [picked, setPicked] = useState<Marked | null>(null);
  const [sent, setSent] = useState<Marked | null>(null);

  const count = round.clues.length;
  const here = snapshot.round;
  const solo = round.pacing === 'player';
  const turnedHere = turned?.round === here ? turned.value : 1;
  const shown = Math.min(count, Math.max(scheduled, solo ? turnedHere : 1));
  const choice = picked?.round === here ? picked.value : null;
  const mine = sent?.round === here ? sent.value : null;
  const done = snapshot.youAnswered || mine !== null;
  const labelOf = (index: number | null): string | null =>
    round.options.find((option) => option.index === index)?.label ?? null;

  const lockIn = (): void => {
    if (done || choice === null || snapshot.paused) return;
    setSent({ round: here, value: choice });
    send({ kind: 'answer', round: here, value: { type: 'choice', index: encodeChoice(choice, shown) } });
  };

  // A/B/C/D (case-insensitive) choose the matching name, the same as tapping
  // it — a letter still only chooses; "Lock in" (or another letter, or Enter)
  // is still a separate step, the same as it is for a tap.
  useEffect(() => {
    if (done) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      // A held modifier means a browser or OS shortcut, not an answer.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const index = indexForLetter(event.key);
      if (index === null) return;
      const option = round.options.find((candidate) => candidate.index === index);
      if (!option) return;
      setPicked({ round: here, value: option.index });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [done, round, here]);

  return (
    <section class="wai wai-phone">
      <p class="wai-ask">Who am I?</p>
      <LiveClues clues={round.clues} shown={shown} size="small" />
      <p class="wai-worth">
        Clue {shown} of {count} · worth {worthAt(shown)}
      </p>

      {done ? (
        <div class="wai-locked" role="status">
          <p class="wai-locked-head">
            {mine !== null ? `Locked in: ${labelOf(mine) ?? 'your guess'}` : 'Your guess is in.'}
          </p>
          <p class="wai-muted">One guess each, so you are done with this one. The answer comes at the reveal.</p>
        </div>
      ) : (
        <>
          <p class="wai-rule">{ONE_GUESS_RULE}</p>
          <ul class="wai-taps">
            {round.options.map((option) => (
              <li key={option.index}>
                <button
                  type="button"
                  class="wai-tap"
                  aria-pressed={choice === option.index}
                  onClick={() => setPicked({ round: here, value: option.index })}
                >
                  <span class="wai-letter">{letterFor(option.index)}</span>
                  <span class="wai-name">{option.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            class="wai-lock"
            disabled={choice === null || snapshot.paused}
            onClick={lockIn}
          >
            {snapshot.paused
              ? 'Paused'
              : choice === null
                ? 'Tap a name first'
                : `Lock in ${labelOf(choice) ?? ''}`}
          </button>
          {solo && shown < count && (
            <button
              type="button"
              class="wai-next"
              disabled={snapshot.paused}
              onClick={() => setTurned({ round: here, value: shown + 1 })}
            >
              Next clue · worth {worthAt(shown + 1)}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * A team vote. Each tap is sent at once and carries the clue it was cast at,
 * as a locked-in guess does; the room keeps the latest one until time runs out.
 * A solo room never votes, so there are no clues to turn over here.
 */
function TeamVote({ round, snapshot, clock, send }: LiveProps) {
  const shown = useCluesShown(round, snapshot, clock);
  const [voted, setVoted] = useState<Marked | null>(null);

  const here = snapshot.round;
  // This phone's own last tap first, since the room's echo of it may still be
  // on its way; the echo alone for a phone that has just reloaded.
  const echoed = snapshot.yourAnswer?.type === 'choice' ? decodeChoice(snapshot.yourAnswer.index).option : null;
  const standing = voted?.round === here ? voted.value : echoed;
  const standingLabel = round.options.find((option) => option.index === standing)?.label ?? null;

  const vote = (option: number): void => {
    // The name already voted for, tapped again, would be no new vote; the room
    // ignores it too, so a re-tap can never move the team to a later clue.
    if (snapshot.paused || option === standing) return;
    setVoted({ round: here, value: option });
    send({ kind: 'answer', round: here, value: { type: 'choice', index: encodeChoice(option, shown) } });
  };

  // A/B/C/D (case-insensitive) vote for the matching name, through the exact
  // same path a tap takes.
  useEffect(() => {
    if (snapshot.paused) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      // A held modifier means a browser or OS shortcut, not an answer.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const index = indexForLetter(event.key);
      if (index === null) return;
      const option = round.options.find((candidate) => candidate.index === index);
      if (!option) return;
      vote(option.index);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [snapshot.paused, round, standing, here]);

  return (
    <section class="wai wai-phone">
      <p class="wai-ask">Who am I?</p>
      <LiveClues clues={round.clues} shown={shown} size="small" />
      <p class="wai-worth">
        Clue {shown} of {round.clues.length} · worth {worthAt(shown)}
      </p>
      <p class="wai-rule">{TEAM_VOTE_RULE}</p>
      <ul class="wai-taps">
        {round.options.map((option) => (
          <li key={option.index}>
            <button
              type="button"
              class="wai-tap"
              disabled={snapshot.paused}
              aria-pressed={standing === option.index}
              onClick={() => vote(option.index)}
            >
              <span class="wai-letter">{letterFor(option.index)}</span>
              <span class="wai-name">{option.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <p class="wai-muted" role="status">
        {snapshot.paused
          ? 'Paused.'
          : standingLabel === null
            ? 'Tap a name to vote.'
            : `Your vote: ${standingLabel}. Tap another name to change it.`}
      </p>
    </section>
  );
}

export function PhoneAnswering({ snapshot, view, clock, send }: PlayerViewProps) {
  const round = readRound(view);
  if (!round) return <Nothing line={AWAITING_ROUND} />;
  // The room says whether a guess may change, and in this game only a team
  // vote lets it.
  return snapshot.canChangeAnswer ? (
    <TeamVote round={round} snapshot={snapshot} clock={clock} send={send} />
  ) : (
    <LiveGuess round={round} snapshot={snapshot} clock={clock} send={send} />
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
  const detail = readReveal(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={AWAITING_REVEAL} />;

  const submitted = yourResult?.submitted ?? null;
  const option = submitted?.type === 'choice' ? decodeChoice(submitted.index).option : null;
  const said = option === null ? null : (detail.options[option] ?? null);
  // Only a round decided by team vote carries the teams' splits.
  const teamVote = reveal.groups !== undefined;

  return (
    <section class="wai wai-phone">
      <p class="wai-answer-label">I am</p>
      <h2 class="wai-answer">{detail.person}</h2>

      {yourResult === null ? (
        <p class="wai-yours">No guess from this phone.</p>
      ) : teamVote ? (
        <p class="wai-yours" data-correct={yourResult.correct ? 'true' : 'false'} role="status">
          {teamVerdict(yourResult)}
          {said !== null && !(yourResult.correct && option === detail.correctIndex) && (
            <span class="wai-muted"> You voted {said}.</span>
          )}
        </p>
      ) : (
        <p class="wai-yours" data-correct={yourResult.correct ? 'true' : 'false'} role="status">
          {yourResult.correct ? `Right. ${yourResult.note ?? ''}`.trim() : (yourResult.note ?? 'Not this time.')}
          {said !== null && !yourResult.correct && <span class="wai-muted"> You said {said}.</span>}
        </p>
      )}

      <RevealClues clues={detail.clues} counts={false} size="small" />
    </section>
  );
}
