/**
 * Reading what the server sent, rather than trusting it.
 *
 * A view arrives as `unknown`, and it genuinely can be: a phone on yesterday's
 * bundle, a room whose game changed while a screen slept. Each payload is read
 * into a shape or into null, and a null draws a line of plain text rather than
 * an exception across a projector.
 *
 * The shapes are declared here as well as on the server on purpose: what
 * passes between the two is the wire, not a type.
 */

import type { PlayerId, PublicPlayer, TeamId } from '../../../shared/protocol.js';
import { TEAM_IDS } from '../../../shared/protocol.js';

/** Stable identifier for this game, matching the server module's. */
export const GAME_ID = 'describe-it';

export interface CardFace {
  concept: string;
  category: string;
  forbidden: string[];
}

/** The big screen: who is describing and what has been got. Never a live card. */
export interface HostTurn {
  role: 'host';
  teamId: TeamId | null;
  describer: PlayerId | null;
  got: string[];
  deckOut: boolean;
  deckSize: number;
}

export interface Describer {
  role: 'describer';
  teamId: TeamId | null;
  card: CardFace | null;
  cardIndex: number;
  deckOut: boolean;
  called: boolean;
}

export interface Guesser {
  role: 'guesser';
  teamId: TeamId | null;
  describer: PlayerId;
  gotCount: number;
}

export interface Watcher {
  role: 'watcher';
  teamId: TeamId | null;
  describer: PlayerId;
  card: CardFace | null;
  cardIndex: number;
  deckOut: boolean;
}

export interface Waiting {
  role: 'waiting';
}

export type PhoneTurn = Describer | Guesser | Watcher | Waiting;

export interface TurnReveal {
  teamId: TeamId | null;
  describer: PlayerId | null;
  got: string[];
  deckOut: boolean;
  next: { teamId: TeamId | null; describer: PlayerId } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** A team the shell knows, or null — for no team, and for anything unrecognised. */
export function teamOf(value: unknown): TeamId | null {
  return TEAM_IDS.find((teamId) => teamId === value) ?? null;
}

function readCard(value: unknown): CardFace | null {
  if (!isRecord(value)) return null;
  const concept = stringAt(value, 'concept');
  if (concept === null || concept.length === 0) return null;
  return { concept, category: stringAt(value, 'category') ?? '', forbidden: strings(value['forbidden']) };
}

export function readHostTurn(view: unknown): HostTurn | null {
  if (!isRecord(view) || view['role'] !== 'host') return null;
  return {
    role: 'host',
    teamId: teamOf(view['teamId']),
    describer: stringAt(view, 'describer'),
    got: strings(view['got']),
    deckOut: view['deckOut'] === true,
    deckSize: count(view['deckSize']),
  };
}

export function readPhoneTurn(view: unknown): PhoneTurn | null {
  if (!isRecord(view)) return null;
  const teamId = teamOf(view['teamId']);
  switch (view['role']) {
    case 'waiting':
      return { role: 'waiting' };
    case 'describer':
      return {
        role: 'describer',
        teamId,
        card: readCard(view['card']),
        cardIndex: count(view['cardIndex']),
        deckOut: view['deckOut'] === true,
        called: view['called'] === true,
      };
    case 'guesser': {
      const describer = stringAt(view, 'describer');
      if (describer === null) return null;
      return { role: 'guesser', teamId, describer, gotCount: count(view['gotCount']) };
    }
    case 'watcher': {
      const describer = stringAt(view, 'describer');
      if (describer === null) return null;
      return {
        role: 'watcher',
        teamId,
        describer,
        card: readCard(view['card']),
        cardIndex: count(view['cardIndex']),
        deckOut: view['deckOut'] === true,
      };
    }
    default:
      return null;
  }
}

export function readReveal(detail: unknown): TurnReveal | null {
  if (!isRecord(detail)) return null;
  const next = detail['next'];
  const nextDescriber = isRecord(next) ? stringAt(next, 'describer') : null;
  return {
    teamId: teamOf(detail['teamId']),
    describer: stringAt(detail, 'describer'),
    got: strings(detail['got']),
    deckOut: detail['deckOut'] === true,
    next:
      isRecord(next) && nextDescriber !== null
        ? { teamId: teamOf(next['teamId']), describer: nextDescriber }
        : null,
  };
}

/** A name for an id, or a word that names nobody when the player has left. */
export function nameOf(players: readonly PublicPlayer[], id: PlayerId | null): string {
  return players.find((player) => player.id === id)?.name ?? 'Someone';
}
