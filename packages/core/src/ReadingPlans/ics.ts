/**
 * Export a plan's schedule as an iCalendar file (one all-day event per reading day, with an
 * optional alarm), so any calendar app can remind the reader. Pure; the app saves the text.
 */
import type { Enrollment, IsoDate, PlanDefinition, Reading } from './types';
import { addDays } from './dates';
import { dateForDay, firstUnreadDay, indexCompletions } from './scheduler';
import type { Completion } from './types';

export interface IcsOptions {
  /** Formats one reading ("Genesis 1-3"). */
  formatReading: (r: Reading) => string;
  /** Today's reading date: flexible plans lay their unread days from here. */
  today: IsoDate;
  /** Add a display alarm at this local time (`HH:MM`) on each day. */
  alarmTime?: string;
  /** Title prefix (defaults to the plan name). */
  title?: string;
  /** Product id line. */
  prodId?: string;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets (RFC 5545 3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

const compact = (d: IsoDate) => d.replace(/-/g, '');

export function planToIcs(plan: PlanDefinition, e: Enrollment, completions: readonly Completion[], options: IcsOptions): string {
  const title = options.title ?? e.planName;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${options.prodId ?? '-//Keep Thy Heart//Bible reading plans//EN'}`, 'CALSCALE:GREGORIAN'];
  const progress = indexCompletions(completions, e.id);
  const first = firstUnreadDay(plan, progress) ?? plan.days.length + 1;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const flexStart = { readingDays: e.readingDays, startDate: options.today };
  for (let day = 1; day <= plan.days.length; day++) {
    const date = e.pacing === 'fixed' ? dateForDay(e, day) : day < first ? null : dateForDay(flexStart, day - first + 1);
    if (!date) continue;
    const summary = `${title}: ${plan.days[day - 1].readings.map(options.formatReading).join('; ')}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}-${day}@reading-plans`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
      fold(`SUMMARY:${escapeText(summary)}`),
    );
    if (options.alarmTime && /^\d{2}:\d{2}$/.test(options.alarmTime)) {
      const [h, m] = options.alarmTime.split(':').map(Number);
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${escapeText(summary)}`), `TRIGGER;RELATED=START:PT${h}H${m}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
