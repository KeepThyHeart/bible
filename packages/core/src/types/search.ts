/**
 * Shared Search Types
 *
 * Central type definitions for the search feature used across
 * models, services, controllers, and UI components.
 */

import { VerseId } from '../Data/Core/Types';

// ============================================================================
// Search Result Types
// ============================================================================

/**
 * Type of match (exact, fuzzy, or stem-based)
 */
export type MatchType = 'exact' | 'fuzzy' | 'stem';

/**
 * A single match within text
 */
export interface Match {
  term: string;              // The matched term
  startPos: number;          // Starting position in text
  endPos: number;            // Ending position in text
  type?: MatchType;          // Type of match
}

/**
 * A search result representing one or more matched verses
 */
export interface SearchResult {
  verseId: VerseId;          // Primary verse ID
  verseIds?: VerseId[];      // Multiple verse IDs (for multi-verse proximity results)
  module: string;            // Module abbreviation (e.g., "kjv")
  reference: string;         // Human-readable reference (e.g., "John 3:16" or "John 3:16-17")
  text: string;              // Highlighted verse text or snippet
  snippet?: string;          // Abbreviated text with ellipses for multi-verse matches
  matches: Match[];          // Match positions for highlighting
  score: number;             // Relevance score (higher = more relevant)
  type: MatchType;           // Type of match
  context?: string;          // Surrounding verses if includeContext was true
}

/**
 * FTS5 match information from SQLite
 */
export interface FTS5Match {
  verseId: VerseId;
  text: string;
  matchPositions: number[];  // Character positions of matches in text
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Parsed boolean expression for boolean searches
 */
export interface BooleanExpression {
  operator: 'AND' | 'OR' | 'NOT';
  left: BooleanExpression | string;
  right?: BooleanExpression | string;
}

/**
 * Parsed proximity query (word-based)
 */
export interface ProximityQuery {
  terms: string[];
  distance: number;          // Max word distance between terms
}

/**
 * Parsed verse proximity query
 */
export interface VerseProximityQuery {
  terms: string[];
  distance: number;          // Max verse distance between terms
}

/**
 * Parsed phrase query
 */
export interface PhraseQuery {
  phrase: string;
  caseSensitive?: boolean;
}

/**
 * Parsed query components
 */
export interface ParsedQuery {
  originalQuery: string;
  searchType: 'multi-word' | 'phrase' | 'proximity' | 'verse-proximity' | 'boolean' | 'fuzzy' | 'regex' | 'strongs';
  terms?: string[];          // For multi-word search
  phrase?: string;           // For phrase search
  proximity?: ProximityQuery; // For word proximity search
  verseProximity?: VerseProximityQuery; // For verse proximity search
  boolean?: BooleanExpression; // For boolean search
  fuzzy?: { term: string; distance: number }; // For fuzzy search
  regex?: string;            // For regex search
  strongs?: string;          // For Strong's number search (e.g., "G26")
}

// ============================================================================
// Search Query Builder Types
// ============================================================================

/**
 * Builder for constructing FTS5 queries
 */
export interface FTS5QueryBuilder {
  terms: string[];
  proximity?: number;
  phrase?: boolean;
  not?: string[];
  build(): string;
}

// ============================================================================
// Export Types from SavedSearch Model
// ============================================================================

export type {
  SearchType,
  SearchScope,
  SearchScopeData,
  BibleRange,
  SearchOptions,
} from '../Data/Models/Main/SavedSearch';

export { SavedSearch } from '../Data/Models/Main/SavedSearch';
