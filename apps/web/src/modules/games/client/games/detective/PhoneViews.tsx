/**
 * The phone.
 *
 * It holds one thing the room does not have — this player's clue — and says so
 * plainly, because the case is only solved once people read theirs aloud. The
 * vote is four whole-row buttons, and it can change until time runs out: a tap
 * on another name moves the vote, and the phone always says which name it
 * currently stands on, from the server's own echo when it has one.
 *
 * At the reveal the answer and the group's verdict are the headline. How this
 * player voted is said here and nowhere else: a player who voted against a
 * right majority still scores, and nobody else ever learns they dissented.
 *
 * The four names also answer to the keyboard: `a`/`b`/`c`/`d` (case-
 * insensitive) select the matching name, through the exact same path a tap
 * takes.
 */

import { useEffect, useState } from 'preact/hooks';
import type { PersonalResult } from '../../../shared/protocol.js';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { AWAITING_REVEAL, AWAITING_ROUND } from '../../shell/waitingCopy.js';
import { groupOf, indexForLetter, letterFor, readPhoneCase, readReveal } from './payload.js';
import type { CaseOption } from './payload.js';

function Nothing({ line }: { line: string }) {
  return <p class="det-nothing">{line}</p>;
}

function Waiting() {
  return (
    <section class="det det-phone">
      <p class="det-nothing">The clues were dealt before you joined. You are in from the next case.</p>
    </section>
  );
}

function LockIcon() {
  return (
    <svg class="det-lock" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function ClueCard({ clue, shared, teamsEnabled }: { clue: string; shared: boolean; teamsEnabled: boolean }) {
  const who = teamsEnabled ? 'your team' : 'the room';
  return (
    <section class="det-yours" aria-label="Your clue">
      <p class="det-label det-label-icon">
        <LockIcon />
        Your clue
      </p>
      <div class="det-clue-card">
        <p class="det-clue-text">{clue}</p>
      </div>
      <p class="det-muted det-small">
        {shared ? 'Another phone has this one too.' : 'Only this phone has it.'} Read it out — {who} needs
        every clue.
      </p>
    </section>
  );
}

export function PhoneQuestion({ snapshot, view }: PlayerViewProps) {
  const dealt = readPhoneCase(view);
  if (!dealt) return <Nothing line={AWAITING_ROUND} />;
  if (dealt.kind === 'waiting') return <Waiting />;
  return (
    <section class="det det-phone">
      <ClueCard clue={dealt.clue} shared={dealt.shared} teamsEnabled={snapshot.settings.teamsEnabled} />
      <p class="det-muted">Voting opens in a moment.</p>
    </section>
  );
}

/** A tap, remembered with its round so the next case starts clean. */
interface Tapped {
  round: number;
  index: number;
}

export function PhoneAnswering({ snapshot, view, send }: PlayerViewProps) {
  const dealt = readPhoneCase(view);
  const [tapped, setTapped] = useState<Tapped | null>(null);

  const here = snapshot.round;
  const echoed = snapshot.yourAnswer?.type === 'choice' ? snapshot.yourAnswer.index : null;
  // The tap is shown at once, before the server's echo arrives; a person who
  // is not sure their tap registered taps again.
  const standing = tapped?.round === here ? tapped.index : echoed;

  const choose = (index: number): void => {
    if (snapshot.paused || index === standing) return;
    setTapped({ round: here, index });
    send({ kind: 'answer', round: here, value: { type: 'choice', index } });
  };

  // A/B/C/D (case-insensitive) select the matching name through the exact
  // same path a tap takes. A hook cannot come after an early return, so this
  // is registered on every render and is simply a no-op once there are no
  // options to vote on with a letter.
  useEffect(() => {
    if (!dealt || dealt.kind !== 'clue') return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      // A held modifier means a browser or OS shortcut, not an answer.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const index = indexForLetter(event.key);
      if (index === null) return;
      const option = dealt.options.find((candidate: CaseOption) => candidate.index === index);
      if (!option) return;
      choose(option.index);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dealt, standing, snapshot.paused, here]);

  if (!dealt) return <Nothing line={AWAITING_ROUND} />;
  if (dealt.kind === 'waiting') return <Waiting />;

  const labelOf = (index: number | null): string | null =>
    dealt.options.find((option: CaseOption) => option.index === index)?.label ?? null;

  const current = labelOf(standing);

  return (
    <section class="det det-phone">
      <ClueCard clue={dealt.clue} shared={dealt.shared} teamsEnabled={snapshot.settings.teamsEnabled} />

      <section class="det-vote" aria-label="Your vote">
        <p class="det-ask">Your vote</p>
        <ul class="det-taps">
          {dealt.options.map((option) => (
            <li key={option.index}>
              <button
                type="button"
                class="det-tap"
                aria-pressed={standing === option.index}
                disabled={snapshot.paused}
                onClick={() => choose(option.index)}
              >
                <span class="det-letter">{letterFor(option.index)}</span>
                <span class="det-name">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <p class="det-muted det-small" role="status">
          {snapshot.paused
            ? 'Paused.'
            : current === null
              ? 'Tap a name to vote. You can change it until time runs out.'
              : `Voted: ${current}. You can change it until time runs out.`}
        </p>
      </section>
    </section>
  );
}

/** The one line about this player's own vote, which only this phone ever shows. */
export function ownLine(
  result: PersonalResult | null,
  options: readonly string[],
  person: string,
  carried: boolean,
  who: string
): string {
  if (result === null) return 'This phone was not dealt in to this case.';
  const voted = result.submitted?.type === 'choice' ? (options[result.submitted.index] ?? null) : null;
  if (voted === null) {
    return carried ? `You didn’t vote — ${who} carried it, and you score with them.` : 'No vote from this phone.';
  }
  if (!carried) return `You voted ${voted}.`;
  return voted === person
    ? `You voted ${voted} with ${who}.`
    : `You voted ${voted} — ${who} carried it, and you score with them.`;
}

export function PhoneReveal({ snapshot, view, reveal, yourResult }: PlayerViewProps) {
  const detail = readReveal(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={AWAITING_REVEAL} />;

  const teams = snapshot.settings.teamsEnabled;
  const who = teams ? 'your team' : 'the room';
  const Who = teams ? 'Your team' : 'The room';
  const group = groupOf(reveal.groups, teams, snapshot.you.teamId);
  const carried = group?.correct === true;

  const headline =
    group === null
      ? null
      : group.correct === true
        ? `${Who} got it`
        : group.decided !== null
          ? `${Who} chose ${group.decided}`
          : group.split.length === 0
            ? 'Nobody voted'
            : `${Who} was split — no answer`;

  const dealt = readPhoneCase(view);
  const mine = dealt?.kind === 'clue' ? dealt.clue : null;
  const reference = detail.clues.find((clue) => clue.text === mine)?.reference ?? null;

  return (
    <section class="det det-phone">
      <p class="det-label">The answer</p>
      <h2 class="det-answer">{detail.person}</h2>
      {headline !== null && (
        <p class="det-verdict" data-tone={carried ? 'correct' : 'none'}>
          {carried && <span aria-hidden="true">✓ </span>}
          {headline}
        </p>
      )}

      {mine !== null && (
        <div class="det-clue-card det-clue-card-quiet">
          <span class="det-label">Your clue</span>
          <span>{mine}</span>
          {reference !== null && <span class="det-muted det-small">{reference}</span>}
        </div>
      )}

      <p class="det-own" role="status">
        {ownLine(yourResult, detail.options, detail.person, carried, who)}
      </p>
    </section>
  );
}
