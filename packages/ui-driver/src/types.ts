/**
 * Shared contracts of the UI driver. Every module imports its types from here,
 * so the pieces can be written and tested apart.
 *
 * Erasable TypeScript only (no enums, no parameter properties): the package runs
 * on Node's built-in type stripping, with no build step.
 */

import type { BrowserContext, ElectronApplication, Page } from 'playwright-core';

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

/** One request on the socket or stdio: the command as argv (what the shell gave the CLI). */
export interface Request {
  argv: string[];
}

/** One reply. `text` is what the CLI prints; `ok: false` makes the CLI exit 1. */
export interface Reply {
  ok: boolean;
  text: string;
}

/** Runs parsed commands. The daemon owns one; the Session implements it. */
export interface Executor {
  exec(cmd: Command): Promise<Reply>;
  /** Close the app and release everything. Idempotent. */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface Size {
  width: number;
  height: number;
}

/** Options every action command accepts. */
export interface ActionOpts {
  /** Do not append the auto diff to the reply. */
  quiet?: boolean;
  /** Action timeout in ms (default 5000). */
  timeout?: number;
}

export type AuditKind = 'names' | 'overflow' | 'overlap' | 'focus' | 'i18n' | 'narrow' | 'tab';
/** What `check` with no ref runs: the cheap ones. `narrow` and `tab` change state and are opt-in. */
export const DEFAULT_AUDIT_KINDS: AuditKind[] = ['names', 'overflow', 'overlap', 'focus', 'i18n'];

export type WaitKind = 'text' | 'gone' | 'ref' | 'idle' | 'ms' | 'url';

export type Command =
  | { name: 'start'; app?: string; url?: string; viewport?: Size; headed?: boolean; keepProfile?: boolean }
  | { name: 'stop' }
  | { name: 'status' }
  | { name: 'help'; topic?: string }
  | { name: 'snapshot'; scope?: string; depth?: number; max?: number; visible?: boolean; all?: boolean }
  | { name: 'diff' }
  | { name: 'find'; text: string; role?: string }
  | ({ name: 'click'; ref: string; right?: boolean } & ActionOpts)
  | ({ name: 'dblclick'; ref: string } & ActionOpts)
  | ({ name: 'hover'; ref: string } & ActionOpts)
  | ({ name: 'type'; ref: string; text: string; enter?: boolean } & ActionOpts)
  | ({ name: 'fill'; ref: string; text: string; enter?: boolean } & ActionOpts)
  | ({ name: 'press'; ref?: string; key: string } & ActionOpts)
  | ({ name: 'select'; ref: string; option: string } & ActionOpts)
  /** `check rN` / `uncheck rN`: tick or untick a checkbox, radio or switch. */
  | ({ name: 'tick'; ref: string; on: boolean } & ActionOpts)
  | ({ name: 'scroll'; ref?: string; dir?: 'up' | 'down' | 'left' | 'right'; amount?: number } & ActionOpts)
  | ({ name: 'goto'; url: string } & ActionOpts)
  | ({ name: 'back' } & ActionOpts)
  | ({ name: 'forward' } & ActionOpts)
  | ({ name: 'reload' } & ActionOpts)
  | { name: 'resize'; width: number; height: number; quiet?: boolean }
  | { name: 'wait'; kind: WaitKind; text?: string; ref?: string; ms?: number; timeout?: number; quiet?: boolean }
  | { name: 'errors'; all?: boolean; warnings?: boolean; clear?: boolean }
  /** `check` with no ref (or with audit kinds): the heuristics. */
  | { name: 'audit'; kinds: AuditKind[] }
  | { name: 'screenshot'; ref?: string; full?: boolean; path?: string }
  | { name: 'log'; playwright?: boolean; path?: string; tail?: number }
  | { name: 'pages' }
  | { name: 'page'; index: number };

export type CommandName = Command['name'];

/** Parser result: a command, or a one-line usage error. */
export type ParseResult = { ok: true; cmd: Command } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Snapshot tree (produced in the page by src/page/runtime.js)
// ---------------------------------------------------------------------------

/**
 * One node of the compact accessibility tree. Element nodes carry a ref;
 * text nodes (`role: 'text'`) carry only `name` (the text).
 */
export interface RawNode {
  ref?: string;
  role: string;
  name?: string;
  value?: string;
  /** Heading level. */
  level?: number;
  /** checked, unchecked, mixed, expanded, collapsed, selected, pressed, disabled, focused, required, invalid, current, readonly */
  states?: string[];
  /** Number of descendants the page left out (hidden list rows etc.); rarely set. */
  omitted?: number;
  children?: RawNode[];
}

export interface PageSnapshot {
  url: string;
  title: string;
  vw: number;
  vh: number;
  /** Ref of the focused element, 'body' when nothing is focused. */
  focus: string;
  root: RawNode;
  /** Next free ref number after this walk. */
  nextRef: number;
  /** ref -> signature for every ref in this walk; seeds re-adoption after a reload. */
  sigs: Record<string, string>;
  /** `--visible` with a modal open: only the modal was walked. */
  modalOnly?: boolean;
}

/** How a ref'd element can be found again by a Playwright script. */
export interface LocatorHint {
  testId?: string;
  role?: string;
  name?: string;
  /** Index among elements with the same role+name, when not unique. */
  nth?: number;
  /** Text to match with getByText when there is no usable role. */
  text?: string;
  /** Last-resort CSS path. */
  css?: string;
}

/** One finding of an audit (`check`). */
export interface AuditItem {
  kind: string;
  ref?: string;
  /** Short description of the element when it has no ref, e.g. `div.toolbar`. */
  el?: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Manifest and launch
// ---------------------------------------------------------------------------

export interface ManifestCommand {
  command: string;
  args?: string[];
  /** Relative to the manifest's directory. */
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

/**
 * `driver.manifest.json` beside each app. Strings may use ${port}, ${profile},
 * ${manifestDir}, ${repoRoot}, ${tmp}, ${url} and ${prepare.KEY} (from the JSON the
 * prepare command prints on its last stdout line).
 */
export interface Manifest {
  app: string;
  kind: 'web' | 'electron';
  description?: string;
  /** Files (relative to the manifest dir) that must exist, with the command that builds them. */
  build?: { requires: string[]; hint: string };
  /** Runs before start; its last stdout line, if JSON, becomes ${prepare.*}. Fixture/seed data. */
  prepare?: ManifestCommand;
  /** Web: the server to run. `port: "auto"` picks a free port. */
  server?: ManifestCommand & { port?: number | 'auto'; url: string; ready: { url: string; timeout?: number } };
  /** Web: external base URLs allowed with `start web --url`, always read-only. */
  external?: { allow: string[] };
  /** Electron: what to launch. `main` is relative to the manifest dir. */
  electron?: {
    main: string;
    args?: string[];
    env?: Record<string, string>;
    /** CSS selector that means the first window is ready. */
    readySelector?: string;
    timeout?: number;
  };
  viewport?: Size;
  /** Where the app is told to keep its state: a throwaway dir unless --keep. Always on. */
  profile?: { keep?: boolean };
}

/** What codegen needs to open the same app again in a Playwright script. */
export type ReproTarget =
  | { kind: 'web'; baseUrl: string; viewport?: Size }
  | { kind: 'electron'; main: string; args: string[]; env: Record<string, string>; cwd: string };

export interface LaunchOptions {
  /** App name (`web`, `desktop`: apps/<name>/driver.manifest.json) or a path to a manifest. */
  app?: string;
  /** External base URL (web only, read-only). */
  url?: string;
  viewport?: Size;
  headed?: boolean;
  keepProfile?: boolean;
  repoRoot: string;
  /** Session dir: profiles and server logs go under it. */
  sessionDir: string;
  /** Progress lines for the daemon log (not the reply). */
  log: (line: string) => void;
  /** Called for every request the read-only guard blocks. */
  onBlocked?: (method: string, url: string) => void;
}

export interface LaunchedApp {
  kind: 'web' | 'electron';
  /** Web: the origin pages are opened on. */
  baseUrl?: string;
  readOnly: boolean;
  context: BrowserContext;
  electron?: ElectronApplication;
  /** The page to start on (web: already navigated to baseUrl; electron: first window, ready). */
  page: Page;
  profileDir: string;
  /** One line for the `start` reply, e.g. `web http://127.0.0.1:41234 (local server)`. */
  info: string;
  repro: ReproTarget;
  /** Close the browser/app, stop the server (SIGTERM, SIGKILL after 10 s), remove the profile unless kept. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors and transcript
// ---------------------------------------------------------------------------

export type ErrorKind = 'console' | 'warning' | 'pageerror' | 'react' | 'http' | 'netfail' | 'blocked';

export interface ErrorEntry {
  /** Increases with every distinct entry and every repeat (the last occurrence's number). */
  seq: number;
  kind: ErrorKind;
  /** One line, already trimmed to ~200 chars. */
  text: string;
  count: number;
}

export interface TranscriptEntry {
  seq: number;
  /** ms since the session started. */
  t: number;
  argv: string[];
  ok: boolean;
  /** First line of the reply, trimmed to ~120 chars. */
  summary: string;
  /** For ref commands: how a script finds the element again. */
  hint?: LocatorHint;
  /** URL after the command, when it changed. */
  url?: string;
}
