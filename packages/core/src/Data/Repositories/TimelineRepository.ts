import type { ISql } from '../Core/ISql';
import type {
  TimePrecision,
  TimelineChronologyDto,
  TimelineDataset,
  TimelineDateDto,
  TimelineItemDto,
  TimelineLaneDto,
} from '../../Timeline/types';
import { TIME_PRECISIONS } from '../../Timeline/types';
import type { ITimelineRepository } from './ITimelineRepository';

interface ChronologyRow { chronology_id: string; name: string; description: string | null; fallback_id: string | null; is_default: number; sort_order: number }
interface LaneRow { lane_id: string; name: string; group_name: string | null; color_key: string | null; sort_order: number }
interface ItemRow { item_id: number; slug: string; kind: string; lane_id: string; title: string; summary: string | null; entity_category: string | null; entity_id: string | null; reviewed_by: string | null }
interface DateRow { item_id: number; chronology_id: string; start_day: number; end_day: number | null; start_min: number | null; start_max: number | null; end_min: number | null; end_max: number | null; precision: string; circa: number; basis: string | null }
interface LinkRow { source_id: number; verse_id_start: number; verse_id_end: number; link_type: string }
interface InfoRow { full_name: string; abbreviation: string; version: string | null; license_spdx: string | null; description: string | null }

const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

function toDate(r: DateRow): TimelineDateDto {
  const precision = (TIME_PRECISIONS as readonly string[]).includes(r.precision) ? (r.precision as TimePrecision) : 'year';
  const d: TimelineDateDto = { start: r.start_day, precision, circa: r.circa === 1 };
  if (r.end_day !== null) d.end = r.end_day;
  if (r.start_min !== null) d.startMin = r.start_min;
  if (r.start_max !== null) d.startMax = r.start_max;
  if (r.end_min !== null) d.endMin = r.end_min;
  if (r.end_max !== null) d.endMax = r.end_max;
  if (r.basis !== null) d.basis = r.basis;
  return d;
}

export class TimelineRepository implements ITimelineRepository {
  constructor(private readonly sql: ISql) {}

  getDataset(): TimelineDataset {
    const info = this.sql.queryOne<InfoRow>(
      'SELECT full_name, abbreviation, content_version AS version, license_spdx, description FROM module_info WHERE info_id = 1'
    );
    const chronologies: TimelineChronologyDto[] = this.sql
      .queryAll<ChronologyRow>('SELECT * FROM timeline_chronology ORDER BY sort_order, chronology_id')
      .map((r) => ({
        id: r.chronology_id,
        name: r.name,
        description: opt(r.description),
        fallbackId: opt(r.fallback_id),
        isDefault: r.is_default === 1,
        sortOrder: r.sort_order,
      }));
    const lanes: TimelineLaneDto[] = this.sql
      .queryAll<LaneRow>('SELECT * FROM timeline_lane ORDER BY sort_order, lane_id')
      .map((r) => ({ id: r.lane_id, name: r.name, group: opt(r.group_name), colorKey: opt(r.color_key), sortOrder: r.sort_order }));

    const items = new Map<number, TimelineItemDto>();
    for (const r of this.sql.queryAll<ItemRow>(
      'SELECT item_id, slug, kind, lane_id, title, summary, entity_category, entity_id, reviewed_by FROM timeline_item ORDER BY sort_order, item_id'
    )) {
      items.set(r.item_id, {
        id: r.item_id,
        slug: r.slug,
        kind: r.kind,
        laneId: r.lane_id,
        title: r.title,
        summary: opt(r.summary),
        entity: r.entity_category && r.entity_id ? { category: r.entity_category, id: r.entity_id } : undefined,
        reviewed: r.reviewed_by !== null,
        passages: [],
        dates: {},
      });
    }
    for (const r of this.sql.queryAll<DateRow>('SELECT * FROM timeline_date')) {
      const item = items.get(r.item_id);
      if (item) item.dates[r.chronology_id] = toDate(r);
    }
    for (const r of this.sql.queryAll<LinkRow>(
      `SELECT source_id, verse_id_start, verse_id_end, link_type FROM verse_link
        WHERE source_type = 'timeline_item' ORDER BY source_id, sort_order, link_id`
    )) {
      items.get(r.source_id)?.passages.push({
        start: r.verse_id_start,
        end: r.verse_id_end,
        primary: r.link_type === 'primary_passage',
      });
    }
    return {
      info: {
        name: info?.full_name ?? 'Timeline',
        abbreviation: info?.abbreviation,
        version: opt(info?.version ?? null),
        license: opt(info?.license_spdx ?? null),
        description: opt(info?.description ?? null),
      },
      chronologies,
      lanes,
      items: [...items.values()],
    };
  }

  getItemIdsForVerse(verseId: number): number[] {
    return this.sql
      .queryAll<{ source_id: number }>(
        `SELECT DISTINCT source_id FROM verse_link
          WHERE source_type = 'timeline_item' AND verse_id_start <= ? AND verse_id_end >= ?
          ORDER BY source_id`,
        [verseId, verseId]
      )
      .map((r) => r.source_id);
  }
}
