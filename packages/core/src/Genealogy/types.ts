/**
 * Genealogy DTOs and layout types. Pure TypeScript: this file (and everything
 * under `Genealogy/` except the repository mapping) must import nothing
 * platform-specific, because it is re-exported from `@bible/core/browser`.
 *
 * Verse ids are the numeric ids of `VerseIdHelper` (book*1_000_000 + chapter*1_000 + verse).
 */

export type Sex = 'male' | 'female';
export type PersonKind = 'individual' | 'group';
export type EdgeQualifier = 'legal' | 'levirate' | 'adoptive' | 'ancestor';

/** Confidence vocabulary shared with the tag graph and the timeline module. */
export type GenealogyConfidence = 'certain' | 'probable' | 'possible' | 'disputed' | 'derived';

export interface VerseRangeDto {
  start: number;
  end: number;
}

export interface GenealogyPersonDto {
  id: string;
  name: string;
  sex?: Sex;
  kind: PersonKind;
  tribe?: string;
  nation?: string;
  roles?: string[];
  aliases?: string[];
  /** First verse in which the person appears (for ordering and namesake labels). */
  firstRef?: number;
  notes?: string;
}

export interface GenealogyEdgeDto {
  id: string;
  /** Subject: read as "from is <type> to". */
  from: string;
  to: string;
  /** 'father_of' | 'mother_of' | 'husband_of' | 'wife_of' | 'possibly_same_as' | 'founded_by' | other open tokens. */
  type: string;
  qualifier?: EdgeQualifier;
  confidence?: GenealogyConfidence | string;
  /** Rows sharing a value are ALTERNATIVE readings of the same link. */
  readingGroup?: string;
  /** 'default' or a short label naming this alternative. */
  reading?: string;
  /** Birth order among a parent's children. */
  sortOrder?: number;
  source?: string;
  notes?: string;
  verses: VerseRangeDto[];
}

export interface LineageStepDto {
  personId: string;
  verseId: number;
  /** Person ids the text skips at this step (Mt 1:8, 1:11). */
  gapBefore?: string[];
  note?: string;
}

export interface LineageDto {
  id: string;
  name: string;
  kind: 'genealogy' | 'tribe_list' | 'succession' | string;
  /** 'descending' (Mt 1: Abraham begat Isaac) or 'ascending' (Lk 3: ...the son of Heli). */
  direction: 'descending' | 'ascending';
  range: VerseRangeDto;
  notes?: string;
  /** Steps in the order the TEXT gives them. */
  steps: LineageStepDto[];
}

export interface DataSourceDto {
  id: string;
  name: string;
  licence: string;
  url?: string;
  attribution?: string;
  notes?: string;
}

/** A hand-written note on an interpretive case (Heli, Cainan, ...). */
export interface InterpretiveCaseDto {
  id: string;
  title: string;
  verses: VerseRangeDto[];
  personIds: string[];
  /** What the KJV text says, literally. */
  text: string;
  readings: { label: string; summary: string; heldBy?: string }[];
}

export interface GenealogyDatasetDto {
  module: string;
  persons: GenealogyPersonDto[];
  edges: GenealogyEdgeDto[];
  lineages: LineageDto[];
  sources: DataSourceDto[];
  cases?: InterpretiveCaseDto[];
  /** person id -> external ids by scheme (tipnr, bibledata, ...). */
  externalIds?: Record<string, Record<string, string>>;
}

export interface IGenealogyDataProvider {
  getDataset(module?: string): Promise<GenealogyDatasetDto | null>;
}

// ---------------------------------------------------------------------------
// Layout output (shared by layoutLineage / layoutFamily / layoutTribes and the SVG view)
// ---------------------------------------------------------------------------

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutNodeFlags {
  /** On the line from Adam to Christ. */
  onLineToChrist?: boolean;
  /** The node the view is centred on. */
  focus?: boolean;
  /** Present in one text only ("Luke only" Cainan). */
  oneTextOnly?: boolean;
  /** Identity or link is disputed. */
  disputed?: boolean;
  group?: boolean;
  /** Number of hidden descendants/ancestors behind a collapse badge. */
  collapsed?: number;
  /** Lineage ids this node belongs to. */
  lineages?: string[];
  /** Text of a gap marker attached before this node ("3 kings not named"). */
  gapNote?: string;
}

/** A positioned node. (x, y) is the node CENTRE; (w, h) is its size. */
export interface LayoutNode {
  id: string;
  personId: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 = always labelled (key figures), 1 = lineage members, 2 = others. */
  importance: 0 | 1 | 2;
  sex?: Sex;
  /** Colour key: tribe id, or the mother id in the Tribes view ('leah', 'rachel', 'bilhah', 'zilpah'). */
  colorKey?: string;
  flags: LayoutNodeFlags;
}

export type LayoutEdgeStyle = 'solid' | 'dashed' | 'dotted' | 'double';
export type LayoutEdgeKind = 'parent' | 'spouse' | 'cross' | 'gap' | 'same_as';

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  points: LayoutPoint[];
  style: LayoutEdgeStyle;
  kind: LayoutEdgeKind;
  onLineToChrist?: boolean;
  /** Verse where the link is stated, for click-through. */
  verseId?: number;
}

export interface LayoutBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: LayoutBounds;
}

export type GenealogyViewKind = 'line' | 'family' | 'tribes';
