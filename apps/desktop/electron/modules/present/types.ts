/**
 * The Presenter module's main-process API, shared by `./index.ts` (implements it through
 * `ipc.handle`) and the renderer's `createModuleClient<PresentApi, PresentEvents>('present')`.
 *
 * The desktop pane is the controller; a page served from a small localhost HTTP server (see
 * `server.ts`) is the screen. State only ever flows controller -> screen, as whole snapshots.
 */

/** What the controller asks to put on the wall. */
export interface PresentPassageRequest {
  /** Bible module abbreviation. */
  module: string;
  book: number;
  chapter: number;
  /** Narrow the chapter to a range; omit both for the whole chapter. */
  verseStart?: number;
  verseEnd?: number;
}

export interface PresentVerse {
  verse: number;
  text: string;
}

export interface PresentDisplay {
  /** Text size step, `MIN_FONT_STEP`..`MAX_FONT_STEP`. */
  fontStep: number;
  /** Screen shows nothing (a "black screen"). */
  blanked: boolean;
  theme: 'dark' | 'light';
}

/** The whole snapshot the screen renders (never deltas: a reconnecting page just gets the latest). */
export interface PresentSnapshot {
  /** Increases on every change; a page ignores anything older than what it shows. */
  version: number;
  /** Null until the controller picks a passage (the screen shows a waiting message). */
  live: {
    reference: string;
    module: string;
    bookName: string;
    chapter: number;
    verses: PresentVerse[];
    /** The verse the presenter is on (highlighted, scrolled into view). */
    focus: number;
  } | null;
  display: PresentDisplay;
  /** Screens connected right now. */
  viewerCount: number;
}

export interface PresentServerInfo {
  /** The address to open on this machine. */
  url: string;
  /** Addresses for other devices (LAN mode only; empty otherwise). */
  lanUrls: string[];
  port: number;
  lan: boolean;
  /** SVG of a QR code for the first LAN url (LAN mode) or the local url. */
  qrSvg: string;
}

export interface PresentStatus {
  running: boolean;
  server: PresentServerInfo | null;
  snapshot: PresentSnapshot;
  /** The request behind `snapshot.live`, so the controller can show its pickers. */
  request: PresentPassageRequest | null;
}

export interface PresentApi {
  status(): PresentStatus;
  /** Start the server (restarts it with a new address when `lan` changed). */
  start(options?: { lan?: boolean }): PresentStatus;
  /** Stop the server; the screens show that the presentation ended. */
  stop(): PresentStatus;
  setPassage(request: PresentPassageRequest): Promise<PresentStatus>;
  /** Move the focus by `delta` verses; spills over into the next/previous chapter. */
  step(delta: number): Promise<PresentStatus>;
  /** Jump the focus to a verse of the current passage. */
  focusVerse(verse: number): PresentStatus;
  setDisplay(patch: Partial<PresentDisplay>): PresentStatus;
  /** Open the screen page in the default browser. */
  openInBrowser(): void;
  /** Open the screen page in a new app window (on another display when there is one). */
  openInWindow(): void;
}

export interface PresentEvents {
  changed: [status: PresentStatus];
}

export const MIN_FONT_STEP = -3;
export const MAX_FONT_STEP = 6;
export const DEFAULT_FONT_STEP = 0;
