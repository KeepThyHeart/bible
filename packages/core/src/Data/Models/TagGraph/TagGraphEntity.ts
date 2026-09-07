/**
 * Entity category in the tag graph
 */
export type EntityCategory = 'people' | 'places' | 'objects' | 'themes';

/**
 * Generic entity result from the tag graph database.
 * Used for search results and association targets.
 */
export interface TagGraphEntity {
  id: string;
  name: string;
  category: EntityCategory;
  notes?: string;
}

/**
 * Person entity with additional fields
 */
export interface PersonEntity extends TagGraphEntity {
  category: 'people';
  tribe?: string;
  nation?: string;
  roles?: string[];
}

/**
 * Place entity with additional fields
 */
export interface PlaceEntity extends TagGraphEntity {
  category: 'places';
  parentId?: string;
  modernName?: string;
  attributes?: string[];
}

/**
 * Object entity with additional fields
 */
export interface ObjectEntity extends TagGraphEntity {
  category: 'objects';
  parentId?: string;
  significance?: 'mundane' | 'symbolic' | 'sacred' | 'miraculous';
  attributes?: string[];
}

/**
 * Theme entity with additional fields
 */
export interface ThemeEntity extends TagGraphEntity {
  category: 'themes';
  parentId?: string;
  traditions?: string[];
  attributes?: string[];
}

/**
 * People relationship (family tree, etc.)
 */
export interface PeopleRelationship {
  id: string;
  person1Id: string;
  person2Id: string;
  person1Name?: string;
  person2Name?: string;
  relationshipType: string;
  relationshipTypeReciprocal?: string;
  confidence?: string;
  notes?: string;
}
