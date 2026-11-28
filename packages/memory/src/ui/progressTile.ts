/**
 * The shared progress tile (a ring beside a title, a one-line status and small actions), built in
 * the vanilla DOM. Same markup and classes as `packages/ui` ProgressRing / ProgressTile, styled by
 * `packages/ui/css/kth-classes.css`:
 *
 *   ul.kth-progress-tiles
 *     li.kth-card.kth-progress-tile
 *       div.kth-progress-ring[data-size][data-tone][role=progressbar]
 *         svg.kth-progress-ring__svg > circle.__track + circle.__fill (left out at 0%)
 *         span.kth-progress-ring__value[aria-hidden]
 *       div.kth-progress-tile__body
 *         button.kth-link.kth-progress-tile__title | span.kth-progress-tile__title
 *         span.kth-progress-tile__status[data-tone]   (warning: a leading aria-hidden "⚠ ")
 *         div.kth-progress-tile__actions              (optional)
 */

import { el } from './dom';
import type { Child } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 15.5; // in a 36-unit view box, leaving room for the stroke
const C = 2 * Math.PI * R;

export interface ProgressRingOptions {
  /** 0..100 (clamped). */
  value: number;
  /** Accessible name, e.g. "Gospels: progress". */
  label: string;
  /** Text in the middle. Default: the rounded value with "%". */
  valueText?: string;
  size?: 'sm' | 'md';
  tone?: 'accent' | 'success';
}

function circle(cls: string, attrs: Record<string, string> = {}): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('class', cls);
  c.setAttribute('cx', '18');
  c.setAttribute('cy', '18');
  c.setAttribute('r', String(R));
  for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
  return c;
}

export function progressRing(o: ProgressRingOptions): HTMLElement {
  const pct = Number.isFinite(o.value) ? Math.min(100, Math.max(0, o.value)) : 0;
  const text = o.valueText ?? `${Math.round(pct)}%`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'kth-progress-ring__svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.appendChild(circle('kth-progress-ring__track'));
  if (pct > 0) {
    svg.appendChild(circle('kth-progress-ring__fill', {
      'stroke-dasharray': `${(pct / 100) * C} ${C}`,
      transform: 'rotate(-90 18 18)',
    }));
  }
  return el(
    'div',
    {
      class: 'kth-progress-ring',
      attrs: {
        'data-size': o.size ?? 'md',
        'data-tone': o.tone ?? 'accent',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(pct),
        'aria-valuetext': text,
        'aria-label': o.label,
      },
    },
    [svg, el('span', { class: 'kth-progress-ring__value', text, attrs: { 'aria-hidden': 'true' } })],
  );
}

export type ProgressTileTone = 'muted' | 'warning' | 'success';

export interface ProgressTileOptions {
  value: number;
  ringLabel: string;
  valueText?: string;
  ringTone?: 'accent' | 'success';
  ringSize?: 'sm' | 'md';
  title: string;
  /** When set, the title is a link-styled button that calls this. */
  onTitleClick?: () => void;
  /** Accessible name for the title button when it should say more than the title. */
  titleAria?: string;
  status?: string | null;
  statusTone?: ProgressTileTone;
  /** Extra content after the title (a tag, say). */
  badge?: Child;
  /** Small buttons in a row under the status. */
  actions?: readonly Child[];
  className?: string;
}

/** One `li.kth-card.kth-progress-tile`; put it in `progressTiles()`. */
export function progressTile(o: ProgressTileOptions): HTMLLIElement {
  const title = o.onTitleClick
    ? el('button', {
        class: 'kth-link kth-progress-tile__title',
        title: o.title,
        text: o.title,
        attrs: { type: 'button', ...(o.titleAria ? { 'aria-label': o.titleAria } : {}) },
        on: { click: () => o.onTitleClick?.() },
      })
    : el('span', { class: 'kth-progress-tile__title', title: o.title, text: o.title });
  const tone = o.statusTone ?? 'muted';
  const status = o.status
    ? el('span', { class: 'kth-progress-tile__status', attrs: { 'data-tone': tone } }, [
        tone === 'warning' ? el('span', { text: '⚠ ', attrs: { 'aria-hidden': 'true' } }) : null,
        o.status,
      ])
    : null;
  const actions = o.actions && o.actions.some(Boolean)
    ? el('div', { class: 'kth-progress-tile__actions' }, [...o.actions])
    : null;
  return el('li', { class: o.className ? `kth-card kth-progress-tile ${o.className}` : 'kth-card kth-progress-tile' }, [
    progressRing({
      value: o.value,
      label: o.ringLabel,
      ...(o.valueText !== undefined ? { valueText: o.valueText } : {}),
      ...(o.ringTone ? { tone: o.ringTone } : {}),
      ...(o.ringSize ? { size: o.ringSize } : {}),
    }),
    el('div', { class: 'kth-progress-tile__body' }, [title, o.badge ?? null, status, actions]),
  ]);
}

/** The `ul.kth-progress-tiles` that lays tiles out in a wrapping row. */
export function progressTiles(label: string, tiles: readonly HTMLLIElement[], className?: string): HTMLUListElement {
  return el('ul', { class: className ? `kth-progress-tiles ${className}` : 'kth-progress-tiles', attrs: { 'aria-label': label } }, [...tiles]);
}
