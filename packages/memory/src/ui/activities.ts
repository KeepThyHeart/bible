/**
 * The six activity tiles, as one declarative table.
 *
 * DOM-free, per the note at the top of `format.ts`: this is the copy the
 * home screen's tile grid renders, and keeping it as data rather
 * than markup means a test can assert the catalogue's shape and wording
 * directly, without a browser.
 *
 * `id` doubles as the key `components.ts#icon()` already expects - its
 * `IconName` union (minus the two chrome names `home`/`menu`) is exactly
 * these six, so a tile and its icon are always looked up the same way.
 *
 * `rung` is `null` for exactly one tile now: `variety` is not one activity
 * but a mix of them, so no single `Rung` names it. Every other tile names its own
 * `Rung` (`types.ts`).
 * `suggest.ts#pickFlowTarget` (an empty result) plus
 * `PlanView.referenceActivitiesUnlocked` decide whether a tile can be pressed
 * right now - this table only says what the tile is called and what it does.
 */

import type { PlanView, ReciteStateView, Rung } from '../core/types';
import type { PanelHost } from './host';

/** The six tile ids - see the file header for why `variety` is not a `Rung`. */
export type ActivityId = 'variety' | 'refmatch' | 'ordering' | 'blanks' | 'firstletters' | 'refprovide';

/** One row of the tile catalogue. */
export interface ActivityTile {
  id: ActivityId;
  /** The `Rung` this tile starts, or `null` for `variety` (see above). */
  rung: Rung | null;
  title: string;
  subtext: string;
}

/**
 * The tile catalogue, in the order the design doc's table lists them and the
 * grid draws them.
 *
 * Copy is verbatim from the design doc - do not paraphrase it here even for
 * a small consistency fix; change the doc first.
 */
export const ACTIVITY_TILES: readonly ActivityTile[] = [
  {
    id: 'variety',
    rung: null,
    title: 'Variety',
    subtext: "A mix of activities based on what's next in better learning your verse list.",
  },
  {
    id: 'refmatch',
    rung: 'refmatch',
    title: 'Match References',
    subtext: "Match a passage's text to its reference.",
  },
  {
    id: 'ordering',
    rung: 'ordering',
    title: 'Put in Order',
    subtext: 'A passage has its verses shuffled, and you put them in order.',
  },
  {
    id: 'blanks',
    rung: 'blanks',
    title: 'Fill in the Blanks',
    subtext: 'A passage is shown with blanks, and you provide the first letter or the entire word for each blank.',
  },
  {
    id: 'firstletters',
    rung: 'firstletters',
    title: 'First Letters',
    subtext: 'A passage reference is given, and you type the first letter of each word, in order.',
  },
  {
    id: 'refprovide',
    rung: 'refprovide',
    title: 'Provide Reference',
    subtext: 'The passage text is shown, and you type its reference.',
  },
];

// ---------------------------------------------------------------------------
// Recite aloud (optional; needs the speech host)
// ---------------------------------------------------------------------------

/**
 * The recite tile. Kept out of `ACTIVITY_TILES` on purpose: it is optional,
 * is not a practice-session flow (it starts `startRecite`, not a session),
 * and exists only while `plan.speech.state === 'ready'`.
 */
export const RECITE_TILE = {
  id: 'recite',
  rung: 'recite',
  title: 'Recite Aloud',
  subtext: 'Say a passage aloud from memory and see which words you got.',
} as const;

/** The recite tile is offered only when speech is ready. */
export function reciteTileVisible(plan: PlanView): boolean {
  return plan.speech.state === 'ready';
}

/** The "Recite what's due aloud" entry: label, due count and whether it can be pressed. */
export function reciteDueEntry(plan: PlanView): { label: string; count: number; enabled: boolean } | null {
  if (!reciteTileVisible(plan)) return null;
  const count = plan.reciteDueCount;
  return {
    label: count > 0 ? `Recite what's due aloud (${count})` : "Recite what's due aloud",
    count,
    enabled: count > 0,
  };
}

/**
 * Starts a recite run and switches the panel to it.
 *
 * The panel (`panel.ts`) builds the screen from `getReciteState` when the
 * `recite` view renders, so this only has to start the run and navigate.
 */
export async function startReciteRun(
  host: PanelHost,
  source: { kind: 'passage'; passageId: number } | { kind: 'due' },
  mode: 'tap' | 'handsfree',
): Promise<ReciteStateView | null> {
  const reply = await host.request({ type: 'startRecite', source, mode });
  if (!reply.ok) {
    host.announce(reply.error);
    return null;
  }
  host.go({ type: 'reciteStarted', reciteId: reply.data.reciteId, mode: reply.data.mode });
  return reply.data;
}
