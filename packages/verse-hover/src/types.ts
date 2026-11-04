/** Shared types for the verse-hover drop-in. */

export interface LocalePack {
  id: string;
  /** 66 display names, index 0 = Genesis. */
  books: string[];
  /** One line per book ("full,full|abbr,abbr"), normalised keys (see norm()). */
  names: string;
  /** Normalised keys that are also ordinary words ("is", "job", "mark"). */
  ambiguous: string[];
  /** Normalised ordinal words -> 1|2|3 ("i", "ii", "first", "1st"). */
  ord: Record<string, number>;
  /** Regex source: text right after a number that means it is not a reference ("km", "times"). */
  units: string;
  /** Regex source: words before a reference that make it more likely ("see", "cf"). */
  cues: string;
  /** Regex source: connector words after a list separator ("and"); optional. */
  ui: Record<string, string>;
}

export interface Ref {
  book: number;
  chapter: number;
  verse?: number;
  endChapter?: number;
  endVerse?: number;
  /** Translation override from a version suffix such as "(ASV)". */
  tr?: string;
  /** Offsets into the scanned string. */
  start: number;
  end: number;
  score: number;
}

export type Seg = string | [cls: string, text: string];
export type Verse = string | Seg[];

export interface ChapterSlice {
  k: number;
  f: number;
  v: Verse[];
  n?: number;
  h?: Record<string, string>;
  p?: number[];
}

export interface Manifest {
  abbr: string;
  name: string;
  lang: string;
  dir: string;
  copyright?: string;
  license?: string;
  versification?: string;
  sha?: string;
  counts: number[][];
}

export interface SliceRequest {
  tr: string;
  book: number;
  chapter: number;
  from: number;
  to: number;
}

export type ThresholdName = 'strict' | 'normal' | 'loose';

export type SourceConfig =
  | { type: 'php'; url: string }
  | { type: 'static'; base: string; compressed?: 'none' | 'gzip' }
  | { type: 'custom'; load(req: SliceRequest): Promise<ChapterSlice> };

export interface Config {
  source: SourceConfig;
  translation: string;
  translations?: string[];
  locale?: string | string[];
  load: 'lazy' | 'eager';
  context: number | { before: number; after: number };
  chapterPreview: number;
  click: 'link' | 'popup' | 'reader' | 'none';
  linkUrl?: string;
  linkTarget?: string;
  threshold: ThresholdName | number;
  requireVerse: boolean;
  ignore: string[];
  /** CSS selectors: when set, only text inside matching elements is scanned. */
  scope?: string[] | string;
  skip?: string;
  observe: boolean;
  theme: 'auto' | 'light' | 'dark' | 'none';
  style: Record<string, string>;
  template?: string;
  verseLayout: 'inline' | 'block';
  showVerseNumbers: boolean;
  showVersion: boolean;
  showHeadings: boolean;
  formatting: boolean;
  /** Words of Christ in red (default true). */
  wordsOfChrist: boolean;
  hoverDelay: number;
  hideDelay: number;
  classPrefix: string;
  /** Where the interactive half (popup) lives; default: verse-hover-ui.min.js next to the core. */
  uiUrl?: string;
  plusUrl?: string;
  nonce?: string;
  autoInit: boolean;
  on?: Partial<Record<'ready' | 'open' | 'close' | 'error', (detail: unknown) => void>>;
  render?: (ctx: RenderContext) => Node;
}

export interface RenderContext {
  ref: Ref;
  refText: string;
  version: string;
  versionName: string;
  verses: { n: number; text: Verse; target: boolean; heading?: string }[];
  link?: string;
  copyright?: string;
  dir: string;
  lang: string;
}
