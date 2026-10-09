/**
 * Push cards (task 0072): shared types.
 *
 * The reminder engine is a core feature (task 0083) that does not exist yet,
 * so this file carries a LOCAL copy of the `api.reminders` contract from the
 * design. `pushController.ts#detectReminders` feature-detects the real API at
 * runtime; when the host has none, push cards degrade to the "cards waiting"
 * banner. Replace the local copies with core's types once 0083 lands.
 */

import type { DisposableHandle } from './ports';
import type { VerseText } from './types';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
/** Local wall clock, "HH:MM". */
export type WallTime = string;
export type ReminderSlot =
  | { id: string; kind: 'fixed'; time: WallTime; days: Weekday[] }
  | { id: string; kind: 'window'; start: WallTime; end: WallTime; count: number; days: Weekday[] };
export interface QuietHours {
  start: WallTime;
  end: WallTime;
}
export interface ReminderPlan {
  slots: ReminderSlot[];
  /** Fires inside it are dropped, not deferred. May wrap midnight. */
  quiet?: QuietHours;
  maxPerDay: number;
}
export interface FireTime {
  at: number;
  slotId: string;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

// --- local copy of the core `api.reminders` contract (task 0083) ---------------
export interface ReminderItem {
  key: string;
  fireAt: number;
  title: string;
  body: string;
  tag?: string;
  data?: JsonValue;
}
export interface ReminderCapabilities {
  permission: 'granted' | 'denied' | 'prompt' | 'unsupported';
  whenClosed: 'fires' | 'background-only' | 'never';
  actions: boolean;
}
export type ReminderEvent<T> = (
  listener: (e: T) => void | Promise<void>,
) => DisposableHandle | Promise<DisposableHandle>;
export interface IRemindersApi {
  replaceAll(items: ReminderItem[]): Promise<{ accepted: number }>;
  capabilities(): Promise<ReminderCapabilities>;
  requestPermission(): Promise<ReminderCapabilities['permission']>;
  onActivated: ReminderEvent<{ key: string; data?: JsonValue; firedAt: number }>;
  onMissed: ReminderEvent<{ keys: string[] }>;
}

/** Declared in extension.json once core adds it to the manifest schema (0083/C2). */
export const PUSH_PERMISSION = 'notifications:schedule';
export const RECALL_RUNG = 'recall';

export interface PushCardSettings {
  enabled: boolean;
  plan: ReminderPlan;
  source: 'dueThenReview' | 'dueOnly' | 'pinned';
  pinnedPassageIds: number[];
  prompt: 'reference' | 'firstWords';
  lockScreen: 'reference' | 'generic';
}

export type RecallGrade = 'missed' | 'partly' | 'knew';
export const RECALL_SCORES: Record<RecallGrade, number> = { missed: 0.3, partly: 0.7, knew: 1 };

export type PushCardState = 'scheduled' | 'fired' | 'waiting' | 'done' | 'dropped';
export interface PushCardRow {
  key: string;
  passageId: number;
  fireAt: number;
  origin: 'plan' | 'snooze';
  state: PushCardState;
  updatedAt: number;
}
export interface PushCandidate {
  passageId: number;
  reference: string;
  lastAttemptAt: number | null;
  recallDueAt: number | null;
  wellLearned: boolean;
}

export interface PushStatus {
  hostApi: boolean;
  permission: ReminderCapabilities['permission'] | null;
  whenClosed: ReminderCapabilities['whenClosed'] | null;
  message: string;
}
export interface PushSettingsView {
  settings: PushCardSettings;
  status: PushStatus;
  passages: { id: number; reference: string }[];
}
export interface RecallCardView {
  key: string | null;
  passageId: number;
  reference: string;
  /** First words when prompt = 'firstWords', else null. */
  cue: string | null;
  verses: VerseText[];
  firedAt: number | null;
}
export interface CardStackView {
  cards: RecallCardView[];
  waitingCount: number;
}
