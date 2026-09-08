/** Topic result from browse/search */
export interface BrowseTopicResult {
  topic_id: number;
  parent_topic_id?: number;
  name: string;
  description?: string;
  source_abbreviation: string;
  source_name: string;
  verse_count: number;
  /**
   * Ancestry of a search hit, e.g. "Fine > (A penalty)". Only search results
   * carry it - the browse list is roots only, which have no ancestry.
   */
  parent_path?: string;
  /**
   * Direct sub-topics. The browse list shows the top level only, so this is
   * the reader's only signal that a row is worth drilling into.
   */
  child_count?: number;
}

/** Full topic detail result */
export interface TopicDetail {
  topic: {
    topic_id: number;
    parent_topic_id?: number;
    name: string;
    description?: string;
    sort_order?: number;
    metadata?: any;
  };
  children: Array<{ topic_id: number; name: string; description?: string; verse_count: number; child_count?: number }>;
  parent_chain: Array<{ topic_id: number; name: string }>;
  /** Verses, with ranges expanded - John 3:16-18 counts three. */
  verse_count: number;
  /**
   * Stored references, one per passage - John 3:16-18 counts one. This is the
   * number of rows `getVersesForTopic` can return, so it is the only count
   * that can answer "is there more to load?". Optional: a payload written by
   * an older main process does not carry it.
   */
  reference_count?: number;
  /**
   * Which index this topic came from. "Jericho" reads identically in Nave's
   * and in Torrey's, so the detail view has to name its source. Optional for
   * the same reason as `reference_count`.
   */
  source_abbreviation?: string;
  source_name?: string;
}

/** Also-in result */
export interface AlsoInResult {
  topic_id: number;
  name: string;
  source_abbreviation: string;
  source_name: string;
  verse_count: number;
}

/** Verse for topic */
export interface TopicVerseResult {
  topic_id: number;
  start_verse_id: number;
  end_verse_id: number;
  context?: string;
  sort_order?: number;
}

/** Tag graph association */
export interface TagGraphAssociation {
  id: string;
  entity1Id: string;
  entity1Category: string;
  entity2Id: string;
  entity2Category: string;
  entity2Name?: string;
  relationshipName: string;
  strength: number;
  confidence?: string;
  notes?: string;
}

/** Tag graph entity detail */
export interface TagGraphEntityDetail {
  id: string;
  name: string;
  category: string;
  notes?: string;
  tribe?: string;
  nation?: string;
  roles?: string[];
  modernName?: string;
  significance?: string;
  traditions?: string[];
  attributes?: string[];
  parentId?: string;
}

/** People relationship */
export interface PeopleRelationshipResult {
  id: string;
  person1Id: string;
  person2Id: string;
  person1Name?: string;
  person2Name?: string;
  relationshipType: string;
  confidence?: string;
}

/** Entity topic link (bridge to Nave's/Torrey's) */
export interface EntityTopicLinkResult {
  entityId: string;
  entityCategory: string;
  sourceModule: string;
  topicId: number;
  matchType: string;
}

/** Entity facet (structural subtopic group) */
export interface EntityFacetResult {
  facetId: number;
  parentEntityId: string;
  parentEntityCategory: string;
  facetLabel: string;
  facetDisplayLabel: string;
  sourceModule: string;
  sourceTopicId: number;
  members?: EntityFacetMemberResult[];
}

export interface EntityFacetMemberResult {
  facetId: number;
  memberEntityId: string;
  memberEntityCategory: string;
  sourceTopicId?: number;
  sortOrder: number;
  memberName?: string;
}

export const PAGE_SIZE = 50;

/**
 * How many of a topic's passages load at a time.
 *
 * A page, not a ceiling - matching the web app, which pages this list. A
 * bare `100` at the one call site with no offset and no way to ask for more
 * would mean a topic with 400 passages silently shows 100, with the reader
 * having no way of knowing the rest exists.
 */
export const VERSE_PAGE_SIZE = 100;

/** Category display labels and colors */
export const CATEGORY_LABELS: Record<string, string> = {
  people: 'People',
  places: 'Places',
  objects: 'Objects',
  themes: 'Themes',
};

export const CATEGORY_COLORS: Record<string, string> = {
  people: '#4a90d9',
  places: '#56a764',
  objects: '#d4a843',
  themes: '#9b59b6',
};

export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  topical_nave: "Nave's Topical Bible",
  topical_torrey: "Torrey's New Topical Textbook",
};
