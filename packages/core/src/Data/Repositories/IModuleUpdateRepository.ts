import { IRepository } from '../Core/IRepository';
import { ModuleUpdate } from '../Models/Main/ModuleUpdate';

/**
 * Repository interface for module update entities
 */
export interface IModuleUpdateRepository extends IRepository<ModuleUpdate> {
  /**
   * Get updates for a specific module
   */
  getByModule(moduleId: number): ModuleUpdate[];

  /**
   * Get unignored updates
   */
  getUnignored(): ModuleUpdate[];

  /**
   * Get critical updates
   */
  getCritical(): ModuleUpdate[];

  /**
   * Ignore an update
   */
  ignoreUpdate(updateId: number): void;

  /**
   * Mark update as notified
   */
  markNotified(updateId: number): void;

  /**
   * Check if update exists for module
   */
  hasUpdate(moduleId: number): boolean;

  /**
   * Delete updates for a specific module
   */
  deleteByModule(moduleId: number): number;
}
