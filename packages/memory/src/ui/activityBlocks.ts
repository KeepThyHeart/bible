/**
 * The per-row activity blocks of My verses (design-r2 section 6, R2-8).
 *
 * One `role="toolbar"` per row = one tab stop; arrow keys, Home and End move between the blocks
 * (roving tabindex). Each block is a real button whose accessible name is the full summary
 * ("Fill in the blanks: 1 of 3 stages passed"), carried by visually hidden text, so state never
 * depends on colour: each state is drawn in CSS (empty outline, diagonal half fill, check, light green dash), with a short
 * visible tag per activity and a CSS tooltip (no title, so readers do not announce the summary twice).
 */

import type { ActivityBlock } from '../core/progress';
import type { PassageView } from '../core/types';
import { startReciteRun } from './activities';
import { el } from './dom';
import { RUNG_LABEL } from './format';
import type { PanelHost } from './host';
import { tr } from './i18n';

/** Only a completed block carries a character; the other states are drawn in CSS (outline, diagonal half fill, light green with a dash). */
const GLYPH: Record<ActivityBlock['state'], string> = {
  notStarted: '',
  practicing: '',
  complete: '✓',
  notApplicable: '–',
};

/** The short visible tag on a block, so blocks can be told apart without hovering. */
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

/** The one-line accessible summary of a block, also used for the title and the text list. */
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
        : tr('memory.ui.blocks.naSingle', '{name}: not applicable (single verse)', { name });
  }
}

function start(host: PanelHost, pv: PassageView, block: ActivityBlock): void {
  if (!block.startable) return;
  if (block.rung === 'recite') void startReciteRun(host, { kind: 'passage', passageId: pv.passage.id }, 'tap');
  else void host.startSession(pv.passage.id, block.rung);
}

/** Starts a block (the delegated click path of a long list). */
export function startBlock(host: PanelHost, pv: PassageView, block: ActivityBlock): void {
  start(host, pv, block);
}

function blockButtons(toolbar: Element): HTMLButtonElement[] {
  return Array.from(toolbar.children) as HTMLButtonElement[];
}

/** Arrow / Home / End movement inside one toolbar (roving tabindex). Safe to call from a delegated listener. */
export function blocksKeydown(ev: KeyboardEvent): void {
  const target = ev.target as Element | null;
  const toolbar = target?.closest?.('.sm-blocks');
  if (!toolbar || !(target instanceof HTMLButtonElement)) return;
  const buttons = blockButtons(toolbar);
  const current = buttons.indexOf(target);
  if (current === -1 || buttons.length === 0) return;
  const rtl = (toolbar.ownerDocument.defaultView?.getComputedStyle(toolbar).direction ?? 'ltr') === 'rtl';
  let next: number | null = null;
  if (ev.key === 'ArrowRight') next = current + (rtl ? -1 : 1);
  else if (ev.key === 'ArrowLeft') next = current + (rtl ? 1 : -1);
  else if (ev.key === 'Home') next = 0;
  else if (ev.key === 'End') next = buttons.length - 1;
  if (next === null) return;
  ev.preventDefault();
  const n = buttons.length;
  const idx = Math.min(Math.max(next, 0), n - 1);
  buttons.forEach((b, i) => b.setAttribute('tabindex', i === idx ? '0' : '-1'));
  buttons[idx]!.focus();
}

/** Keeps the roving stop where the user last was (click or focus from any route). */
export function blocksFocusin(ev: FocusEvent): void {
  const target = ev.target as Element | null;
  const toolbar = target?.closest?.('.sm-blocks');
  if (!toolbar || !(target instanceof HTMLButtonElement)) return;
  const buttons = blockButtons(toolbar);
  const i = buttons.indexOf(target);
  if (i !== -1) buttons.forEach((b, j) => b.setAttribute('tabindex', j === i ? '0' : '-1'));
}

/**
 * The toolbar of blocks for one verse. With `delegated` the caller owns the click, keydown and focusin
 * listeners (one set on the whole list: see `blocksKeydown`, `blocksFocusin`, `startBlock`).
 */
export function renderActivityBlocks(
  host: PanelHost,
  pv: PassageView,
  blocks: readonly ActivityBlock[],
  opts: { delegated?: boolean } = {},
): HTMLElement {
  const toolbar = el('div', {
    class: 'sm-blocks',
    attrs: {
      role: 'toolbar',
      'aria-label': tr('memory.ui.blocks.toolbar', 'Activities for {reference}', { reference: pv.passage.reference }),
    },
  });
  blocks.forEach((block, i) => {
    const summary = blockSummary(block);
    const b = el(
      'button',
      {
        class: 'sm-block-btn',
        attrs: {
          type: 'button',
          'data-tip': summary,
          'data-state': block.state,
          'data-rung': block.rung,
          tabindex: i === 0 ? '0' : '-1',
          ...(block.startable ? {} : { 'aria-disabled': 'true' }),
        },
      },
      [
        el('span', { class: 'sm-block-glyph', text: GLYPH[block.state], attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'sm-block-tag', text: blockTag(block.rung), attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'sm-sr-only', text: summary }),
      ],
    );
    if (!opts.delegated) b.addEventListener('click', () => start(host, pv, block));
    toolbar.appendChild(b);
  });
  if (!opts.delegated) {
    toolbar.addEventListener('keydown', blocksKeydown);
    toolbar.addEventListener('focusin', blocksFocusin);
  }
  return toolbar;
}

/** Fills the text list of a summary on demand. */
export function fillActivitySummary(details: Element, blocks: readonly ActivityBlock[]): void {
  const list = details.querySelector('.sm-block-summary-list');
  if (!list || list.childElementCount > 0) return;
  for (const b of blocks) list.appendChild(el('li', { text: blockSummary(b) }));
}

/**
 * The closed "Activities" text summary for touch users: one line per block. With `lazy` the lines are
 * added when the caller calls `fillActivitySummary` (on first open), which keeps a long list cheap.
 */
export function renderActivitySummary(blocks: readonly ActivityBlock[], opts: { lazy?: boolean } = {}): HTMLElement {
  return el('details', { class: 'sm-block-summary' }, [
    el('summary', { text: tr('memory.ui.blocks.summary', 'Activities') }),
    el('ul', { class: 'sm-block-summary-list' }, opts.lazy ? [] : blocks.map((b) => el('li', { text: blockSummary(b) }))),
  ]);
}
