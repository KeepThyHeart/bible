/**
 * The memory core's API: what the UI calls (task 0114).
 *
 * The extension's panel talked to its worker through one message channel
 * (`PanelRequest` in, `PanelReply` out, `WorkerPush` back). As a built-in
 * module that becomes a typed object with one method per request: the UI
 * calls `api.getPlan()` or `api.addPassage({ reference })`. On desktop the
 * object is the feature-module IPC client (`createModuleClient`), whose main
 * side calls `MemoryService` directly; on the web it can be the
 * `MemoryService` itself. Both satisfy `MemoryApi`.
 *
 * The request and reply shapes are still `PanelRequest` / `RequestMap` from
 * `types.ts`, so there is one source of truth: a method's argument is its
 * request without `type`, and requests without fields take no argument.
 *
 * Errors: a method rejects with an `Error` whose message is meant for the
 * user ("That passage is no longer in your plan."), as `{ ok: false, error }`
 * replies were before.
 *
 * Type-only module plus one constant; safe to import anywhere.
 */

import type { PanelRequest, RequestMap, WorkerPush } from './types';

type RequestArgs<K extends PanelRequest['type']> = Omit<Extract<PanelRequest, { type: K }>, 'type'>;

/** One method per former panel request. */
export type MemoryRequestApi = {
  [K in keyof RequestMap & PanelRequest['type']]: keyof RequestArgs<K> extends never
    ? () => Promise<RequestMap[K]>
    : (args: RequestArgs<K>) => Promise<RequestMap[K]>;
};

/** What adding verses from the reader did. */
export type AddVersesOutcome = 'added' | 'revived' | 'exists';

/** Due counts for a badge or status item (global, not the plan's current scope). */
export interface MemoryStatus {
  /** Text-activity cards due now, every list. */
  readonly due: number;
  /** Push cards waiting to be answered. */
  readonly waiting: number;
}

/** The one-time import of the old extension's database, as recorded on this machine. */
export interface MemoryImportStatus {
  /** `null`: never recorded (no old database found yet). */
  readonly status: string | null;
  readonly recordedAt: number | null;
  readonly counts: Record<string, number> | null;
  /** Whether the old extension's database is on this machine (so a manual import can run). */
  readonly sourceAvailable: boolean;
}

/** What a manual import of the old extension's database did. */
export interface MemoryImportResult {
  /** `merged`, or why nothing happened: `no-source`, `not-a-memory-db`, `unsupported-version`. */
  readonly status: string;
  /** Rows added, per table. */
  readonly added: Record<string, number>;
  /** Rows that were already here. */
  readonly matched: Record<string, number>;
  /** Deleted passages restored because the old database has them. */
  readonly revived: number;
}

/**
 * The former extension commands, now plain methods. The caller (verse action,
 * command palette, badge) opens the app itself when a method says so.
 */
export interface MemoryCommandApi {
  /** "Practice what's due": `due: false` (and a notice) when nothing is due. */
  practiceDue(): Promise<{ due: boolean }>;
  /** "Recite what's due aloud": starts a recitation when speech and due cards allow; otherwise a notice. */
  practiceDueAloud(): Promise<{ started: boolean }>;
  /** "Memorize" on verses in the reader: a contiguous run in one chapter becomes one passage. */
  addVerses(args: { verseIds: readonly number[]; module?: string }): Promise<{ outcome: AddVersesOutcome; passageId: number }>;
  getStatus(): Promise<MemoryStatus>;
  getImportStatus(): Promise<MemoryImportStatus>;
  /** Settings > "Import data from the old Scripture Memory extension": merge, never overwrite. */
  importLegacyData(): Promise<MemoryImportResult>;
}

export type MemoryApi = MemoryRequestApi & MemoryCommandApi;

/**
 * What the core pushes to the UI. The extension's `WorkerPush` without
 * `activeVerse` (the UI knows the reader's verse itself), plus a user notice
 * (formerly `ui.showNotification`) and the status the status bar item used to
 * show.
 */
export type MemoryPush =
  | Exclude<WorkerPush, { type: 'activeVerse' }>
  | { type: 'notice'; message: string }
  | { type: 'status'; status: MemoryStatus };

/** Event map for `createModuleClient<MemoryApi, MemoryEvents>('memory')`. */
export interface MemoryEvents {
  push: [push: MemoryPush];
}

/**
 * Every method name, at runtime: the desktop main module registers one IPC
 * handler per entry. `satisfies` makes a method missing here a type error.
 */
const METHODS = {
  getPlan: true,
  getAnalytics: true,
  getSettings: true,
  setDefaultAnswerMode: true,
  setPassageSortOrder: true,
  setPassageAnswerMode: true,
  getContext: true,
  addPassage: true,
  removePassage: true,
  resetPassageProgress: true,
  startSession: true,
  submitStep: true,
  endSession: true,
  navigateTo: true,
  getPassageView: true,
  createList: true,
  renameList: true,
  deleteList: true,
  getListPracticeStats: true,
  movePassage: true,
  setScope: true,
  startRecite: true,
  reciteControl: true,
  getReciteState: true,
  setReciteSettings: true,
  setPassageRecite: true,
  openHostSettings: true,
  deleteReciteHistory: true,
  getPushSettings: true,
  setPushSettings: true,
  requestReminderPermission: true,
  getCardStack: true,
  gradeRecall: true,
  snoozeCard: true,
  consumeLaunchIntent: true,
  practiceDue: true,
  practiceDueAloud: true,
  addVerses: true,
  getStatus: true,
  getImportStatus: true,
  importLegacyData: true,
} as const satisfies Record<keyof MemoryApi, true>;

export const MEMORY_API_METHODS = Object.keys(METHODS) as ReadonlyArray<keyof MemoryApi>;
