/**
 * The Presenter's controller state: what is on the wall, which verse is focused, the display
 * settings, and the screen server's lifecycle. Scripture and the server are injected, so this
 * runs under test without Electron, a database or a real socket.
 */
import { IpcKnownError } from '../../ipc/result';
import { PresenterServer, type PresenterServerOptions } from './server';
import {
  DEFAULT_FONT_STEP,
  MAX_FONT_STEP,
  MIN_FONT_STEP,
  type PresentDisplay,
  type PresentPassageRequest,
  type PresentServerInfo,
  type PresentSnapshot,
  type PresentStatus,
  type PresentVerse,
} from './types';

export interface PresentScripture {
  /** Verses of a chapter; empty when the chapter does not exist. */
  getChapter(module: string, book: number, chapter: number): Promise<PresentVerse[]>;
  /** Null for an unknown book. */
  getBook(book: number): { name: string; chapterCount: number } | null;
}

export interface PresentControllerDeps {
  scripture: PresentScripture;
  /** Addresses of this machine on the local network (used in LAN mode only). */
  lanAddresses(): string[];
  /** Render a QR code (SVG text) for a URL. */
  qr(url: string): string;
  createServer?(options: PresenterServerOptions): PresenterServer;
}

export interface PresentControllerEvents {
  changed(status: PresentStatus): void;
}

const MAX_CHAPTER = 200;

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export class PresentController {
  private server: PresenterServer | null = null;
  private info: PresentServerInfo | null = null;
  private request: PresentPassageRequest | null = null;
  private chapterVerses: PresentVerse[] = [];
  private bookName = '';
  private focus = 0;
  /** Monotonic across server restarts, so a screen never sees time go backwards. */
  private version = 0;
  private display: PresentDisplay = { fontStep: DEFAULT_FONT_STEP, blanked: false, theme: 'dark' };

  constructor(
    private readonly deps: PresentControllerDeps,
    private readonly onChanged: (status: PresentStatus) => void = () => {},
  ) {}

  // -- queries --------------------------------------------------------------

  /** The path (with token) of the screen page, or null when not running. */
  pagePath(): string | null {
    return this.server?.running ? this.server.pagePath : null;
  }

  /** The URL to open on this machine. */
  localUrl(): string | null {
    return this.info?.url ?? null;
  }

  status(): PresentStatus {
    return { running: this.server?.running === true, server: this.info, snapshot: this.snapshot(), request: this.request };
  }

  // -- lifecycle ------------------------------------------------------------

  async start(options: { lan?: boolean } = {}): Promise<PresentStatus> {
    const lan = options.lan === true;
    if (this.server?.running) {
      if (this.info?.lan === lan) return this.status();
      await this.stop(); // switching local <-> LAN: new socket, new token
    }
    const server = (this.deps.createServer ?? ((o) => new PresenterServer(o)))({
      lan,
      onViewers: () => this.publish(),
    });
    const started = await server.start(this.snapshot());
    this.server = server;
    const path = `/p/${started.token}/`;
    const url = `http://127.0.0.1:${started.port}${path}`;
    const lanUrls = lan ? this.deps.lanAddresses().map((ip) => `http://${ip}:${started.port}${path}`) : [];
    this.info = { url, lanUrls, port: started.port, lan, qrSvg: this.deps.qr(lanUrls[0] ?? url) };
    this.changed();
    return this.status();
  }

  async stop(): Promise<PresentStatus> {
    const server = this.server;
    this.server = null;
    this.info = null;
    if (server) await server.stop();
    this.changed();
    return this.status();
  }

  // -- commands -------------------------------------------------------------

  async setPassage(request: PresentPassageRequest): Promise<PresentStatus> {
    const { module, book, chapter, verseStart, verseEnd } = request ?? ({} as PresentPassageRequest);
    if (typeof module !== 'string' || !/^[\w.-]{1,64}$/.test(module)) throw new IpcKnownError('invalid_input', 'Bad Bible module');
    if (!isInt(book, 1, 66) || !isInt(chapter, 1, MAX_CHAPTER)) throw new IpcKnownError('invalid_input', 'Bad book or chapter');
    if (verseStart !== undefined && !isInt(verseStart, 1, 500)) throw new IpcKnownError('invalid_input', 'Bad verse');
    if (verseEnd !== undefined && !isInt(verseEnd, 1, 500)) throw new IpcKnownError('invalid_input', 'Bad verse');
    const info = this.deps.scripture.getBook(book);
    if (!info) throw new IpcKnownError('not_found', `Unknown book ${book}`);
    const verses = await this.deps.scripture.getChapter(module, book, chapter);
    if (verses.length === 0) throw new IpcKnownError('not_found', `${info.name} ${chapter} is not in ${module}`);
    this.request = { module, book, chapter, ...(verseStart ? { verseStart } : {}), ...(verseEnd ? { verseEnd } : {}) };
    this.chapterVerses = verses;
    this.bookName = info.name;
    this.focus = this.visible()[0]?.verse ?? verses[0].verse;
    this.changed();
    return this.status();
  }

  async step(delta: number): Promise<PresentStatus> {
    if (!this.request || !Number.isFinite(delta)) return this.status();
    const steps = Math.trunc(delta);
    for (let i = 0; i < Math.abs(steps); i++) {
      const range = this.visible();
      const at = range.findIndex((v) => v.verse === this.focus);
      const next = at + Math.sign(steps);
      if (next >= 0 && next < range.length) {
        this.focus = range[next].verse;
        continue;
      }
      // Off the end of the chapter: continue into the neighbour, unless a range pinned the passage.
      if (this.request.verseStart || this.request.verseEnd) break;
      if (!(await this.moveChapter(steps > 0 ? 1 : -1))) break;
    }
    this.changed();
    return this.status();
  }

  focusVerse(verse: number): PresentStatus {
    if (this.request && this.visible().some((v) => v.verse === verse)) {
      this.focus = verse;
      this.changed();
    }
    return this.status();
  }

  setDisplay(patch: Partial<PresentDisplay>): PresentStatus {
    const next = { ...this.display };
    if (isInt(patch.fontStep, MIN_FONT_STEP, MAX_FONT_STEP)) next.fontStep = patch.fontStep;
    if (typeof patch.blanked === 'boolean') next.blanked = patch.blanked;
    if (patch.theme === 'dark' || patch.theme === 'light') next.theme = patch.theme;
    this.display = next;
    this.changed();
    return this.status();
  }

  // -- internals ------------------------------------------------------------

  private async moveChapter(dir: 1 | -1): Promise<boolean> {
    const req = this.request!;
    let book = req.book;
    let chapter = req.chapter + dir;
    let info = this.deps.scripture.getBook(book);
    if (chapter < 1 || (info && chapter > info.chapterCount)) {
      book += dir;
      info = this.deps.scripture.getBook(book);
      if (!info) return false;
      chapter = dir === 1 ? 1 : info.chapterCount;
    }
    const verses = await this.deps.scripture.getChapter(req.module, book, chapter);
    if (verses.length === 0 || !info) return false;
    this.request = { module: req.module, book, chapter };
    this.chapterVerses = verses;
    this.bookName = info.name;
    this.focus = dir === 1 ? verses[0].verse : verses[verses.length - 1].verse;
    return true;
  }

  private visible(): PresentVerse[] {
    const r = this.request;
    if (!r) return [];
    const from = r.verseStart ?? 1;
    const to = r.verseEnd ?? Number.MAX_SAFE_INTEGER;
    return this.chapterVerses.filter((v) => v.verse >= from && v.verse <= to);
  }

  private reference(): string {
    const r = this.request!;
    const shown = this.visible();
    const head = `${this.bookName} ${r.chapter}`;
    if (!r.verseStart && !r.verseEnd) return head;
    const a = shown[0]?.verse ?? r.verseStart;
    const b = shown[shown.length - 1]?.verse ?? r.verseEnd;
    return a === b ? `${head}:${a}` : `${head}:${a}–${b}`;
  }

  private snapshot(): PresentSnapshot {
    const r = this.request;
    return {
      version: this.version,
      live: r
        ? { reference: this.reference(), module: r.module, bookName: this.bookName, chapter: r.chapter, verses: this.visible(), focus: this.focus }
        : null,
      display: this.display,
      viewerCount: this.server?.viewerCount ?? 0,
    };
  }

  /** Push the current snapshot to the screens (e.g. the viewer count moved) without a version bump. */
  private publish(): void {
    this.server?.publish(this.snapshot());
    this.onChanged(this.status());
  }

  private changed(): void {
    this.version++;
    this.publish();
  }
}
