import { EntityCategory } from './TagGraphEntity';

/**
 * Cross-entity association from the tag graph
 */
export interface TagAssociation {
  id: string;
  entity1Id: string;
  entity1Category: EntityCategory;
  entity1Name?: string;
  entity2Id: string;
  entity2Category: EntityCategory;
  entity2Name?: string;
  associationTypeId: string;
  relationshipName: string;
  reciprocalName?: string;
  strength: number;
  confidence?: string;
  notes?: string;
}

/**
 * Supporting verse reference for an association.
 * Links a tag_association to the Bible verses that evidence it.
 */
export interface AssociationPassage {
  associationId: string;
  startVerseId: number;
  endVerseId: number;
  sourceModule?: string;
  sortOrder: number;
}
