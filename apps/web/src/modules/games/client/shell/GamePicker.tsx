/**
 * Choosing a game, as cards that say how each one plays and what it needs.
 * A few chips narrow the list by the kind of evening.
 */

import { useState } from 'preact/hooks';
import type { Catalog, GameId } from '../../shared/protocol.js';
import '../styles/organize.css';
import { gameChoices } from './gameLabels.js';
import { getGameViews } from './gameViews.js';
import type { GameTag } from './gameViews.js';
import { gt } from './t.js';
import { useHeadingFocus } from './useHeadingFocus.js';

type Filter = 'all' | 'quick' | 'teams' | 'outLoud';

const FILTERS: readonly Filter[] = ['all', 'quick', 'teams', 'outLoud'];

/** The card tag a filter keeps. */
const FILTER_TAG: Record<Exclude<Filter, 'all'>, GameTag> = {
  quick: 'everyone',
  teams: 'teams',
  outLoud: 'outLoud',
};

function filterLabel(filter: Filter): string {
  switch (filter) {
    case 'all':
      return gt('games.organize.filter.all', 'All');
    case 'quick':
      return gt('games.organize.filter.quick', 'Quick quiz');
    case 'teams':
      return gt('games.organize.filter.teams', 'Teams');
    case 'outLoud':
      return gt('games.organize.filter.outLoud', 'Out loud');
  }
}

function tagLabel(tag: GameTag): string {
  switch (tag) {
    case 'everyone':
      return gt('games.organize.tag.everyone', 'Everyone answers');
    case 'teams':
      return gt('games.organize.tag.teams', 'Teams');
    case 'outLoud':
      return gt('games.organize.tag.outLoud', 'Out loud');
    case 'bibles':
      return gt('games.organize.tag.bibles', 'Bibles needed');
    case 'fourPlus':
      return gt('games.organize.tag.fourPlus', '4+ players');
  }
}

export interface GamePickerProps {
  catalog: Catalog;
  onPick(gameId: GameId): void;
  onBack?(): void;
}

export function GamePicker({ catalog, onPick, onBack }: GamePickerProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const headingRef = useHeadingFocus();

  const games = gameChoices(catalog).filter((game) => {
    if (filter === 'all') return true;
    return getGameViews(game.id)?.card?.tags.includes(FILTER_TAG[filter]) ?? false;
  });

  return (
    <main class="screen org-screen">
      <h1 class="org-title" tabIndex={-1} ref={headingRef}>
        {gt('games.organize.pickTitle', 'Pick a game')}
      </h1>

      <div class="org-chips" role="group" aria-label={gt('games.organize.filterLabel', 'Kinds of game')}>
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            class="org-chip"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {filterLabel(option)}
          </button>
        ))}
      </div>

      {games.length === 0 ? (
        <p class="muted">{gt('games.organize.noMatch', 'No game matches that.')}</p>
      ) : (
        <ul class="org-cards">
          {games.map((game) => {
            const card = getGameViews(game.id)?.card;
            return (
              <li key={game.id}>
                <button type="button" class="org-card" onClick={() => onPick(game.id)}>
                  <span class="org-card-name">{game.name}</span>
                  {card !== undefined && (
                    <>
                      <span class="org-card-text">{gt(card.descriptionKey, card.descriptionFallback)}</span>
                      <span class="org-tags">
                        {card.tags.map((tag) => (
                          <span key={tag} class="org-tag">
                            {tagLabel(tag)}
                          </span>
                        ))}
                        <span class="org-tag">
                          {gt('games.organize.minutes', '{count} min', { count: card.minutes })}
                        </span>
                      </span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {onBack !== undefined && (
        <button type="button" class="btn-quiet" onClick={onBack}>
          {gt('games.organize.back', 'Back')}
        </button>
      )}
    </main>
  );
}
