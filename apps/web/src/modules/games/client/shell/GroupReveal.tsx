/**
 * How each team voted, under a group-vote round's reveal.
 *
 * The shell draws this rather than each game because the rules it reports —
 * majority, tie, everyone scoring the team's choice — belong to the room, and
 * every game played as a vote should report them the same way. The game's own
 * reveal view above it still shows the answer and the room's split.
 *
 * Counts only. The payload has no shape that could name a voter, so neither
 * can this.
 */

import type { GroupResult } from '../../shared/protocol.js';
import { TEAM_LABELS } from './teams.js';

export interface GroupRevealProps {
  groups: readonly GroupResult[];
}

function groupName(group: GroupResult, only: boolean): string {
  if (group.teamId !== null) return TEAM_LABELS[group.teamId];
  return only ? 'The room' : 'No team';
}

function outcome(group: GroupResult): string {
  if (group.decided === null) return group.split.length === 0 ? 'No votes' : 'Split — no answer';
  return group.correct === true ? `${group.decided} — right` : `${group.decided} — not this time`;
}

export function GroupReveal({ groups }: GroupRevealProps) {
  const only = groups.length === 1;
  return (
    <section class="group-reveal" aria-label="How each team voted">
      {groups.map((group) => (
        <div
          key={group.teamId ?? 'none'}
          class="group-card"
          data-team={group.teamId ?? 'none'}
          data-correct={group.correct === null ? 'none' : String(group.correct)}
        >
          <h3 class="group-name">{groupName(group, only)}</h3>
          <p class="group-outcome">{outcome(group)}</p>
          {group.split.length > 0 && (
            <ul class="group-split">
              {group.split.map((row) => (
                <li key={row.label}>
                  <span class="group-split-label">{row.label}</span>
                  <span class="group-split-count">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
