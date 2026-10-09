/**
 * The two mastery ladders, and the five-level scale used to display progress
 * on each rung.
 *
 * `DesignSpec.md` originally described one ladder for everything. That was
 * wrong for a reason worth stating plainly: **reordering does not make sense
 * for a single verse**. There is nothing to put in order. Equally, matching a
 * reference to its text needs other references to choose between, so it is
 * meaningless for a passage that is the only thing in the collection.
 *
 * So there are two first rungs, chosen by the shape of the material, and the
 * ladders converge afterwards:
 *
 *     multi-verse passage:   ordering  -> blanks -> firstletters
 *     single verse, siblings: refmatch -> blanks -> firstletters
 *     single verse, alone:               blanks -> firstletters
 *
 * The third case is not a rounding error - it is the state of every plan on
 * the day it is created, because the first thing added is always alone.
 *
 * ## v1: no locks, no promotion
 *
 * The task 0004 review asked for every rung to be practisable at any time -
 * nothing "unlocks", nothing is a warning, and skipping ahead is encouraged
 * rather than merely tolerated. So this file no longer has a promotion
 * threshold or a `CardState`; it has `levelFromScore`, a pure function from
 * "how well did the last attempt go" to a 0-5 display level, and
 * `applicableRungs` is unchanged because *which* rungs exist is still a
 * property of the material, not of how far the user has come.
 *
 * ## v2: tiers, and a level that cannot fall
 *
 * Two activities were added (`refprovide` joins `refmatch` as a reference
 * activity, both gated on `MIN_VERSES_FOR_REFERENCE_ACTIVITIES`), and every
 * activity gained *tiers* - harder renderings of the same exercise.
 *
 * With tiers, "what level is this activity" stopped being a function of one
 * score. It is now `levelForActivity`, derived from per-tier bests over the
 * whole history: how much of the activity has been passed, weighted by how
 * accurately. Because every input is a MAX or a COUNT, the level cannot fall
 * on its own - a bad session shortens the interval and leaves the level
 * alone. The single exception is an explicit reset
 * (`store.ts#resetPassageProgress`), which moves each card's
 * `progress_reset_at` forward so the history before it stops counting.
 *
 * `levelFromScore` survives, because the single-tier case still is a pure
 * accuracy question, and because `card.state`'s human-readable label is still
 * written from it.
 */

import type { Rung } from './types';
import { RUNG_ORDER } from './types';

/**
 * How many other passages must exist before `refmatch` is worth offering.
 *
 * Two total: the passage itself and at least one other to be confused with. A
 * picker with one option is not an exercise. `refprovide` has no such floor -
 * supplying a reference from memory needs nothing to choose between.
 */
const MIN_PASSAGES_FOR_REFMATCH = 2;

/**
 * How many verses must be in scope before the reference activities apply.
 *
 * "Which reference is this?" and "what reference is this?" are only worth
 * asking once the plan holds enough material that the answer is not obvious
 * from the shape of the plan. T8 builds the activities themselves; this
 * constant is the read-time gate they are already held behind, so a plan that
 * grows past the bar gains them without anything being migrated.
 */
export const MIN_VERSES_FOR_REFERENCE_ACTIVITIES = 25;

/**
 * Every rung the *material* allows, in ladder order - which is exactly the
 * set of cards a passage gets.
 *
 * Deliberately NOT the same question as `applicableRungs`. A card is a place
 * to hang a history, so one exists for every activity the passage could ever
 * be asked, and it exists from the moment the passage is added. Whether the
 * activity is offered *today* is `applicableRungs`, recomputed on every read -
 * see the header on `store.ts#syncLadders` for why that distinction is the
 * whole design.
 *
 * The only thing the material itself rules out is `ordering`: a single verse
 * has no order to put it in, and no amount of plan growth will give it one.
 */
export function materialRungs(verseCount: number): Rung[] {
  const rungs: Rung[] = [];
  if (verseCount > 1) rungs.push('ordering');
  rungs.push('refmatch', 'blanks', 'firstletters', 'refprovide');
  // Every passage gets a recite card from the start so history can hang on it.
  rungs.push('recite');
  return rungs;
}

/**
 * Which rungs apply to this passage right now, in ladder order.
 *
 * Three read-time facts, none of them frozen into a row:
 *
 *   - `verseCount`      - this passage's own length. Gates `ordering`.
 *   - `siblingCount`    - passages in the same collection, including this one.
 *                         Gates `refmatch`, which needs something to be
 *                         confused with.
 *   - `scopeVerseCount` - verses across the whole collection. Gates both
 *                         reference activities at
 *                         `MIN_VERSES_FOR_REFERENCE_ACTIVITIES`.
 *
 * All three can change under a card without the card changing, which is why
 * this is derived on read rather than written at add time.
 */
export function applicableRungs(
  verseCount: number,
  siblingCount: number,
  scopeVerseCount = 0,
  opts: { speech?: boolean } = {},
): Rung[] {
  const referenceActivities = scopeVerseCount >= MIN_VERSES_FOR_REFERENCE_ACTIVITIES;
  const rungs: Rung[] = [];
  if (verseCount > 1) rungs.push('ordering');
  if (referenceActivities && siblingCount >= MIN_PASSAGES_FOR_REFMATCH) rungs.push('refmatch');
  rungs.push('blanks', 'firstletters');
  if (referenceActivities) rungs.push('refprovide');
  // Recite aloud is offered only when listening is usable for the module language.
  if (opts.speech) rungs.push('recite');
  return rungs;
}

/** The rung a newly added passage is suggested to start on. Never null. */
export function firstRungFor(
  verseCount: number,
  siblingCount: number,
  scopeVerseCount = 0,
): Rung {
  return applicableRungs(verseCount, siblingCount, scopeVerseCount)[0] as Rung;
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/**
 * How many difficulty tiers each activity has.
 *
 * A tier is a harder rendering of the same activity, not a different one -
 * fewer candidates, tighter distractors, less shown. An activity is only
 * finished when every one of its tiers has been passed, which is what stops a
 * single easy pass reading as mastery (see `levelForActivity`).
 */
export const TIERS: Readonly<Record<Rung, number>> = {
  ordering: 2,
  refmatch: 3,
  blanks: 2,
  firstletters: 2,
  refprovide: 1,
  recite: 1,
};

/**
 * Human names for each tier, indexed by tier number.
 *
 * Plain strings, used by the later UI tasks; nothing keys off them.
 * `TIER_LABEL[rung].length` is `TIERS[rung]`, and `tierLabel` below is the
 * safe accessor for a tier number that has drifted out of range.
 */
export const TIER_LABEL: Readonly<Record<Rung, readonly string[]>> = {
  ordering: ['Easier', 'Harder'],
  refmatch: ['Any book', 'Same genre', 'Same book'],
  blanks: ['Easier', 'Harder'],
  firstletters: ['Easier', 'Harder'],
  refprovide: ['From memory'],
  recite: ['From memory'],
};

/** The label for one tier, or a bare "Tier n" if the number is out of range. */
export function tierLabel(rung: Rung, tier: number): string {
  return TIER_LABEL[rung][tier] ?? `Tier ${tier + 1}`;
}

/**
 * The "harder carries down" chain, easiest first.
 *
 * Only these three match: recalling a verse from first letters alone
 * demonstrates the missing words and the ordering as a by-product, so mastery
 * of a later member satisfies every earlier one. The reference activities are
 * deliberately NOT in the chain - knowing a passage's words cold says nothing
 * about whether you can name its address, and vice versa.
 *
 * The direction (later = harder) is the same one `RUNG_ORDER` encodes and
 * `ui/format.ts#carriesDownFrom` reads; the two must not disagree.
 */
export const TEXT_RECALL_CHAIN: readonly Rung[] = ['ordering', 'blanks', 'firstletters', 'recite'];

/**
 * Rungs that never block a passage being well learned and that may be absent
 * (no microphone, no speech kit). A real recitation still carries down after
 * the rung stops being applicable.
 */
export const OPTIONAL_RUNGS: readonly Rung[] = ['recite'];

export function isOptionalRung(rung: Rung): boolean {
  return OPTIONAL_RUNGS.includes(rung);
}

/**
 * Minimum score for an attempt to count as a pass, on the 0..1
 * correct-first-attempts-over-steps scale used by the interval scheduler
 * (`scheduler.ts`).
 *
 * This is a different bar from the level thresholds below: it decides whether
 * an attempt steps the *interval* forward or back, not which level box lights
 * up. 0.8 rather than 1.0 because these exercises are long - a seven-verse
 * ordering is seven chances to fumble one - and demanding perfection would
 * mean a passage that is genuinely known never gets a longer interval.
 */
export const PASS_THRESHOLD = 0.8;

/**
 * The level thresholds, expressed as the minimum score (0..1) that reaches
 * each level.
 *
 * `LEVEL_STRATEGY` below decides which score is fed into this table. The
 * thresholds themselves came out of the task 0004 review and are deliberately
 * a developer-tunable constant rather than a user setting - see the note on
 * `LEVEL_STRATEGY`.
 */
const LEVEL_THRESHOLDS: readonly { min: number; level: number }[] = [
  { min: 1.0, level: 5 },
  { min: 0.9, level: 4 },
  { min: 0.75, level: 3 },
  { min: 0.5, level: 2 },
  { min: 0, level: 1 },
];

/**
 * How a card's displayed level is derived from its attempt history.
 *
 * The task 0004 review asked a question it did not want answered by the user:
 * should a level track only the latest attempt (so it can drop), or the best
 * attempt since the activity was last due? The reply was "make it
 * configurable programmatically, not by user" - i.e. a developer decision that
 * does not belong on the Settings screen. `'latest'` is what v1 ships: it is
 * simple, it is what `Card.lastScore` already stores with no extra
 * bookkeeping, and it is softened in practice by "harder carries down"
 * (`PassageView.bestLevel`), which means a single off day on an easy rung
 * cannot undo a passage's "well learned" status once a harder rung has earned
 * it. Swapping in a best-since-due strategy later means changing this one
 * constant and `levelFromScore`'s caller, not the protocol.
 */
export const LEVEL_STRATEGY: 'latest' = 'latest';

/**
 * The 0-5 level a score maps to, for the plan and passage screens' level
 * boxes.
 *
 * `null` (never attempted) is level 0 - an empty row of boxes, matching the
 * wireframe's "Not tried yet". 100% is its own level (5) rather than folded
 * into "90% or more" (4): the review's own words were "basically perfect",
 * and a user who has just aced a passage should see all five boxes lit, not
 * four with a private asterisk.
 */
export function levelFromScore(score: number | null): number {
  if (score === null) return 0;
  for (const { min, level } of LEVEL_THRESHOLDS) {
    if (score >= min) return level;
  }
  return 0;
}

/** The level at and above which a rung counts as "well learned" (green). */
export const WELL_LEARNED_LEVEL = 4;

// ---------------------------------------------------------------------------
// Derived, non-regressing progress
// ---------------------------------------------------------------------------

/**
 * One activity's whole history, reduced to the numbers `levelForActivity`
 * needs.
 *
 * Every field is a MAX or a COUNT over attempts since the card's last reset,
 * which is the property the whole model rests on: nothing here can fall
 * except by an explicit reset, so nothing derived from it can either.
 *
 * `store.ts#listTierProgress` produces exactly these aggregates in one
 * `GROUP BY card_id, tier` query; `summarizeActivity` turns those rows into
 * this shape.
 */
export interface ActivityProgress {
  /** Attempts recorded since the last reset. 0 means "never tried". */
  attempts: number;
  /** Tiers whose best score since the last reset reached `PASS_THRESHOLD`. */
  tiersPassed: number;
  /** `TIERS[rung]`. Always at least 1. */
  totalTiers: number;
  /** Best score on ANY tier, 0..1. `null` when `attempts` is 0. */
  bestScore: number | null;
  /**
   * Best score on the highest-numbered tier that has ever been passed, 0..1.
   * `null` when no tier has been passed.
   */
  hardestTierPassedAccuracy: number | null;
  /**
   * "Overall accuracy": the best score across every attempt, on any tier.
   *
   * Equal to `bestScore` by construction. It is kept as its own field because
   * the formula names it separately and because the *choice* of "best" over
   * "mean" or "latest" is the one judgement call the resolved decision left
   * open - see `levelForActivity`.
   */
  overallAccuracy: number | null;
  /** Lowest tier not yet passed, or the hardest tier once all are passed. */
  nextTier: number;
}

/** One row of `store.ts#listTierProgress`, as `summarizeActivity` reads it. */
export interface TierBest {
  tier: number;
  bestScore: number;
  attempts: number;
}

/**
 * Reduce one card's per-tier aggregates to an `ActivityProgress`.
 *
 * The single place tier rows become a progress summary, so the plan view, the
 * end-of-session summary and the analytics screen cannot drift into three
 * slightly different definitions of "tiers passed".
 *
 * Rows for a tier outside `0 .. TIERS[rung] - 1` are counted as attempts but
 * never as a pass: a tier that no longer exists must not be able to keep an
 * activity looking finished after `TIERS` is retuned.
 */
export function summarizeActivity(rung: Rung, rows: readonly TierBest[]): ActivityProgress {
  const totalTiers = Math.max(1, TIERS[rung]);

  let attempts = 0;
  let bestScore: number | null = null;
  let tiersPassed = 0;
  let hardestTierPassedAccuracy: number | null = null;
  const passed: boolean[] = new Array<boolean>(totalTiers).fill(false);

  for (const row of rows) {
    attempts += row.attempts;
    if (bestScore === null || row.bestScore > bestScore) bestScore = row.bestScore;
    const inRange = Number.isInteger(row.tier) && row.tier >= 0 && row.tier < totalTiers;
    if (inRange && row.bestScore >= PASS_THRESHOLD) passed[row.tier] = true;
  }

  for (let tier = 0; tier < totalTiers; tier += 1) {
    if (!passed[tier]) continue;
    tiersPassed += 1;
    // Ascending, so the last pass seen is the hardest one.
    const row = rows.find((r) => r.tier === tier);
    if (row) hardestTierPassedAccuracy = row.bestScore;
  }

  const nextUnpassed = passed.indexOf(false);
  const nextTier = nextUnpassed === -1 ? totalTiers - 1 : nextUnpassed;

  return {
    attempts,
    tiersPassed,
    totalTiers,
    bestScore,
    hardestTierPassedAccuracy,
    overallAccuracy: bestScore,
    nextTier,
  };
}

/**
 * The 0-5 level one activity displays, derived from its whole history.
 *
 * ## The formula (resolved decision - do not substitute another)
 *
 * The original plan proposed `1 + round(4 * tiersPassed / totalTiers)` for a
 * multi-tier activity, i.e. completeness alone. The user's resolved answer
 * overrides that: completeness is multiplied by accuracy, so grinding every
 * tier badly does not read the same as passing every tier well.
 *
 *     multi-tier (totalTiers > 1):
 *       completeness = tiersPassed / totalTiers          (0 when attempts = 0)
 *       score        = completeness
 *                      * MAX(overallAccuracy, hardestTierPassedAccuracy)
 *       level        = clamp(1 + round(4 * score), 1, 5)
 *
 *     single-tier (totalTiers === 1):
 *       level        = levelFromScore(bestScore)
 *
 *     no attempts at all: level 0, in both cases.
 *
 * Worked example, because it is the one that surprises people: one attempt at
 * 100% on tier 0 of a two-tier activity gives completeness 0.5 and accuracy
 * 1.0, so score 0.5 and level **3** - not 5. A perfect run of the easy tier is
 * genuinely half of the activity, and the level says so. Passing the harder
 * tier as well takes completeness to 1.0 and the level to 5.
 *
 * ## The two judgement calls the decision left open
 *
 * 1. **"Overall accuracy" is the BEST score across attempts**, not the mean
 *    and not the latest. The instruction was to take the most favourable
 *    reasonable reading that is consistent with non-regression, and only a MAX
 *    is monotonic: a mean falls when a good session is followed by a bad one.
 * 2. **The 1-5 scaling is `1 + round(4 * score)`**, not `levelFromScore`.
 *    `levelFromScore` maps *accuracy* to a level and its thresholds are bunched
 *    at the top (0.9 is already level 4), which is right for "how well did you
 *    recall this" and wrong for a completeness-weighted score, where 0.5 means
 *    "half done well" and belongs in the middle of the scale rather than at
 *    level 2. `levelFromScore` is kept for the single-tier path, which IS pure
 *    accuracy.
 *
 * ## Non-regression
 *
 * There is no stored high-water mark, and there deliberately is not one: every
 * input is a MAX or a COUNT over the attempts that survive the card's
 * `progress_reset_at`, both factors of the product are non-decreasing, so the
 * level cannot fall on its own. A bad session still shortens the *interval*
 * (`scheduler.ts` reads the attempt's own score), it just does not lower the
 * level. The only thing that lowers a level is
 * `store.ts#resetPassageProgress`, which moves the reset point forward and
 * makes the history before it stop counting.
 */
export function levelForActivity(progress: ActivityProgress): number {
  const { attempts, tiersPassed, totalTiers, bestScore } = progress;
  if (attempts <= 0) return 0;

  if (totalTiers <= 1) return levelFromScore(bestScore);

  const completeness = tiersPassed / totalTiers;
  const accuracy = Math.max(
    progress.overallAccuracy ?? 0,
    progress.hardestTierPassedAccuracy ?? 0,
  );
  const score = completeness * accuracy;
  return Math.max(1, Math.min(5, 1 + Math.round(4 * score)));
}

/** The minimum an activity needs to look like for the satisfaction rules. */
export interface ActivityLevel {
  rung: Rung;
  level: number;
  applicable: boolean;
}

/**
 * Whether one activity counts as *satisfied* for the passage's sake.
 *
 * Either it was mastered itself, or an applicable activity harder than it in
 * `TEXT_RECALL_CHAIN` was. Note what this is NOT: being satisfied does not
 * give an activity a level. An activity nobody has ever opened still reads
 * level 0 on its own row - see `ui/format.ts#carriesDownFrom`, which is how
 * the panel draws "passed by carry-down" without pretending to a score.
 */
export function isActivitySatisfied(rungs: readonly ActivityLevel[], rung: Rung): boolean {
  const own = rungs.find((r) => r.rung === rung);
  if (own && own.level >= WELL_LEARNED_LEVEL) return true;

  const position = TEXT_RECALL_CHAIN.indexOf(rung);
  if (position === -1) return false;
  return rungs.some(
    (r) =>
      (r.applicable || isOptionalRung(r.rung)) &&
      r.level >= WELL_LEARNED_LEVEL &&
      TEXT_RECALL_CHAIN.indexOf(r.rung) > position,
  );
}

/**
 * Whether a passage as a whole is "well learned": every applicable activity
 * satisfied, over a non-empty set.
 *
 * The emptiness guard is the point. `every` on an empty array is `true`, so a
 * passage whose activities are all gated out - a short plan whose only
 * remaining activities are the reference ones, under the 25-verse rule - would
 * otherwise be reported as mastered without the user ever having answered a
 * question about it.
 */
export function passageWellLearned(rungs: readonly ActivityLevel[]): boolean {
  const applicable = rungs.filter((r) => r.applicable && !isOptionalRung(r.rung));
  if (applicable.length === 0) return false;
  return applicable.every((r) => isActivitySatisfied(rungs, r.rung));
}

/** Rungs in canonical ladder order, so a worker-side list never arrives shuffled. */
export function inRungOrder<T extends { rung: Rung }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => RUNG_ORDER.indexOf(a.rung) - RUNG_ORDER.indexOf(b.rung));
}
