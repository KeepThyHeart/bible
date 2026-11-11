/**
 * Translated labels for the catalog's game names, scope labels and the
 * familiarity scale. The server catalog speaks English; the client looks each
 * up under a stable key and falls back to the server's text, so a game or scope
 * with no entry still shows what the server sent.
 */
import type { Catalog, Familiarity, GameId } from '../../shared/protocol.js';
import { FAMILIARITY_LABELS } from '../../shared/protocol.js';
import { THEME_PRESET_LABELS } from '../../shared/theme.js';
import { listGameViews } from './gameViews.js';
import { gt } from './t.js';

/** `Whole Bible` -> `wholeBible`, `People of the Bible` -> `peopleOfTheBible`. */
function camelKey(text: string): string {
  return text
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word, index) => (index === 0 ? word.toLowerCase() : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join('');
}

/** `who-said-it` -> `whoSaidIt`. */
function idKey(id: GameId): string {
  return id.replace(/-(\w)/g, (_match, ch: string) => ch.toUpperCase());
}

export function gameName(id: GameId, fallback: string): string {
  return gt(`games.names.${idKey(id)}`, fallback);
}

export function scopeName(label: string): string {
  return gt(`games.scopes.${camelKey(label)}`, label);
}

export function familiarityName(familiarity: Familiarity): string {
  return gt(`games.familiarity.${familiarity}`, FAMILIARITY_LABELS[familiarity]);
}

export function themeName(id: string): string {
  return gt(`games.themes.${id}`, THEME_PRESET_LABELS[id] ?? id);
}

/** `fill-in-the-blank` -> `Fill in the blank`, a readable stand-in when the catalog has not answered. */
export function nameFromId(id: GameId): string {
  const words = id.split('-');
  return words.map((word, index) => (index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word)).join(' ');
}

export interface GameChoice {
  id: GameId;
  name: string;
}

/**
 * The games to offer. The catalog is authoritative; before it has answered (or
 * when it cannot), the games this client has views for are still nameable.
 */
export function gameChoices(catalog: Catalog): GameChoice[] {
  if (catalog.games.length > 0) {
    return catalog.games.map((game) => ({ id: game.id, name: gameName(game.id, game.name) }));
  }
  return listGameViews().map((views) => ({ id: views.id, name: gameName(views.id, nameFromId(views.id)) }));
}

/** One game's display name, whether or not the catalog knows it. */
export function gameTitle(catalog: Catalog, id: GameId): string {
  const known = catalog.games.find((game) => game.id === id);
  return gameName(id, known?.name ?? nameFromId(id));
}

/** Sword drill carries its own setting for how players buzz in (`gameOptions.buzzMode`). */
export const BUZZ_MODE_GAME: GameId = 'sword-drill';

export function hasBuzzModeOption(id: GameId): boolean {
  return id === BUZZ_MODE_GAME;
}
