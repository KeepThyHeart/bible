/**
 * The top three, along the foot of the screen after an answer.
 *
 * Only ever the names the server sent: it trims the list to three and empties
 * it when scores are withheld, so there is no last place to draw and nothing to
 * draw when the room has asked not to see scores. Teams replace players when
 * teams are on.
 */

import type { Standing, TeamStanding } from '../../shared/protocol.js';
import { teamLabel } from './teams.js';
import { gt } from './t.js';

export interface ScoreStripProps {
  standings: readonly Standing[];
  teamStandings: readonly TeamStanding[];
  teamsEnabled: boolean;
}

const SHOWN = 3;

interface Entry {
  key: string;
  label: string;
  score: number;
  team: string | null;
}

export function ScoreStrip({ standings, teamStandings, teamsEnabled }: ScoreStripProps) {
  const entries: Entry[] =
    teamsEnabled && teamStandings.length > 0
      ? [...teamStandings]
          .sort((a, b) => b.score - a.score)
          .slice(0, SHOWN)
          .map((team) => ({ key: team.teamId, label: teamLabel(team.teamId), score: team.score, team: team.teamId }))
      : standings.slice(0, SHOWN).map((standing) => ({
          key: standing.playerId,
          label: standing.name,
          score: standing.score,
          team: teamsEnabled ? standing.teamId : null,
        }));

  if (entries.length === 0) return null;

  return (
    <ol class="score-strip" aria-label={gt('games.screen.topScores', 'Top scores')}>
      {entries.map((entry, index) => (
        <li key={entry.key} {...(entry.team !== null ? { 'data-team': entry.team } : {})}>
          <span class="score-strip-place">{index + 1}</span>
          <span class="score-strip-name">{entry.label}</span>
          <span class="score-strip-score">{entry.score}</span>
        </li>
      ))}
    </ol>
  );
}
