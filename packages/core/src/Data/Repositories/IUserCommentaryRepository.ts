import { IRepository } from '../Core/IRepository';
import { UserCommentary } from '../Models/User/UserCommentary';

/**
 * Repository interface for user commentary collections
 */
export interface IUserCommentaryRepository extends IRepository<UserCommentary> {
  /**
   * Get the default commentary collection
   */
  getDefault(): UserCommentary | undefined;

  /**
   * Set a commentary as the default
   */
  setDefault(id: number): boolean;

  /**
   * Get all commentary collections by type (based on metadata or usage)
   * This can be used to filter prayer lists vs verse commentary collections
   */
  getByType(type: string): UserCommentary[];

  /**
   * Count notes in a commentary collection
   */
  countNotes(commentaryId: number): number;
}
