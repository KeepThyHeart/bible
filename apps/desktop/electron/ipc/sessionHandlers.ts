import { IpcMain } from 'electron';
import log from 'electron-log/main';
import { SessionRepository } from '@bible/core';
import { Session, SessionData } from '@bible/core';
import type { Metadata } from '@bible/core';
import { getSharedUserDb } from '../services/sharedUserDb';
import { initializeUserSchema } from '../schema/userSchema';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { validatePositiveInt, validateString } from '../utils/validation';

let sessionRepo: SessionRepository | null = null;

interface SessionDto {
  sessionId: number | undefined;
  name: string;
  description: string | undefined;
  createdDate: string | undefined;
  modifiedDate: string | undefined;
  lastOpened: string | undefined;
  isAutosave: boolean;
  isDefault: boolean;
  sessionData: SessionData;
  metadata: Metadata | undefined;
}

function toSessionDto(session: Session): SessionDto {
  return {
    sessionId: session.sessionId,
    name: session.name,
    description: session.description,
    createdDate: session.createdDate,
    modifiedDate: session.modifiedDate,
    lastOpened: session.lastOpened,
    isAutosave: session.isAutosave,
    isDefault: session.isDefault,
    sessionData: session.sessionData,
    metadata: session.metadata
  };
}

/**
 * Resolve the session repository or raise a classified `unavailable`
 * error so the renderer can branch cleanly.
 */
function requireSessionRepo(): SessionRepository {
  if (!sessionRepo) {
    throw new IpcKnownError('unavailable', 'Session repository not initialized');
  }
  return sessionRepo;
}

/**
 * Ensure session table exists in user database (delegates to centralized schema)
 */
function ensureSessionSchema(db: { execute: (sql: string) => void }): void {
  initializeUserSchema(db as any);
}

/**
 * Initialize session repository using shared user database
 */
async function initializeSessionRepo(): Promise<void> {
  if (!sessionRepo) {
    try {
      const userDb = await getSharedUserDb();
      ensureSessionSchema(userDb);
      sessionRepo = new SessionRepository(userDb);
      log.info('Session repository initialized successfully');
    } catch (error) {
      log.error('Failed to initialize session repository:', error);
    }
  }
}

export async function registerSessionHandlers(_ipcMain: IpcMain): Promise<void> {
  // Initialize session repository using shared user DB
  await initializeSessionRepo();

  // Handler: Get all sessions
  ipcHandler<[], SessionDto[]>('session:getAll', () => {
    const repo = requireSessionRepo();
    const sessions = repo.getAll({ orderBy: 'last_opened', orderDirection: 'DESC' });
    return sessions.map(toSessionDto);
  });

  // Handler: Get session by ID
  ipcHandler<[number], SessionDto | null>('session:load', (sessionId) => {
    validatePositiveInt(sessionId, 'sessionId');
    const repo = requireSessionRepo();

    const session = repo.getById(sessionId);
    if (!session) {
      return null;
    }

    // Mark as opened
    repo.markSessionOpened(sessionId);

    return toSessionDto(session);
  });

  // Handler: Get or create autosave session
  ipcHandler<[], SessionDto>('session:getOrCreateAutosave', () => {
    const repo = requireSessionRepo();

    // Try to get existing autosave session
    let session = repo.getAutosaveSession();

    // If not found, create one
    if (!session) {
      session = new Session({
        name: 'Auto-save Session',
        description: 'Automatically saved session',
        isAutosave: true,
        isDefault: false,
        sessionData: {}
      });
      session = repo.create(session);
      log.info('Created new autosave session');
    }

    // Mark as opened
    if (session.sessionId) {
      repo.markSessionOpened(session.sessionId);
    }

    return toSessionDto(session);
  });

  // Handler: Create new session
  ipcHandler<[
    {
      name: string;
      description?: string;
      sessionData: SessionData;
      isDefault?: boolean;
    }
  ], SessionDto>('session:create', (data) => {
    validateString(data.name, 'session name', 200);
    const repo = requireSessionRepo();

    const session = new Session({
      name: data.name,
      description: data.description,
      isAutosave: false,
      isDefault: data.isDefault ?? false,
      sessionData: data.sessionData
    });

    const created = repo.create(session);
    log.info(`Created new session: ${created.name} (ID: ${created.sessionId})`);

    return toSessionDto(created);
  });

  // Handler: Update session
  ipcHandler<[
    number,
    {
      name?: string;
      description?: string;
      sessionData?: SessionData;
      isDefault?: boolean;
    }
  ], SessionDto>('session:update', (sessionId, updates) => {
    validatePositiveInt(sessionId, 'sessionId');
    if (updates.name !== undefined) { validateString(updates.name, 'session name', 200); }
    const repo = requireSessionRepo();

    const session = repo.getById(sessionId);
    if (!session) {
      throw new IpcKnownError('not_found', `Session not found: ${sessionId}`);
    }

    // Update fields
    if (updates.name) session.name = updates.name;
    if (updates.description !== undefined) session.description = updates.description;
    if (updates.sessionData) session.updateSessionData(updates.sessionData);
    if (updates.isDefault !== undefined) session.isDefault = updates.isDefault;

    const updated = repo.update(session);
    log.info(`Updated session: ${updated.name} (ID: ${updated.sessionId})`);

    return toSessionDto(updated);
  });

  // Handler: Delete session
  ipcHandler<[number], boolean>('session:delete', (sessionId) => {
    validatePositiveInt(sessionId, 'sessionId');
    const repo = requireSessionRepo();

    // Don't allow deleting autosave session
    const session = repo.getById(sessionId);
    if (session?.isAutosave) {
      throw new IpcKnownError('invalid_input', 'Cannot delete autosave session');
    }

    const success = repo.delete(sessionId);
    log.info(`Deleted session ID ${sessionId}: ${success}`);

    return success;
  });

  // Handler: Set as default session
  ipcHandler<[number], boolean>('session:setAsDefault', (sessionId) => {
    validatePositiveInt(sessionId, 'sessionId');
    const repo = requireSessionRepo();

    const success = repo.setAsDefault(sessionId);
    log.info(`Set session ${sessionId} as default: ${success}`);

    return success;
  });

  // Handler: Get default session
  ipcHandler<[], SessionDto | null>('session:getDefault', () => {
    const repo = requireSessionRepo();

    const session = repo.getDefaultSession();
    if (!session) {
      return null;
    }

    return toSessionDto(session);
  });

  // Handler: Get recent sessions
  ipcHandler<[number | undefined], SessionDto[]>('session:getRecent', (limit) => {
    const repo = requireSessionRepo();
    const sessions = repo.getRecentSessions(limit ?? 10);
    return sessions.map(toSessionDto);
  });
}

/**
 * Clean up session repository (DB is closed by sharedUserDb)
 */
export function closeSessionDb(): void {
  sessionRepo = null;
}
