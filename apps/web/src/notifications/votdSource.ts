/** The verse-of-the-day reminder: a rule source rendered at fire time from the data provider. */
import { truncateAtWordBoundary } from '@bible/core/browser';
import type { RuleSource, ReminderPlan, Weekday } from '@bible/core/browser';
import type { VotdData } from '../providers/interfaces';

export const VOTD_SOURCE_ID = 'app:verse-of-the-day';
const BODY_MAX = 180;
const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export interface VotdSourceDeps {
  getVerseOfTheDay(): Promise<VotdData | null>;
  /** Localized book name for a book number. */
  bookName(book: number): string;
  t(key: string): string;
}

/** HTML to plain text: tags dropped, the few entities a verse uses decoded, whitespace folded. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createVotdSource(deps: VotdSourceDeps): RuleSource {
  return {
    kind: 'rules',
    id: VOTD_SOURCE_ID,
    get label() { return deps.t('notifications.votd.label'); },
    get description() { return deps.t('notifications.votd.description'); },
    defaultEnabled: false,
    userEditable: true,
    plan(): ReminderPlan {
      return { slots: [{ id: 'daily', kind: 'fixed', time: '08:00', days: ALL_DAYS }] };
    },
    async render() {
      const v = await deps.getVerseOfTheDay();
      if (!v) return null;
      const ref = `${deps.bookName(v.book)} ${v.chapter}:${v.verse}`;
      const text = plainText(v.text || v.text_html || '');
      const body = text ? `${ref} — ${truncateAtWordBoundary(text, BODY_MAX).text}` : ref;
      return {
        title: deps.t('notifications.votd.title'),
        body,
        tag: 'votd',
        target: { kind: 'verse', verseId: v.book * 1_000_000 + v.chapter * 1000 + v.verse },
      };
    },
  };
}
