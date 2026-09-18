/**
 * The fixed page geometries.
 *
 * Almost nothing here asserts a particular number of columns or rows. The
 * geometries are provisional and want a real terminal before they are settled,
 * so tests written against them would have to be rewritten the moment they are
 * — and would have been testing the guess rather than the arithmetic. What is
 * asserted instead are the properties that must hold whatever the numbers
 * become: that every preset can fit *some* window, that `requiredSize` is the
 * exact boundary `fits` agrees with, that the list is ordered so walking it for
 * the largest fit is meaningful, and that there is always an answer.
 */
import { describe, expect, test } from 'bun:test';

import {
  fits,
  largestFitting,
  pageWidth,
  presetByName,
  PRESETS,
  requiredSize,
  type ReadingPreset,
} from './presets';
import { bodyMetrics, CHROME_ROWS, MARGIN, MAX_TEXT_WIDTH } from './frame';

/** The size `raw.ts` falls back to when the terminal reports none. */
const HISTORICAL = { columns: 80, rows: 24 } as const;

describe('the preset list', () => {
  test('names are unique, since a name is how one is asked for', () => {
    const names = PRESETS.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('no preset is wider than the body the frame will ever give it', () => {
    // A preset wider than the cap fits no window at all, however wide.
    for (const preset of PRESETS) {
      expect(pageWidth(preset)).toBeLessThanOrEqual(MAX_TEXT_WIDTH);
    }
  });

  test('every preset has a gutter unless it has nothing to separate', () => {
    for (const preset of PRESETS) {
      if (preset.columns > 1) expect(preset.gutter).toBeGreaterThan(0);
      else expect(preset.gutter).toBe(0);
    }
  });

  test('is ordered from the most demanding window to the least', () => {
    // `largestFitting` takes the first that fits, which only means anything if
    // each entry needs at least as large a window as the one after it.
    for (let i = 1; i < PRESETS.length; i += 1) {
      const larger = requiredSize(PRESETS[i - 1]!);
      const smaller = requiredSize(PRESETS[i]!);
      expect(larger.columns).toBeGreaterThanOrEqual(smaller.columns);
      expect(larger.rows).toBeGreaterThanOrEqual(smaller.rows);
    }
  });
});

describe('requiredSize', () => {
  test('spends exactly the frame margins and the frame chrome', () => {
    for (const preset of PRESETS) {
      const required = requiredSize(preset);
      expect(required.columns - pageWidth(preset)).toBe(MARGIN * 2);
      expect(required.rows - preset.rows).toBe(CHROME_ROWS);
    }
  });

  test('leaves a body of exactly the page, no more and no less', () => {
    for (const preset of PRESETS) {
      const body = bodyMetrics(requiredSize(preset));
      expect(body.width).toBe(pageWidth(preset));
      expect(body.height).toBe(preset.rows);
    }
  });

  test('is the boundary: one column or one row smaller does not fit', () => {
    for (const preset of PRESETS) {
      const { columns, rows } = requiredSize(preset);
      expect(fits(preset, { columns, rows })).toBe(true);
      expect(fits(preset, { columns: columns - 1, rows })).toBe(false);
      expect(fits(preset, { columns, rows: rows - 1 })).toBe(false);
    }
  });

  test('a bigger window still fits — nothing is fitted to the window', () => {
    for (const preset of PRESETS) {
      const { columns, rows } = requiredSize(preset);
      expect(fits(preset, { columns: columns + 1, rows: rows + 1 })).toBe(true);
      expect(fits(preset, { columns: 500, rows: 200 })).toBe(true);
    }
  });
});

describe('fits', () => {
  test('nothing fits an absurdly small window', () => {
    // `bodyMetrics` clamps up to a 20-column, one-row floor. Every page is
    // larger than that floor, so the clamp cannot fake a fit.
    for (const size of [
      { columns: 0, rows: 0 },
      { columns: 1, rows: 1 },
      { columns: 10, rows: 5 },
      { columns: 40, rows: 10 },
      { columns: 200, rows: 4 },
      { columns: 12, rows: 200 },
    ]) {
      for (const preset of PRESETS) expect(fits(preset, size)).toBe(false);
    }
  });
});

describe('largestFitting', () => {
  test('a roomy window gets the most demanding preset', () => {
    expect(largestFitting({ columns: 300, rows: 120 })).toBe(PRESETS[0]!);
  });

  test('each preset is chosen at the window that is exactly its size', () => {
    // At its own required size, a preset is the largest that fits: everything
    // ahead of it in the list needs at least as much room, and needs strictly
    // more of at least one dimension or it would be the same geometry.
    for (const preset of PRESETS) {
      const chosen = largestFitting(requiredSize(preset));
      expect(fits(chosen, requiredSize(preset))).toBe(true);
      expect(PRESETS.indexOf(chosen)).toBeLessThanOrEqual(PRESETS.indexOf(preset));
    }
  });

  test('the smallest preset fits the window a terminal falls back to', () => {
    const chosen = largestFitting(HISTORICAL);
    expect(fits(chosen, HISTORICAL)).toBe(true);
  });

  test('a window too small for any page still gets an answer', () => {
    // Deliberate: a caller with no preset has nothing to offer and no way to
    // explain itself. It asks `fits` separately to find out it cannot draw.
    const tiny = { columns: 8, rows: 3 };
    const chosen: ReadingPreset = largestFitting(tiny);
    expect(chosen).toBe(PRESETS[PRESETS.length - 1]!);
    expect(fits(chosen, tiny)).toBe(false);
  });
});

describe('presetByName', () => {
  test('finds every preset by its own name', () => {
    for (const preset of PRESETS) expect(presetByName(preset.name)).toBe(preset);
  });

  test('is forgiving about case and stray spaces, since a name gets typed', () => {
    const first = PRESETS[0]!;
    expect(presetByName(`  ${first.name.toUpperCase()} `)).toBe(first);
  });

  test('an unknown name is undefined rather than a substitute', () => {
    expect(presetByName('7-col')).toBeUndefined();
    expect(presetByName('')).toBeUndefined();
  });
});
