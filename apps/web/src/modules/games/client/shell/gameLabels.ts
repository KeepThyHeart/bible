/**
 * Translated labels for the catalog's game names, scope labels and the
 * familiarity scale. The server catalog speaks English; the client looks each
 * up under a stable key and falls back to the server's text, so a game or scope
 * with no entry still shows what the server sent.
 */
import type { Familiarity, GameId } from '../../shared/protocol.js';
import { FAMILIARITY_LABELS } from '../../shared/protocol.js';
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
