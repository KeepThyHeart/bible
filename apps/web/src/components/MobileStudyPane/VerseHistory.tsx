import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { formatPassageRef } from '../../constants';
import { parseVerseId } from '../../utils/verseId';

interface VerseHistoryProps {
  history: Array<{ verseId: number; timestamp: number }>;
  onSelect: (verseId: number) => void;
  onClose: () => void;
}

function formatVerseRef(verseId: number): string {
  const { bookNumber, chapter, verse } = parseVerseId(verseId);
  return formatPassageRef(bookNumber, chapter, verse);
}

function relativeTime(timestamp: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('verseHistory.justNow');
  if (mins < 60) return t('verseHistory.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('verseHistory.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('verseHistory.daysAgo', { count: days });
}

export function VerseHistory({ history, onSelect, onClose }: VerseHistoryProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick as EventListener);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick as EventListener);
    };
  }, [onClose]);

  if (history.length === 0) {
    return (
      <div class="verse-history" ref={ref}>
        <div class="verse-history__empty">{t('verseHistory.noHistory')}</div>
      </div>
    );
  }

  return (
    <div class="verse-history" ref={ref}>
      <div class="verse-history__title">{t('verseHistory.recentVerses')}</div>
      {history.map((entry) => (
        <button
          key={entry.verseId}
          class="verse-history__item"
          onClick={() => onSelect(entry.verseId)}
        >
          <span class="verse-history__ref">{formatVerseRef(entry.verseId)}</span>
          <span class="verse-history__time">{relativeTime(entry.timestamp, t)}</span>
        </button>
      ))}
    </div>
  );
}
