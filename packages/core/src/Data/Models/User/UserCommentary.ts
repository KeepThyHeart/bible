import { Metadata } from '../../Core/Types';

/**
 * User commentary collection entity from the user database.
 * Represents a prayer list or note collection container - groups related
 * UserNote entries together. This is distinct from UserNote, which holds
 * individual note content; UserCommentary is the organizational parent.
 */
export class UserCommentary {
  userCommentaryId?: number;
  name: string;
  description?: string;
  createdDate?: string;
  modifiedDate?: string;
  isDefault: boolean;
  color?: string;
  metadata?: Metadata;

  constructor(data: {
    userCommentaryId?: number;
    name: string;
    description?: string;
    createdDate?: string;
    modifiedDate?: string;
    isDefault?: boolean;
    color?: string;
    metadata?: Metadata;
  }) {
    this.userCommentaryId = data.userCommentaryId;
    this.name = data.name;
    this.description = data.description;
    this.createdDate = data.createdDate;
    this.modifiedDate = data.modifiedDate;
    this.isDefault = data.isDefault ?? false;
    this.color = data.color;
    this.metadata = data.metadata;
  }

  /**
   * Update the modified date to now
   */
  touch(): void {
    this.modifiedDate = new Date().toISOString();
  }

  /**
   * Check if this is the default commentary
   */
  isDefaultCommentary(): boolean {
    return this.isDefault;
  }
}
