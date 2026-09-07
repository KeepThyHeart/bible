import { EntityCategory } from './TagGraphEntity';

/**
 * Structural subtopic group on an entity.
 * Represents Nave's structural headers like "INSTANCES OF", "OBJECTS OF"
 * as labeled groupings connecting a parent entity to child entities.
 */
export interface EntityFacet {
  facetId: number;
  parentEntityId: string;
  parentEntityCategory: EntityCategory;
  facetLabel: string;
  facetDisplayLabel: string;
  sourceModule: string;
  sourceTopicId: number;
  members?: EntityFacetMember[];
}

/**
 * An entity that belongs to a facet group.
 */
export interface EntityFacetMember {
  facetId: number;
  memberEntityId: string;
  memberEntityCategory: EntityCategory;
  sourceTopicId?: number;
  sortOrder: number;
  memberName?: string;
}
