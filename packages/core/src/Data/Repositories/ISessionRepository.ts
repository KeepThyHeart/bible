import { Session } from '../Models/User/Session';
import { RepositoryQueryOptions } from '../Core/IRepository';

/**
 * Interface for Session repository
 * Defines all operations for working with study sessions in the user database
 */
export interface ISessionRepository {
  getById(id: number): Session | undefined;
  getAll(options?: RepositoryQueryOptions): Session[];
  getByName(name: string): Session | undefined;
  getDefaultSession(): Session | undefined;
  getAutosaveSession(): Session | undefined;
  getRecentSessions(limit?: number): Session[];

  create(entity: Session): Session;
  update(entity: Session): Session;
  delete(id: number): boolean;

  // Mark a session as the default
  setAsDefault(id: number): boolean;

  // Update the last opened time
  markSessionOpened(id: number): void;
}
