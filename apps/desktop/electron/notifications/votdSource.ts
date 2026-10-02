/**
 * Verse of the day as a notification source: `app:verse-of-the-day`, a rule
 * source (content is bound at fire time), opt-in, 08:00 daily by default. The
 * user may change the time in Preferences.
 */
import { VerseOfTheDayService } from '@bible/core';
import {
  VerseIdHelper,
  getBookName,
  getLocalizer,
  truncateAtWordBoundary,
  type FireContext,
  type NotificationContent,
  type ReminderPlan,
  type RuleSource,
} from '@bible/core/browser';
import { getMainLocale, t } from '../services/MainI18n';

export const VOTD_SOURCE_ID = 'app:verse-of-the-day';
const MAX_TEXT_CHARS = 180;

export interface VotdSourceDeps {
  /** KJV (or default Bible) text of a verse, or null when it is not cheaply available. */
  getVerseText?: (verseId: number) => Promise<string | null> | string | null;
  /** Localized book name (default: the main-process locale's table, else English). */
  bookName?: (book: number) => string;
}

export const VOTD_DEFAULT_PLAN: ReminderPlan = {
  slots: [{ id: 'daily', kind: 'fixed', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] }],
};

function defaultBookName(book: number): string {
  try {
    const names = getLocalizer(getMainLocale()).referenceParserConfig?.displayNames;
    const localized = names?.[book - 1];
    if (localized) return localized;
  } catch {
    /* fall through to English */
  }
  return getBookName(book);
}

/** "2026-09-30" -> that day at local noon (safe from DST edges). */
export function localNoon(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

export function createVotdSource(deps: VotdSourceDeps = {}): RuleSource {
  const service = VerseOfTheDayService.fromDefault();
  const bookName = deps.bookName ?? defaultBookName;
  return {
    id: VOTD_SOURCE_ID,
    kind: 'rules',
    get label() {
      return t('main.notifications.votd.label');
    },
    get description() {
      return t('main.notifications.votd.description');
    },
    defaultEnabled: false,
    userEditable: true,
    plan: () => VOTD_DEFAULT_PLAN,
    async render(ctx: FireContext): Promise<NotificationContent | null> {
      const votd = service.getToday(localNoon(ctx.fire.date));
      const verseId = VerseIdHelper.calculate(votd.book, votd.chapter, votd.verse);
      const reference = `${bookName(votd.book)} ${votd.chapter}:${votd.verse}`;
      let text: string | null = null;
      try {
        text = (await deps.getVerseText?.(verseId)) ?? null;
      } catch {
        text = null;
      }
      const body = text && text.trim() ? `${reference} — ${truncateAtWordBoundary(text, MAX_TEXT_CHARS).text}` : reference;
      return {
        title: t('main.notifications.votd.title'),
        body,
        tag: 'votd',
        target: { kind: 'verse', verseId },
      };
    },
  };
}
