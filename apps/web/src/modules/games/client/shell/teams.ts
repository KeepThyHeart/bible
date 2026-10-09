/**
 * Team identity.
 *
 * A hue on its own is not identity: it is invisible to a colour-blind player,
 * to a projector that has eaten the contrast, and to a screen reader. Every
 * place a team appears carries the name as text, and the colour is the
 * decoration on top of it.
 */

import type { TeamId } from '../../shared/protocol.js';

export const TEAM_LABELS: Record<TeamId, string> = {
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  gold: 'Gold',
};

export function teamLabel(teamId: TeamId | null): string {
  return teamId === null ? 'No team' : TEAM_LABELS[teamId];
}

/** The tokens are defined per team in the stylesheet. */
export function teamColour(teamId: TeamId | null): string {
  return teamId === null ? 'var(--fg-muted)' : `var(--team-${teamId})`;
}

/**
 * "1st", "2nd", "3rd", "4th", ... and, because English's exception eats its
 * own rule, "11th", "12th" and "13th" rather than "11st", "12nd", "13rd". A
 * phone's own rank never reaches double digits (`PhoneFrame` caps what a
 * player is told at `RANK_SHOWN_THROUGH`), but the host's "everyone"
 * standings can show a whole room, and a room past twenty needs the teens
 * rule to apply again at 21-23.
 */
export function ordinal(rank: number): string {
  const remainder100 = rank % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}
