/**
 * The end of a game.
 *
 * The big screen celebrates: team totals, and the names the server was willing
 * to send — a top three unless the host turned individual scores on. There is
 * no full ordering here to render, and that is the point rather than an
 * omission. Each phone gets its own total, and a placing only when the placing
 * is worth hearing.
 */

import type { PlayerSnapshot, ScreenSnapshot } from '../../shared/protocol.js';
import { ordinal, teamLabel } from './teams.js';
import { rankToShow } from './PhoneFrame.js';
import { gt } from './t.js';
import { waitingForOrganizer } from './waitingCopy.js';

export function HostSummary({ snapshot }: { snapshot: ScreenSnapshot }) {
  const { standings, teamStandings, settings } = snapshot;

  return (
    <section class="summary">
      <h2>{gt('games.summary.thatIsTheGame', 'That is the game')}</h2>

      {settings.teamsEnabled && teamStandings.length > 0 && (
        <ol class="team-standings">
          {teamStandings.map((team) => (
            <li key={team.teamId} data-team={team.teamId}>
              <span class="team-swatch" aria-hidden="true" />
              <span class="team-name">{teamLabel(team.teamId)}</span>
              <span class="team-score">{team.score}</span>
              <span class="muted small">
                {team.playerCount === 1 ? gt('games.screen.onePlayer', '1 player') : gt('games.screen.playerCount', '{count} players', { count: team.playerCount })}
              </span>
            </li>
          ))}
        </ol>
      )}

      {standings.length > 0 && (
        <ol class="standings">
          {standings.map((standing, index) => (
            <li key={standing.playerId}>
              <span class="place">{ordinal(index + 1)}</span>
              <span class="who">{standing.name}</span>
              <span class="score">{standing.score}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * A player's own result. A phone that is not running the game is told what
 * the room is waiting on; a phone that holds control is given the organizer's
 * summary beside this one instead.
 */
export function PhoneSummary({ snapshot }: { snapshot: PlayerSnapshot }) {
  const rank = rankToShow(snapshot.yourRank);

  return (
    <section class="summary">
      <h2>{gt('games.summary.wellPlayed', 'Well played')}</h2>
      <p class="final-total">
        {gt('games.phone.scoreYou', 'You:')} <strong>{snapshot.yourScore}</strong>
        {rank !== null && ` ${gt('games.phone.scoreRank', '· {rank}', { rank: ordinal(rank) })}`}
      </p>
      {snapshot.control === undefined && <p class="muted">{waitingForOrganizer()}</p>}
    </section>
  );
}

/**
 * Solo's own ending, rather than the group's summary reused verbatim.
 * "Look up at the big screen" told a solo player to look at a screen that
 * does not exist for them, and a placing has no meaning when there was
 * nobody else in the room to place among.
 */
export function SoloSummary({ snapshot }: { snapshot: PlayerSnapshot }) {
  return (
    <section class="summary">
      <h2>{gt('games.summary.thatsTheGame', 'That’s the game')}</h2>
      <p class="final-total">
        {gt('games.summary.yourTotal', 'Your total')} <strong>{snapshot.yourScore}</strong>
      </p>
      <p class="muted">{gt('games.summary.playedSolo', 'Played {count} rounds on your own.', { count: snapshot.totalRounds })}</p>
    </section>
  );
}
