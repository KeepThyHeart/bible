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
import { TEAM_LABELS, ordinal } from './teams.js';
import { rankToShow } from './PhoneFrame.js';

export function HostSummary({ snapshot }: { snapshot: ScreenSnapshot }) {
  const { standings, teamStandings, settings } = snapshot;

  return (
    <section class="summary">
      <h2>That is the game</h2>

      {settings.teamsEnabled && teamStandings.length > 0 && (
        <ol class="team-standings">
          {teamStandings.map((team) => (
            <li key={team.teamId} data-team={team.teamId}>
              <span class="team-swatch" aria-hidden="true" />
              <span class="team-name">{TEAM_LABELS[team.teamId]}</span>
              <span class="team-score">{team.score}</span>
              <span class="muted small">
                {team.playerCount} {team.playerCount === 1 ? 'player' : 'players'}
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

export function PhoneSummary({ snapshot }: { snapshot: PlayerSnapshot }) {
  const rank = rankToShow(snapshot.yourRank);

  return (
    <section class="summary">
      <h2>Well played</h2>
      <p class="final-total">
        Your total <strong>{snapshot.yourScore}</strong>
      </p>
      {rank !== null && <p class="final-rank">{ordinal(rank)} place</p>}
      <p class="muted">Look up at the big screen.</p>
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
      <h2>That’s the game</h2>
      <p class="final-total">
        Your total <strong>{snapshot.yourScore}</strong>
      </p>
      <p class="muted">Played {snapshot.totalRounds} rounds on your own.</p>
    </section>
  );
}
