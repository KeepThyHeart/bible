/**
 * The big screen.
 *
 * The guessers are facing it, so it must never answer for them: it shows the
 * describing team, who is describing and the cards got so far, and never the
 * card in play, a passed card or who called a slip. The server keeps those out
 * of this screen's payload; nothing here could draw them if it tried.
 *
 * The end of a turn says what the team got and who is up next, and no totals.
 * A running score between turns turns the next minute into a chase, so the
 * standings wait for the end of the game.
 */

import type { PublicPlayer, TeamId } from '../../../shared/protocol.js';
import type { HostViewProps } from '../../shell/gameViews.js';
import { teamLabel } from '../../shell/teams.js';
import { nameOf, readHostTurn, readReveal } from './payload.js';
import type { HostTurn } from './payload.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="di di-host">
      <p class="di-nothing">{line}</p>
    </section>
  );
}

export function TeamPill({ teamId }: { teamId: TeamId }) {
  return (
    <span class="di-team" data-team={teamId}>
      <span class="team-swatch" aria-hidden="true" />
      {teamLabel(teamId)} team
    </span>
  );
}

export function GotChips({ got }: { got: readonly string[] }) {
  return (
    <ul class="di-chips">
      {got.map((concept, index) => (
        <li key={`${index}:${concept}`} class="di-chip">
          {concept}
        </li>
      ))}
    </ul>
  );
}

/** Who is being called on to guess, in the room's own words. */
function callTo(teamId: TeamId | null): string {
  return teamId === null ? 'Everyone' : `${teamLabel(teamId)} team`;
}

function Describing({ turn, players }: { turn: HostTurn; players: readonly PublicPlayer[] }) {
  return (
    <>
      {turn.teamId !== null && <TeamPill teamId={turn.teamId} />}
      <p class="di-describer">{nameOf(players, turn.describer)} is describing</p>
    </>
  );
}

/** The get-ready: the room turns to face the describer before the clock starts. */
export function HostQuestion({ snapshot, view }: HostViewProps) {
  const turn = readHostTurn(view);
  if (turn === null) return <Nothing line="Nothing to describe this turn." />;
  return (
    <section class="di di-host">
      <Describing turn={turn} players={snapshot.players} />
      <p class="di-call">{callTo(turn.teamId)}, get ready to guess out loud.</p>
    </section>
  );
}

export function HostAnswering({ snapshot, view }: HostViewProps) {
  const turn = readHostTurn(view);
  if (turn === null) return <Nothing line="Nothing to describe this turn." />;
  return (
    <section class="di di-host">
      <Describing turn={turn} players={snapshot.players} />
      <p class="di-call">{callTo(turn.teamId)}, guess out loud.</p>
      {turn.deckOut && (
        <p class="di-notice" role="status">
          {turn.deckSize === 0
            ? 'There are no cards to describe on this server.'
            : 'That was every card in the deck. End the turn when you are ready.'}
        </p>
      )}
      {turn.got.length > 0 && (
        <div class="di-got">
          <p class="di-label">Got so far · {turn.got.length}</p>
          <GotChips got={turn.got} />
        </div>
      )}
    </section>
  );
}

export function HostReveal({ snapshot, reveal }: HostViewProps) {
  const detail = readReveal(reveal?.detail);
  if (reveal === null || detail === null) return <Nothing line="Nothing to show for this turn." />;

  const describer = nameOf(snapshot.players, detail.describer);
  const last = detail.next === null || snapshot.round + 1 >= snapshot.totalRounds;

  return (
    <section class="di di-host di-turn-end">
      <div class="di-column">
        <p class="di-label">Time</p>
        <h2 class="di-total">{reveal.correctLabel}</h2>
        {detail.got.length > 0 && <GotChips got={detail.got} />}
        {detail.deckOut && <p class="di-muted">They got through the whole deck.</p>}
        <p class="di-thanks">
          {detail.got.length > 0 ? `Well described, ${describer}.` : `Thanks for describing, ${describer}.`}
        </p>
      </div>
      <div class="di-column">
        {last || detail.next === null ? (
          <p class="di-label">That was the last turn</p>
        ) : (
          <>
            <p class="di-label">Up next</p>
            <p class="di-next" data-team={detail.next.teamId ?? 'none'}>
              {detail.next.teamId !== null && <span class="team-swatch" aria-hidden="true" />}
              <span>
                {detail.next.teamId === null
                  ? `${nameOf(snapshot.players, detail.next.describer)} describes`
                  : `${teamLabel(detail.next.teamId)} team — ${nameOf(snapshot.players, detail.next.describer)} describes`}
              </span>
            </p>
          </>
        )}
        <p class="di-muted">Team totals wait for the end of the game.</p>
      </div>
    </section>
  );
}
