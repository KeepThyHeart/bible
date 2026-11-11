/**
 * The end of a game on the big screen: the game's name and the top three on a
 * podium. The server sends at most three names (and none when scores are
 * withheld), so a last place cannot be drawn here. With teams on, the teams'
 * totals are listed under the podium.
 */

import type { Standing, TeamStanding } from '../../shared/protocol.js';
import { ordinal, teamLabel } from './teams.js';
import { gt } from './t.js';

export interface PodiumProps {
  gameLabel: string;
  standings: readonly Standing[];
  teamStandings: readonly TeamStanding[];
  teamsEnabled: boolean;
}

export function Podium({ gameLabel, standings, teamStandings, teamsEnabled }: PodiumProps) {
  const places = standings.slice(0, 3);
  const teams = teamsEnabled ? teamStandings : [];

  return (
    <section class="podium-screen">
      <h2 class="podium-title">{gameLabel}</h2>
      {places.length > 0 ? (
        <ol class="podium" aria-label={gt('games.screen.finalScores', 'Final scores')}>
          {places.map((standing, index) => (
            <li
              key={standing.playerId}
              class="podium-step"
              data-place={index + 1}
              {...(teamsEnabled && standing.teamId !== null ? { 'data-team': standing.teamId } : {})}
            >
              <span class="podium-place">{ordinal(index + 1)}</span>
              <span class="podium-name">{standing.name}</span>
              <span class="podium-score">{standing.score}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p class="podium-note">{gt('games.screen.wellPlayed', 'Well played.')}</p>
      )}
      {teams.length > 0 && (
        <ul class="podium-teams">
          {teams.map((team) => (
            <li key={team.teamId} data-team={team.teamId}>
              <span class="team-name">{teamLabel(team.teamId)}</span>
              <span class="team-score">{team.score}</span>
            </li>
          ))}
        </ul>
      )}
      <p class="podium-note">{gt('games.screen.onTheirPhones', 'Everyone else is on their own phone.')}</p>
    </section>
  );
}
