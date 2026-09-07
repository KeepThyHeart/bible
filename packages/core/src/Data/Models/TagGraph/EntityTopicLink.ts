import { EntityCategory } from './TagGraphEntity';

/**
 * Direct bridge from a tag graph entity to a topic_id in Nave's/Torrey's.
 * Enables the UI to navigate directly to the topical index tree from an entity.
 */
export interface EntityTopicLink {
  entityId: string;
  entityCategory: EntityCategory;
  sourceModule: string;
  topicId: number;
  matchType: 'exact' | 'alias' | 'stem';
}
