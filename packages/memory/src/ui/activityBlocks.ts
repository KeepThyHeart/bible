/**
 * The activity squares of the My verses table (design-r2 section 6, R2-8).
 *
 * Each table row is one tab stop for its squares (`.sm-blocks` on the row, roving tabindex): arrow keys,
 * Home and End move between the startable squares. A startable square is a real button whose accessible
 * name is the full summary ("Fill in the blanks: 1 of 3 stages passed"), carried by visually hidden text.
 * State never depends on colour alone: gray = not started (empty), white with a dash = not needed (not a
 * button), yellow with "passed/total" = in progress, green with a check = finished.
 */

import type { ActivityBlock, ActivityBlockState } from '../core/progress';
import type { Rung } from '../core/types';
import type { PassageView } from '../core/types';
import { startReciteRun } from './activities';
import { el } from './dom';
import { RUNG_LABEL } from './format';
import type { PanelHost } from './host';
import { tr } from './i18n';

/** The short visible tag of an activity (column headers). */
export function blockTag(rung: ActivityBlock['rung']): string {
  switch (rung) {
    case 'ordering':
      return tr('memory.ui.blocks.tagOrdering', 'Or');
    case 'refmatch':
      return tr('memory.ui.blocks.tagRefmatch', 'Rm');
    case 'blanks':
      return tr('memory.ui.blocks.tagBlanks', 'Bl');
    case 'firstletters':
      return tr('memory.ui.blocks.tagFirstLetters', 'FL');
    case 'refprovide':
      return tr('memory.ui.blocks.tagRefprovide', 'Rf');
    default:
      return tr('memory.ui.blocks.tagRecite', 'Re');
  }
}

/** The one-line accessible summary of a block, also used for the square's title. */
export function blockSummary(block: ActivityBlock): string {
  const name = RUNG_LABEL[block.rung];
  switch (block.state) {
    case 'notStarted':
      return tr('memory.ui.blocks.notStarted', '{name}: not started', { name });
    case 'practicing':
      return tr('memory.ui.blocks.practicing', '{name}: {passed} of {total} stages passed', {
        name,
        passed: block.tiersPassed,
        total: block.tiers,
      });
    case 'complete':
      return block.coveredBy
        ? tr('memory.ui.blocks.completeCovered', '{name}: complete (covered by {other})', { name, other: RUNG_LABEL[block.coveredBy] })
        : tr('memory.ui.blocks.complete', '{name}: complete', { name });
    default:
      return block.naReason === 'speech'
        ? tr('memory.ui.blocks.naSpeech', '{name}: not available (speech is not ready)', { name })
        : tr('memory.ui.blocks.naShort', '{name}: not needed (fewer than 3 verses)', { name });
  }
}

/** A stand-in "not needed" block for a column a row has no block for. */
export function notNeededBlock(rung: Rung): ActivityBlock {
  return { rung, state: 'notApplicable', tiers: 0, tiersPassed: 0, level: 0, bestScore: null, coveredBy: null, startable: false, naReason: 'tooShort' };
}

/** Starts a block (the delegated click path of the table). A complete block practises again. */
export function startBlock(host: PanelHost, pv: PassageView, block: ActivityBlock): void {
  if (!block.startable) return;
  if (block.rung === 'recite') void startReciteRun(host, { kind: 'passage', passageId: pv.passage.id }, 'tap');
  else void host.startSession(pv.passage.id, block.rung);
}

function blockButtons(group: Element): HTMLButtonElement[] {
  return Array.from(group.querySelectorAll<HTMLButtonElement>('button.sm-block-btn'));
}

/** Arrow / Home / End movement inside one row (roving tabindex). Safe to call from a delegated listener. */
export function blocksKeydown(ev: KeyboardEvent): void {
  const target = ev.target as Element | null;
  const group = target?.closest?.('.sm-blocks');
  if (!group || !(target instanceof HTMLButtonElement)) return;
  const buttons = blockButtons(group);
  const current = buttons.indexOf(target);
  if (current === -1 || buttons.length === 0) return;
  const rtl = (group.ownerDocument.defaultView?.getComputedStyle(group).direction ?? 'ltr') === 'rtl';
  let next: number | null = null;
  if (ev.key === 'ArrowRight') next = current + (rtl ? -1 : 1);
  else if (ev.key === 'ArrowLeft') next = current + (rtl ? 1 : -1);
  else if (ev.key === 'Home') next = 0;
  else if (ev.key === 'End') next = buttons.length - 1;
  if (next === null) return;
  ev.preventDefault();
  const idx = Math.min(Math.max(next, 0), buttons.length - 1);
  buttons.forEach((b, i) => b.setAttribute('tabindex', i === idx ? '0' : '-1'));
  buttons[idx]!.focus();
}

/** Keeps the roving stop where the user last was (click or focus from any route). */
export function blocksFocusin(ev: FocusEvent): void {
  const target = ev.target as Element | null;
  const group = target?.closest?.('.sm-blocks');
  if (!group || !(target instanceof HTMLButtonElement)) return;
  const buttons = blockButtons(group);
  const i = buttons.indexOf(target);
  if (i !== -1) buttons.forEach((b, j) => b.setAttribute('tabindex', j === i ? '0' : '-1'));
}

/** The visible cue inside a square, so state is never told by colour alone. */
function cue(block: ActivityBlock): string {
  switch (block.state) {
    case 'complete':
      return '✓';
    case 'notApplicable':
      return '–';
    case 'practicing':
      return block.tiers > 0 ? `${block.tiersPassed}/${block.tiers}` : '…';
    default:
      return '';
  }
}

/**
 * One square. A startable block is a button (`tabindex` set by the caller's roving order); a not-needed
 * block is a plain named image. The caller owns the click and key listeners (see `startBlock`).
 */
export function renderBlockSquare(block: ActivityBlock, opts: { tabStop?: boolean } = {}): HTMLElement {
  const summary = blockSummary(block);
  const glyph = el('span', { class: 'sm-block-glyph', text: cue(block), attrs: { 'aria-hidden': 'true' } });
  if (block.state === 'notApplicable' || !block.startable) {
    return el('span', {
      class: 'sm-block',
      title: summary,
      attrs: { role: 'img', 'aria-label': summary, 'data-state': block.state, 'data-rung': block.rung },
    }, [glyph]);
  }
  return el(
    'button',
    {
      class: 'sm-block sm-block-btn',
      type: 'button',
      title: summary,
      attrs: { 'data-state': block.state, 'data-rung': block.rung, tabindex: opts.tabStop ? '0' : '-1' },
    },
    [glyph, el('span', { class: 'sm-sr-only', text: summary })],
  );
}

/** A decorative sample square for the legend. */
function sampleSquare(state: ActivityBlockState, text: string): HTMLElement {
  return el('span', { class: 'sm-block sm-block-sample', attrs: { 'data-state': state, 'aria-hidden': 'true' } }, [
    el('span', { class: 'sm-block-glyph', text }),
  ]);
}

/** The small key under the table: one sample square per state. */
export function renderBlockLegend(): HTMLElement {
  const items: Array<[ActivityBlockState, string, string]> = [
    ['notStarted', '', tr('memory.ui.blocks.legendNotStarted', 'Not started')],
    ['notApplicable', '–', tr('memory.ui.blocks.legendNotNeeded', 'Not needed')],
    ['practicing', '1/3', tr('memory.ui.blocks.legendInProgress', 'In progress')],
    ['complete', '✓', tr('memory.ui.blocks.legendFinished', 'Finished')],
  ];
  return el(
    'ul',
    { class: 'sm-block-legend', attrs: { 'aria-label': tr('memory.ui.blocks.legendLabel', 'Key') } },
    items.map(([state, glyph, label]) => el('li', { class: 'sm-block-legend-item' }, [sampleSquare(state, glyph), el('span', { text: label })])),
  );
}
