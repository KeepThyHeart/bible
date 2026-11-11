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
import { gt } from '../../shell/t.js';
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
      {gt('games.describeIt.view.teamName', '{team} team', { team: teamLabel(teamId) })}
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
  return teamId === null
    ? gt('games.describeIt.view.everyone', 'Everyone')
    : gt('games.describeIt.view.teamName', '{team} team', { team: teamLabel(teamId) });
}

function Describing({ turn, players }: { turn: HostTurn; players: readonly PublicPlayer[] }) {
  return (
    <>
      {turn.teamId !== null && <TeamPill teamId={turn.teamId} />}
      <p class="di-describer">{gt('games.describeIt.view.isDescribing', '{name} is describing', { name: nameOf(players, turn.describer) })}</p>
    </>
  );
}

/** The get-ready: the room turns to face the describer before the clock starts. */
export function HostQuestion({ snapshot, view }: HostViewProps) {
  const turn = readHostTurn(view);
  if (turn === null) return <Nothing line={gt('games.describeIt.view.nothingToDescribe', 'Nothing to describe this turn.')} />;
  return (
    <section class="di di-host">
      <Describing turn={turn} players={snapshot.players} />
      <p class="di-call">{gt('games.describeIt.view.callReady', '{who}, get ready to guess out loud.', { who: callTo(turn.teamId) })}</p>
    </section>
  );
}

export function HostAnswering({ snapshot, view }: HostViewProps) {
  const turn = readHostTurn(view);
  if (turn === null) return <Nothing line={gt('games.describeIt.view.nothingToDescribe', 'Nothing to describe this turn.')} />;
  return (
    <section class="di di-host">
      <Describing turn={turn} players={snapshot.players} />
      <p class="di-call">{gt('games.describeIt.view.callGuess', '{who}, guess out loud.', { who: callTo(turn.teamId) })}</p>
      {turn.deckOut && (
        <p class="di-notice" role="status">
          {turn.deckSize === 0
            ? gt('games.describeIt.view.noCards', 'There are no cards to describe on this server.')
            : gt('games.describeIt.view.deckOutEnd', 'That was every card in the deck. End the turn when you are ready.')}
        </p>
      )}
      {turn.got.length > 0 && (
        <div class="di-got">
          <p class="di-label">{gt('games.describeIt.view.gotSoFar', 'Got so far · {count}', { count: turn.got.length })}</p>
          <GotChips got={turn.got} />
        </div>
      )}
    </section>
  );
}

export function HostReveal({ snapshot, reveal }: HostViewProps) {
  const detail = readReveal(reveal?.detail);
  if (reveal === null || detail === null) return <Nothing line={gt('games.describeIt.view.nothingToShow', 'Nothing to show for this turn.')} />;

  const describer = nameOf(snapshot.players, detail.describer);
  const last = detail.next === null || snapshot.round + 1 >= snapshot.totalRounds;

  return (
    <section class="di di-host di-turn-end">
      <div class="di-column">
        <p class="di-label">{gt('games.describeIt.view.time', 'Time')}</p>
        <h2 class="di-total">{reveal.correctLabel}</h2>
        {detail.got.length > 0 && <GotChips got={detail.got} />}
        {detail.deckOut && <p class="di-muted">{gt('games.describeIt.view.wholeDeck', 'They got through the whole deck.')}</p>}
        <p class="di-thanks">
          {detail.got.length > 0
            ? gt('games.describeIt.view.wellDescribed', 'Well described, {name}.', { name: describer })
            : gt('games.describeIt.view.thanksDescribing', 'Thanks for describing, {name}.', { name: describer })}
        </p>
      </div>
      <div class="di-column">
        {last || detail.next === null ? (
          <p class="di-label">{gt('games.describeIt.view.lastTurn', 'That was the last turn')}</p>
        ) : (
          <>
            <p class="di-label">{gt('games.describeIt.view.upNext', 'Up next')}</p>
            <p class="di-next" data-team={detail.next.teamId ?? 'none'}>
              {detail.next.teamId !== null && <span class="team-swatch" aria-hidden="true" />}
              <span>
                {detail.next.teamId === null
                  ? gt('games.describeIt.view.nextDescribes', '{name} describes', { name: nameOf(snapshot.players, detail.next.describer) })
                  : gt('games.describeIt.view.nextTeamDescribes', '{team} team — {name} describes', {
                      team: teamLabel(detail.next.teamId),
                      name: nameOf(snapshot.players, detail.next.describer),
                    })}
              </span>
            </p>
          </>
        )}
        <p class="di-muted">{gt('games.describeIt.view.totalsWait', 'Team totals wait for the end of the game.')}</p>
      </div>
    </section>
  );
}
