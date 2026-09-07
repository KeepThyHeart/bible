/**
 * Study session management operations.
 *
 * Sessions capture the full UI state (open tabs, passages, layout)
 * so users can resume exactly where they left off.
 */

import type { SessionSummary, SessionDataResult } from './ApiTypes';

export interface ISessionApi {
  // --- CRUD -------------------------------------------------------
  getAllSessions(): Promise<SessionSummary[]>;
  getRecentSessions(limit?: number): Promise<SessionSummary[]>;
  loadSession(sessionId: number): Promise<SessionDataResult | null>;
  createSession(name: string, description?: string, sessionData?: Record<string, unknown>): Promise<SessionDataResult>;
  updateSession(sessionId: number, updates: {
    name?: string;
    description?: string;
    sessionData?: Record<string, unknown>;
  }): Promise<void>;
  deleteSession(sessionId: number): Promise<void>;

  // --- Defaults / Auto-save ---------------------------------------
  getDefaultSession(): Promise<SessionDataResult | null>;
  setAsDefault(sessionId: number): Promise<void>;
  getOrCreateAutosaveSession(): Promise<SessionDataResult>;
}
