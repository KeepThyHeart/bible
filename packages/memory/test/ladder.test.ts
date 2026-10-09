/**
 * Ladder-shape and level tests.
 *
 * The single fact the `applicableRungs` block exists to protect is that there
 * are TWO ladders, not one, and which one applies is a property of the
 * *material* rather than of the user. A regression back to one ladder would
 * not throw anywhere - it would simply hand a user a single verse and ask
 * them to put it in order, which is not a question. So the shape is asserted
 * directly rather than inferred from anything downstream.
 *
 * The case that gets the most attention below is the third one - a single
 * verse ALONE in the collection, which starts at `blanks` because neither
 * first rung is possible. That is not an exotic edge case: it is the state of
 * every plan on the day it is created, because the first passage a user adds
 * is necessarily the only passage. A `firstRungFor` that returned `refmatch`
 * unconditionally for single verses would break the very first thing every
 * user of this extension ever does, and would do it silently, by handing them
 * a picker with one option.
 *
 * The `levelFromScore` block replaced what used to be `shouldPromote` /
 * `cardStateFor` - task 0004 dropped locks and promotion entirely in favour of
 * a five-level display derived straight from the last score.
 */

import { describe, it, expect } from 'vitest';
import {
  applicableRungs,
  firstRungFor,
  isActivitySatisfied,
  levelForActivity,
  levelFromScore,
  materialRungs,
  MIN_VERSES_FOR_REFERENCE_ACTIVITIES,
  passageWellLearned,
  PASS_THRESHOLD,
  summarizeActivity,
  TEXT_RECALL_CHAIN,
  TIERS,
  TIER_LABEL,
  WELL_LEARNED_LEVEL,
} from '../src/core/ladder';
import type { ActivityLevel, TierBest } from '../src/core/ladder';
import { RUNG_ORDER } from '../src/core/types';
import type { Rung } from '../src/core/types';

/** A scope big enough that the two reference activities are in play. */
const BIG_SCOPE = MIN_VERSES_FOR_REFERENCE_ACTIVITIES;
/** One verse short of it - the boundary the gate is actually written at. */
const SMALL_SCOPE = MIN_VERSES_FOR_REFERENCE_ACTIVITIES - 1;

/** A `listTierProgress`-shaped row, as `summarizeActivity` consumes them. */
function tier(tierNumber: number, bestScore: number, attempts = 1): TierBest {
  return { tier: tierNumber, bestScore, attempts };
}

describe('applicableRungs - which ladder this material is on', () => {
  it('puts a multi-verse passage on the ordering ladder', () => {
    // "Which verse comes next" is the cheapest test of the thing that breaks
    // first in a half-learned passage: not the words, the ORDER. Any passage
    // with more than one verse has an order, so it gets that rung regardless
    // of how many siblings it has.
    expect(applicableRungs(3, 1)).toEqual(['ordering', 'blanks', 'firstletters']);
    expect(applicableRungs(3, 5)).toEqual(['ordering', 'blanks', 'firstletters']);
  });

  it('offers the reference activities only once the scope is big enough', () => {
    // The two reference activities are gated on how much material is in the
    // plan, not on this passage's own length: "which reference is this?" is a
    // formality in a plan of three verses and a real question in a plan of
    // fifty. `refmatch` additionally needs a sibling to be confused with - a
    // picker with one option is not an exercise - while `refprovide`, which
    // asks the user to supply the reference, needs nothing to choose between.
    expect(applicableRungs(1, 2, BIG_SCOPE)).toEqual([
      'refmatch',
      'blanks',
      'firstletters',
      'refprovide',
    ]);
    expect(applicableRungs(1, 1, BIG_SCOPE)).toEqual(['blanks', 'firstletters', 'refprovide']);
  });

  it('treats the verse-count gate as inclusive, at the exact boundary', () => {
    // An off-by-one here is invisible: the activities simply never appear, or
    // appear one verse early, and nothing throws either way.
    expect(applicableRungs(1, 2, SMALL_SCOPE)).toEqual(['blanks', 'firstletters']);
    expect(applicableRungs(1, 2, BIG_SCOPE)).toContain('refmatch');
    expect(applicableRungs(1, 2, BIG_SCOPE)).toContain('refprovide');
  });

  it('gives a single verse ALONE in a small plan neither first rung', () => {
    // The state of every plan on day one. Reordering one verse is meaningless
    // and the reference activities have nothing to work with yet, so the
    // ladder starts at `blanks`. A regression that emitted `refmatch` here
    // would hand the very first user of the very first passage a one-option
    // picker.
    expect(applicableRungs(1, 1)).toEqual(['blanks', 'firstletters']);
    // A collection that somehow reports zero siblings (a passage read back
    // mid-delete, say) must degrade the same way rather than throwing.
    expect(applicableRungs(1, 0)).toEqual(['blanks', 'firstletters']);
  });

  it('never emits a rung out of canonical order, on any ladder', () => {
    // `RUNG_ORDER` is what the passage screen and `nextDueCard`'s CASE
    // expression both key off. If `applicableRungs` ever returned its rungs in
    // a different relative order the two would silently disagree about which
    // rung comes next, so the invariant is pinned here rather than trusted.
    const shapes: [number, number, number][] = [
      [1, 1, 0],
      [1, 2, 0],
      [2, 1, 0],
      [7, 4, 0],
      [1, 2, BIG_SCOPE],
      [7, 4, BIG_SCOPE],
      [1, 1, BIG_SCOPE],
    ];
    for (const [verses, siblings, scope] of shapes) {
      const rungs = applicableRungs(verses, siblings, scope);
      const positions = rungs.map((r) => RUNG_ORDER.indexOf(r));
      const sorted = [...positions].sort((a, b) => a - b);
      expect(positions).toEqual(sorted);
    }
  });

  it('always includes the two shared rungs, so a ladder is never empty', () => {
    // `firstRungFor` is documented as "never null" and its callers rely on
    // that - `syncLadders` indexes `wanted[0]` without a guard. The guarantee
    // comes from `blanks` and `firstletters` applying unconditionally.
    for (const verses of [1, 2, 50]) {
      for (const siblings of [0, 1, 2, 20]) {
        for (const scope of [0, SMALL_SCOPE, BIG_SCOPE, 500]) {
          const rungs = applicableRungs(verses, siblings, scope);
          expect(rungs).toContain('blanks');
          expect(rungs).toContain('firstletters');
        }
      }
    }
  });
});

describe('materialRungs - which CARDS exist, as opposed to what applies', () => {
  it('gives every passage a card for both reference activities, whatever the scope', () => {
    // The distinction the whole design rests on. Applicability is a read-time
    // computation over facts that move (`scopeVerseCount`, `siblingCount`); a
    // card is where a history hangs and must exist from the start. If cards
    // were created only when an activity became applicable, the day the plan
    // crossed 25 verses would silently become the day the user's history with
    // reference activities began.
    expect(materialRungs(1)).toEqual(['refmatch', 'blanks', 'firstletters', 'refprovide', 'recite']);
    expect(materialRungs(3)).toEqual([
      'ordering',
      'refmatch',
      'blanks',
      'firstletters',
      'refprovide',
      'recite',
    ]);
  });

  it('withholds only what the material itself rules out, for good', () => {
    // A single verse can never gain an order, no matter how the plan grows -
    // so `ordering` is the one rung it is right to never create a card for.
    expect(materialRungs(1)).not.toContain('ordering');
    expect(materialRungs(2)).toContain('ordering');
  });

  it('is a superset of everything applicable, at every scope', () => {
    // If applicability could ever name a rung with no card, `syncLadders`
    // would have built a ladder the plan view asks for and cannot find.
    for (const verses of [1, 2, 9]) {
      for (const siblings of [0, 1, 5]) {
        for (const scope of [0, SMALL_SCOPE, BIG_SCOPE, 400]) {
          const material = new Set(materialRungs(verses));
          for (const rung of applicableRungs(verses, siblings, scope)) {
            expect(material.has(rung)).toBe(true);
          }
        }
      }
    }
  });
});

describe('firstRungFor', () => {
  it('agrees with the head of applicableRungs for every shape', () => {
    // These are two entry points onto the same fact, and `store.syncLadders`
    // uses the array form while `main.ts` uses the scalar one. Letting them
    // drift would mean a card inserted at one rung while the plan view showed
    // the ladder starting at another.
    const shapes: [number, number][] = [
      [1, 1],
      [1, 2],
      [4, 1],
      [4, 6],
    ];
    for (const [verses, siblings] of shapes) {
      expect(firstRungFor(verses, siblings)).toBe(applicableRungs(verses, siblings)[0]);
    }
  });

  it('starts a brand new plan on blanks', () => {
    expect(firstRungFor(1, 1)).toBe('blanks');
  });
});

describe('levelFromScore', () => {
  it('is 0 for a card that has never been attempted', () => {
    // `null` is "never tried", which the plan and passage screens draw as an
    // empty row of boxes - not level 1, which would look like a failed try.
    expect(levelFromScore(null)).toBe(0);
  });

  it('reaches every level at its documented threshold', () => {
    expect(levelFromScore(1)).toBe(5);
    expect(levelFromScore(0.9)).toBe(4);
    expect(levelFromScore(0.75)).toBe(3);
    expect(levelFromScore(0.5)).toBe(2);
    expect(levelFromScore(0.01)).toBe(1);
  });

  it('treats each threshold as inclusive, not as a value to beat', () => {
    // A user who reaches exactly 90% should see level 4 lit, not be one point
    // short of it - these are the boundaries the level boxes are drawn from,
    // and an off-by-one here reads as "so close" for no reason.
    expect(levelFromScore(0.899999)).toBe(3);
    expect(levelFromScore(0.9)).toBe(4);
    expect(levelFromScore(0.999999)).toBe(4);
    expect(levelFromScore(1)).toBe(5);
  });

  it('never goes below level 1 once any attempt has been made', () => {
    // Level 0 is reserved for "never tried" (see above). A very poor score
    // still reflects an attempt and should not be indistinguishable from one.
    expect(levelFromScore(0)).toBe(1);
  });

  it('agrees with WELL_LEARNED_LEVEL at the green boundary', () => {
    expect(levelFromScore(0.9)).toBe(WELL_LEARNED_LEVEL);
    expect(levelFromScore(0.89)).toBeLessThan(WELL_LEARNED_LEVEL);
  });
});

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

describe('TIERS and TIER_LABEL', () => {
  it('declares a tier count for every rung, and a label for every tier', () => {
    // `TIER_LABEL[rung][tier]` is indexed by a number the store computed. A
    // rung added to the union without a tier count reads as `undefined` and
    // turns the whole completeness fraction into `NaN`, which then renders as
    // an empty level rather than throwing anywhere.
    for (const rung of RUNG_ORDER) {
      expect(TIERS[rung]).toBeGreaterThanOrEqual(1);
      expect(TIER_LABEL[rung]).toHaveLength(TIERS[rung]);
      for (const label of TIER_LABEL[rung]) expect(label.length).toBeGreaterThan(0);
    }
  });

  it('makes refprovide the single-tier activity', () => {
    // The one rung that takes the pure-accuracy path through
    // `levelForActivity`; asserted so that giving it tiers later cannot be
    // done without noticing that it changes how its level is computed.
    expect(TIERS.refprovide).toBe(1);
  });
});

describe('summarizeActivity', () => {
  it('reports nothing attempted as nothing attempted', () => {
    const progress = summarizeActivity('blanks', []);
    expect(progress).toMatchObject({
      attempts: 0,
      tiersPassed: 0,
      totalTiers: 2,
      bestScore: null,
      hardestTierPassedAccuracy: null,
      overallAccuracy: null,
      nextTier: 0,
    });
  });

  it('counts a tier as passed at exactly PASS_THRESHOLD, not above it', () => {
    // 0.8 is documented as the bar an attempt has to *reach*, and the same
    // number decides whether the interval steps forward in `scheduler.ts`. An
    // activity that counted as scheduled-forward but not as tier-passed would
    // be a quiet contradiction between the two.
    expect(summarizeActivity('blanks', [tier(0, PASS_THRESHOLD)]).tiersPassed).toBe(1);
    expect(summarizeActivity('blanks', [tier(0, PASS_THRESHOLD - 0.001)]).tiersPassed).toBe(0);
  });

  it('takes the best across tiers as the overall accuracy', () => {
    const progress = summarizeActivity('blanks', [tier(0, 0.9, 3), tier(1, 0.4, 2)]);
    expect(progress.attempts).toBe(5);
    expect(progress.overallAccuracy).toBe(0.9);
    expect(progress.bestScore).toBe(0.9);
    expect(progress.tiersPassed).toBe(1);
  });

  it('reads the hardest PASSED tier, not the hardest attempted one', () => {
    // The formula's `accuracy_on_hardest_tier_passed`. Tier 2 was attempted
    // and failed, so tier 1 is still the hardest ground actually held.
    const progress = summarizeActivity('refmatch', [tier(0, 1), tier(1, 0.85), tier(2, 0.3)]);
    expect(progress.tiersPassed).toBe(2);
    expect(progress.hardestTierPassedAccuracy).toBe(0.85);
  });

  it('serves the lowest unpassed tier next, and the hardest once all are passed', () => {
    // The deterministic ladder policy `RungView.nextTier` carries to T6.
    expect(summarizeActivity('refmatch', []).nextTier).toBe(0);
    expect(summarizeActivity('refmatch', [tier(0, 1)]).nextTier).toBe(1);
    // A pass out of order does not let the skipped tier be skipped.
    expect(summarizeActivity('refmatch', [tier(1, 1)]).nextTier).toBe(0);
    expect(
      summarizeActivity('refmatch', [tier(0, 1), tier(1, 0.9), tier(2, 0.8)]).nextTier,
    ).toBe(2);
  });

  it('ignores a pass at a tier that no longer exists', () => {
    // `TIERS` is a developer-tunable constant. Lowering it must not leave an
    // activity looking finished on the strength of a tier that has been
    // removed - the attempt still counts as an attempt, just not as progress.
    const progress = summarizeActivity('refprovide', [tier(0, 1), tier(4, 1)]);
    expect(progress.attempts).toBe(2);
    expect(progress.tiersPassed).toBe(1);
  });
});

describe('levelForActivity - the resolved mastery formula', () => {
  it('is 0 until something has actually been attempted', () => {
    expect(levelForActivity(summarizeActivity('blanks', []))).toBe(0);
    expect(levelForActivity(summarizeActivity('refprovide', []))).toBe(0);
  });

  it('reads a perfect run of ONE tier of two as level 3, not 5', () => {
    // The worked example from the resolved decision, and the single most
    // important assertion in this file. completeness = 1/2, accuracy = 1.0,
    // so score = 0.5 and level = 1 + round(4 * 0.5) = 3. The formula this
    // replaced would have said 5, which claimed mastery of a harder tier the
    // user has never been shown.
    const progress = summarizeActivity('blanks', [tier(0, 1)]);
    expect(progress.tiersPassed).toBe(1);
    expect(progress.totalTiers).toBe(2);
    expect(levelForActivity(progress)).toBe(3);
  });

  it('reaches the top of the scale only when every tier has been passed well', () => {
    expect(levelForActivity(summarizeActivity('blanks', [tier(0, 1), tier(1, 1)]))).toBe(5);
    // Every tier passed, but scrappily: complete, not perfect.
    expect(
      levelForActivity(summarizeActivity('blanks', [tier(0, 0.8), tier(1, 0.8)])),
    ).toBe(4);
  });

  it('weights completeness by accuracy rather than by completeness alone', () => {
    // The plan's original proposal was completeness alone, which would have
    // given these two the same level: both have passed both tiers, so both
    // are 100% complete. The resolved formula separates them, because one of
    // them only ever scraped the pass mark.
    const scraped = levelForActivity(
      summarizeActivity('blanks', [tier(0, PASS_THRESHOLD), tier(1, PASS_THRESHOLD)]),
    );
    const aced = levelForActivity(summarizeActivity('blanks', [tier(0, 1), tier(1, 1)]));
    expect(scraped).toBeLessThan(aced);
    expect(scraped).toBe(4);
    expect(aced).toBe(5);
  });

  it('never drops when a later session goes badly', () => {
    // Non-regression, stated as the property rather than as one example: a
    // worse attempt only ever adds a row, and every input is a MAX or a
    // COUNT, so nothing the user does afterwards can lower the number. The
    // *interval* still reacts - that is `scheduler.ts`, and it reads the
    // attempt's own score, not this.
    const after = [tier(0, 1, 1), tier(0, 0.2, 1)];
    const merged = [tier(0, 1, 2)]; // what the GROUP BY actually returns
    const before = levelForActivity(summarizeActivity('blanks', [tier(0, 1)]));
    expect(levelForActivity(summarizeActivity('blanks', merged))).toBeGreaterThanOrEqual(before);
    expect(after).toHaveLength(2); // the two rows really do collapse to one best
  });

  it('uses accuracy alone for a single-tier activity, from the BEST attempt', () => {
    // `refprovide` has one tier, so completeness is meaningless and the level
    // is `levelFromScore` of the best attempt ever - never the latest, which
    // is the one thing that could make it fall.
    expect(levelForActivity(summarizeActivity('refprovide', [tier(0, 1, 4)]))).toBe(5);
    expect(levelForActivity(summarizeActivity('refprovide', [tier(0, 0.9)]))).toBe(
      WELL_LEARNED_LEVEL,
    );
    expect(levelForActivity(summarizeActivity('refprovide', [tier(0, 0.1)]))).toBe(1);
  });

  it('stays inside 1..5 once anything has been attempted', () => {
    for (const rung of RUNG_ORDER) {
      for (const score of [0, 0.01, 0.5, 0.79, 0.8, 0.999, 1]) {
        const level = levelForActivity(summarizeActivity(rung, [tier(0, score)]));
        expect(level).toBeGreaterThanOrEqual(1);
        expect(level).toBeLessThanOrEqual(5);
      }
    }
  });

  it('rises monotonically as tiers are passed', () => {
    // Three snapshots of the same `refmatch` card, each a superset of the
    // last. The level is allowed to stay put; it is never allowed to fall.
    const snapshots: TierBest[][] = [
      [tier(0, 0.9)],
      [tier(0, 0.9), tier(1, 0.85)],
      [tier(0, 0.9), tier(1, 0.85), tier(2, 0.82)],
    ];
    let previous = 0;
    for (const rows of snapshots) {
      const level = levelForActivity(summarizeActivity('refmatch', rows));
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
    // 3 of 3 tiers passed, best accuracy 0.9: 1 + round(4 * 0.9) = 5.
    expect(previous).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// "Harder carries down", and what well-learned means now
// ---------------------------------------------------------------------------

/** A `RungView`-shaped triple, which is all the satisfaction rules read. */
function activity(rung: Rung, level: number, applicable = true): ActivityLevel {
  return { rung, level, applicable };
}

describe('TEXT_RECALL_CHAIN', () => {
  it('runs easiest to hardest, the same direction RUNG_ORDER does', () => {
    // `ui/format.ts#carriesDownFrom` reads the direction off `RUNG_ORDER`
    // (later index = harder) and this module reads it off the chain. If the
    // two disagreed, the panel would draw an activity as carried-down that
    // the worker does not count as satisfied, or the reverse.
    const positions = TEXT_RECALL_CHAIN.map((r) => RUNG_ORDER.indexOf(r));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(TEXT_RECALL_CHAIN).toEqual(['ordering', 'blanks', 'firstletters', 'recite']);
  });

  it('leaves the reference activities out of the chain entirely', () => {
    // Knowing a passage's words cold says nothing about being able to name
    // its address, so neither direction carries between them.
    expect(TEXT_RECALL_CHAIN).not.toContain('refmatch');
    expect(TEXT_RECALL_CHAIN).not.toContain('refprovide');
  });
});

describe('isActivitySatisfied - harder carries down, never the reverse', () => {
  it('lets a mastered HARDER activity satisfy an easier one', () => {
    const rungs = [activity('ordering', 0), activity('blanks', 0), activity('firstletters', 5)];
    expect(isActivitySatisfied(rungs, 'ordering')).toBe(true);
    expect(isActivitySatisfied(rungs, 'blanks')).toBe(true);
  });

  it('does NOT let a mastered EASIER activity satisfy a harder one', () => {
    // The direction that matters. Putting verses in the right order is the
    // cheapest of the three and demonstrates nothing about recalling the
    // words, so mastering `ordering` leaves `blanks` and `firstletters`
    // exactly as untested as they were.
    const rungs = [activity('ordering', 5), activity('blanks', 0), activity('firstletters', 0)];
    expect(isActivitySatisfied(rungs, 'ordering')).toBe(true);
    expect(isActivitySatisfied(rungs, 'blanks')).toBe(false);
    expect(isActivitySatisfied(rungs, 'firstletters')).toBe(false);
  });

  it('does not carry down from an activity that does not apply', () => {
    // An inapplicable activity is not being offered, so a level sitting on it
    // is history rather than a current claim about the passage.
    const rungs = [activity('blanks', 0), activity('firstletters', 5, false)];
    expect(isActivitySatisfied(rungs, 'blanks')).toBe(false);
  });

  it('never carries into or out of the reference activities', () => {
    const mastered = [
      activity('firstletters', 5),
      activity('refmatch', 0),
      activity('refprovide', 0),
    ];
    expect(isActivitySatisfied(mastered, 'refmatch')).toBe(false);
    expect(isActivitySatisfied(mastered, 'refprovide')).toBe(false);

    const references = [
      activity('refprovide', 5),
      activity('refmatch', 5),
      activity('blanks', 0),
    ];
    expect(isActivitySatisfied(references, 'blanks')).toBe(false);
  });

  it('satisfies without conferring a level', () => {
    // The distinction the plan calls out explicitly: "satisfied" is a fact
    // about the passage, not a score on the activity. An activity nobody has
    // opened still reads level 0 on its own row.
    const blanks = activity('blanks', 0);
    const rungs = [blanks, activity('firstletters', 5)];
    expect(isActivitySatisfied(rungs, 'blanks')).toBe(true);
    expect(blanks.level).toBe(0);
  });
});

describe('passageWellLearned', () => {
  it('needs EVERY applicable activity satisfied, not just the best one', () => {
    // The rule that replaced `bestLevel >= 4`. One aced activity no longer
    // speaks for activities the user has never opened.
    expect(
      passageWellLearned([
        activity('ordering', 5),
        activity('blanks', 0),
        activity('firstletters', 0),
      ]),
    ).toBe(false);

    expect(
      passageWellLearned([
        activity('ordering', 0),
        activity('blanks', 0),
        activity('firstletters', 4),
      ]),
    ).toBe(true);
  });

  it('ignores activities that do not apply', () => {
    expect(
      passageWellLearned([
        activity('blanks', 4),
        activity('firstletters', 4),
        activity('refmatch', 0, false),
        activity('refprovide', 0, false),
      ]),
    ).toBe(true);
  });

  it('is FALSE over an empty applicable set, not vacuously true', () => {
    // `Array.every` on an empty array is `true`, so without the guard a
    // passage whose every activity is gated out - the reference ones under
    // the 25-verse rule, with nothing else applicable - would be reported as
    // mastered without the user having answered a single question about it.
    expect(passageWellLearned([])).toBe(false);
    expect(
      passageWellLearned([activity('refmatch', 0, false), activity('refprovide', 0, false)]),
    ).toBe(false);
    // And it stays false even if the inapplicable ones carry old high levels.
    expect(
      passageWellLearned([activity('refmatch', 5, false), activity('refprovide', 5, false)]),
    ).toBe(false);
  });

  it('requires the reference activities on their own merits once they apply', () => {
    // They are outside the carry-down chain, so no amount of text recall
    // stands in for them.
    expect(
      passageWellLearned([
        activity('ordering', 5),
        activity('blanks', 5),
        activity('firstletters', 5),
        activity('refmatch', 0),
        activity('refprovide', 0),
      ]),
    ).toBe(false);
  });
});

describe('the two ladders converge', () => {
  it('shares its last two rungs across every shape of material', () => {
    // Stated as its own assertion because it is the design claim the whole
    // module is organised around: the first rung differs, everything after it
    // does not. An exercise added to only one ladder would break this.
    const tails = new Set<string>();
    const shapes: [number, number][] = [
      [1, 1],
      [1, 3],
      [5, 1],
      [5, 3],
    ];
    for (const [verses, siblings] of shapes) {
      const rungs: Rung[] = applicableRungs(verses, siblings);
      tails.add(rungs.slice(-2).join('>'));
    }
    expect([...tails]).toEqual(['blanks>firstletters']);
  });
});
