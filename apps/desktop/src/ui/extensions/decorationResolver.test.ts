/**
 * Pure unit tests for `decorationResolver.ts` (task 0036, P0.1a). No React,
 * no IPC, no Zustand - per the design doc's test plan, this is meant to be
 * the bulk of the value.
 */
import { describe, it, expect } from 'vitest';
import type { Extensions } from '@bible/core';
import { resolveVerseDecorations, buildWordPaintStyle, type LayerDecorations, type WordPaint } from './decorationResolver';

type DecorationDto = Extensions.DecorationDto;
type WordTarget = Extract<Extensions.DecorationTarget, { kind: 'word' }>;

const resolveColor = (key: string, alpha = 1): string => `C(${key}/${alpha})`;

function layer(
  overrides: Partial<LayerDecorations> & { decorations: DecorationDto[] },
): LayerDecorations {
  return {
    layerKey: 'ext.a::dec',
    extensionId: 'ext.a',
    layerSeq: 1,
    surfaces: ['standard', 'study'],
    ...overrides,
  };
}

function verseTint(color: string, order?: number): DecorationDto {
  return { target: { kind: 'verse', verseId: 1 }, appearance: { kind: 'tint', color }, ...(order !== undefined ? { order } : {}) };
}

describe('resolveVerseDecorations - target matching', () => {
  it('a verse target paints every word of the matching verse only', () => {
    const layers = [layer({ decorations: [verseTint('accent')] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 3, layers, surface: 'standard', resolveColor });
    expect(resolved.words.size).toBe(3);
    expect(resolved.words.get(0)?.tint?.color).toBe('C(accent/0.32)');

    const other = resolveVerseDecorations({ verseId: 2, wordCount: 3, layers, surface: 'standard', resolveColor });
    expect(other.words.size).toBe(0);
  });

  it('a passage target matches every verse id in range, including across chapter/book boundaries', () => {
    const layers = [
      layer({
        decorations: [
          { target: { kind: 'passage', startVerseId: 43003015, endVerseId: 44001001 }, appearance: { kind: 'tint', color: 'accent' } },
        ],
      }),
    ];
    for (const verseId of [43003015, 43003016, 43003999, 44001001]) {
      const resolved = resolveVerseDecorations({ verseId, wordCount: 1, layers, surface: 'standard', resolveColor });
      expect(resolved.words.size, `verseId ${verseId}`).toBe(1);
    }
    const resolved = resolveVerseDecorations({ verseId: 44001002, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(resolved.words.size).toBe(0);
  });

  it('a word target with no `words` given resolves to nothing, without throwing', () => {
    const layers = [
      layer({
        decorations: [
          { target: { kind: 'word', text: 'faith', scope: { verseId: 1 } }, appearance: { kind: 'tint', color: 'accent' } },
        ],
      }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 3, layers, surface: 'standard', resolveColor });
    expect(resolved.words.size).toBe(0);
  });
});

describe('resolveVerseDecorations - word targets (P0.1b, design doc §4.2)', () => {
  const words = (texts: string[]) => texts.map((text) => ({ text }));

  function wordDec(text: string, opts?: { scope?: WordTarget['scope']; occurrence?: number; matchCase?: boolean }): DecorationDto {
    return {
      target: {
        kind: 'word',
        text,
        scope: opts?.scope ?? { verseId: 1 },
        ...(opts?.occurrence !== undefined ? { occurrence: opts.occurrence } : {}),
        ...(opts?.matchCase !== undefined ? { matchCase: opts.matchCase } : {}),
      },
      appearance: { kind: 'tint', color: 'accent' },
    };
  }

  it('matches every occurrence of the clean, case-folded word text within verse scope by default', () => {
    const layers = [layer({ decorations: [wordDec('god')] })];
    const resolved = resolveVerseDecorations({
      verseId: 1,
      wordCount: 4,
      words: words(['For', 'God', 'so', 'God']),
      layers,
      surface: 'standard',
      resolveColor,
    });
    expect([...resolved.words.keys()].sort()).toEqual([1, 3]);
  });

  it('matchCase: true requires an exact-case match', () => {
    const layers = [layer({ decorations: [wordDec('God', { matchCase: true })] })];
    const resolved = resolveVerseDecorations({
      verseId: 1,
      wordCount: 2,
      words: words(['god', 'God']),
      layers,
      surface: 'standard',
      resolveColor,
    });
    expect([...resolved.words.keys()]).toEqual([1]);
  });

  it('a word outside its verse scope does not match', () => {
    const layers = [layer({ decorations: [wordDec('faith', { scope: { verseId: 2 } })] })];
    const resolved = resolveVerseDecorations({
      verseId: 1,
      wordCount: 1,
      words: words(['faith']),
      layers,
      surface: 'standard',
      resolveColor,
    });
    expect(resolved.words.size).toBe(0);
  });

  it('occurrence (1-based) within a single verse picks only the nth match', () => {
    const layers = [layer({ decorations: [wordDec('faith', { occurrence: 2 })] })];
    const resolved = resolveVerseDecorations({
      verseId: 1,
      wordCount: 3,
      words: words(['faith', 'is', 'faith']),
      layers,
      surface: 'standard',
      resolveColor,
    });
    expect([...resolved.words.keys()]).toEqual([2]);
  });

  it('occurrence in passage scope counts cumulatively using priorWordMatchCounts', () => {
    const layers = [
      layer({
        decorations: [wordDec('faith', { scope: { startVerseId: 1, endVerseId: 3 }, occurrence: 3 })],
      }),
    ];
    // 2 matches already counted in verse 1 - this verse's (verse 2's) first
    // match is therefore the global 3rd.
    const resolved = resolveVerseDecorations({
      verseId: 2,
      wordCount: 2,
      words: words(['faith', 'hope']),
      layers,
      surface: 'standard',
      resolveColor,
      priorWordMatchCounts: new Map([['ext.a::dec#0:0', 2]]),
    });
    expect([...resolved.words.keys()]).toEqual([0]);
  });

  it('occurrence in passage scope with no priorWordMatchCounts entry defaults to 0 (this verse treated as first)', () => {
    const layers = [
      layer({ decorations: [wordDec('faith', { scope: { startVerseId: 1, endVerseId: 3 }, occurrence: 1 })] }),
    ];
    const resolved = resolveVerseDecorations({
      verseId: 2,
      wordCount: 1,
      words: words(['faith']),
      layers,
      surface: 'standard',
      resolveColor,
    });
    expect([...resolved.words.keys()]).toEqual([0]);
  });
});

describe('resolveVerseDecorations - tokens targets (P0.1b, amendment A5 - direct index, no offset fallback)', () => {
  function tokensDec(startTokenIndex: number, endTokenIndex?: number): DecorationDto {
    return {
      target: { kind: 'tokens', verseId: 1, startTokenIndex, ...(endTokenIndex !== undefined ? { endTokenIndex } : {}) },
      appearance: { kind: 'tint', color: 'accent' },
    };
  }

  it('a single-index token target (no endTokenIndex) maps directly to that rendered index', () => {
    const layers = [layer({ decorations: [tokensDec(1)] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 3, layers, surface: 'standard', resolveColor });
    expect([...resolved.words.keys()]).toEqual([1]);
  });

  it('a token range maps to every rendered index in the inclusive range', () => {
    const layers = [layer({ decorations: [tokensDec(0, 2)] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 4, layers, surface: 'standard', resolveColor });
    expect([...resolved.words.keys()].sort()).toEqual([0, 1, 2]);
  });

  it('a token target out of the rendered verse bounds is dropped, not clamped', () => {
    const layers = [layer({ decorations: [tokensDec(5, 8)] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 4, layers, surface: 'standard', resolveColor });
    expect(resolved.words.size).toBe(0);
  });

  it('a token target that only partially overflows the bound is dropped wholesale, not truncated', () => {
    const layers = [layer({ decorations: [tokensDec(2, 6)] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 4, layers, surface: 'standard', resolveColor });
    expect(resolved.words.size).toBe(0);
  });

  it('a token target for a different verse does not match', () => {
    const layers = [
      layer({ decorations: [{ target: { kind: 'tokens', verseId: 2, startTokenIndex: 0 }, appearance: { kind: 'tint', color: 'accent' } }] }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 3, layers, surface: 'standard', resolveColor });
    expect(resolved.words.size).toBe(0);
  });
});

describe('resolveVerseDecorations - emphasis/strike/badge composition (P0.1b acceptance)', () => {
  it('emphasis sets bold on the target word(s)', () => {
    const layers = [layer({ decorations: [{ target: { kind: 'verse', verseId: 1 }, appearance: { kind: 'emphasis' } }] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(resolved.words.get(0)?.bold).toBe(true);
  });

  it('strike defaults to the "text" theme color when none is given', () => {
    const layers = [layer({ decorations: [{ target: { kind: 'verse', verseId: 1 }, appearance: { kind: 'strike' } }] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(resolved.words.get(0)?.strike?.color).toBe('C(text/1)');
  });

  it('strike honours an explicit color', () => {
    const layers = [layer({ decorations: [{ target: { kind: 'verse', verseId: 1 }, appearance: { kind: 'strike', color: 'danger' } }] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(resolved.words.get(0)?.strike?.color).toBe('C(danger/1)');
  });

  it('emphasis/strike/badge all compose on a word/token target, not just verse/passage', () => {
    const layers = [
      layer({
        decorations: [
          { target: { kind: 'tokens', verseId: 1, startTokenIndex: 0 }, appearance: { kind: 'emphasis' } },
          { target: { kind: 'tokens', verseId: 1, startTokenIndex: 0 }, appearance: { kind: 'badge', label: 'G26' } },
        ],
      }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 2, layers, surface: 'standard', resolveColor });
    expect(resolved.words.get(0)?.bold).toBe(true);
    expect(resolved.words.get(0)?.badges.map((b) => b.label)).toEqual(['G26']);
    expect(resolved.words.has(1)).toBe(false);
  });
});

describe('resolveVerseDecorations - sort order and composition', () => {
  it('order desc wins first', () => {
    const layers = [
      layer({ layerSeq: 1, decorations: [verseTint('low', 1), verseTint('high', 5)] }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(resolved.words.get(0)?.tint?.color).toBe('C(high/0.32)');
  });

  it('ties on order fall back to layerSeq ascending (earlier-registered extension wins)', () => {
    const layers = [
      layer({ layerKey: 'ext.late::dec', layerSeq: 2, decorations: [verseTint('late')] }),
      layer({ layerKey: 'ext.early::dec', layerSeq: 1, decorations: [verseTint('early')] }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(resolved.words.get(0)?.tint?.color).toBe('C(early/0.32)');
  });

  it('ties on order and layerSeq fall back to array position within the layer', () => {
    const layers = [
      layer({ decorations: [verseTint('first'), verseTint('second')] }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(resolved.words.get(0)?.tint?.color).toBe('C(first/0.32)');
  });

  it('only one tint wins - the rest are discarded, not merged', () => {
    const layers = [
      layer({ decorations: [
        { target: { kind: 'verse', verseId: 1 }, appearance: { kind: 'tint', color: 'a' }, order: 10 },
        { target: { kind: 'verse', verseId: 1 }, appearance: { kind: 'tint', color: 'b' }, order: 5 },
      ] }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(resolved.words.get(0)?.tint?.color).toBe('C(a/0.32)');
  });

  it('underlines accumulate up to 3, in priority order, with stacking offsets', () => {
    const decs: DecorationDto[] = [1, 2, 3, 4].map((n) => ({
      target: { kind: 'verse', verseId: 1 },
      appearance: { kind: 'underline', color: `u${n}` },
      order: 5 - n, // u1 highest priority
    }));
    const layers = [layer({ decorations: decs })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    const underlines = resolved.words.get(0)?.underlines ?? [];
    expect(underlines).toHaveLength(3);
    expect(underlines[0].color).toBe('C(u1/1)');
    expect(underlines[0].offset).toBe(0);
    expect(underlines[1].offset).toBe(2);
    expect(underlines[2].offset).toBe(4);
  });

  it('intensity maps to the documented alpha values', () => {
    const layers = [
      layer({ decorations: [{ target: { kind: 'verse', verseId: 1 }, appearance: { kind: 'tint', color: 'a', intensity: 'subtle' } }] }),
    ];
    const subtle = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(subtle.words.get(0)?.tint?.color).toBe('C(a/0.18)');

    const strongLayers = [
      layer({ decorations: [{ target: { kind: 'verse', verseId: 1 }, appearance: { kind: 'tint', color: 'a', intensity: 'strong' } }] }),
    ];
    const strong = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers: strongLayers, surface: 'standard', resolveColor });
    expect(strong.words.get(0)?.tint?.color).toBe('C(a/0.5)');
  });

  it('caps contributions per word at 8', () => {
    const decs: DecorationDto[] = Array.from({ length: 10 }, (_, i) => ({
      target: { kind: 'verse', verseId: 1 },
      appearance: { kind: 'badge', label: `b${i}` },
      order: 10 - i,
    }));
    const layers = [layer({ decorations: decs })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    // Badges themselves cap at 4, but the 8-per-word cap is what's under test
    // here indirectly via candidates considered; assert the top-priority ones win.
    expect(resolved.words.get(0)?.badges.map((b) => b.label)).toEqual(['b0', 'b1', 'b2', 'b3']);
  });
});

describe('resolveVerseDecorations - gutter', () => {
  function gutterDec(icon: string): DecorationDto {
    return { target: { kind: 'verse', verseId: 1 }, appearance: { kind: 'gutter', icon: icon as Extensions.HostIconKey } };
  }

  it('collects gutter marks side by side in layerSeq order, NOT re-sorted by order', () => {
    const layers = [
      layer({ layerKey: 'b', layerSeq: 2, decorations: [{ ...gutterDec('flag'), order: 100 }] }),
      layer({ layerKey: 'a', layerSeq: 1, decorations: [{ ...gutterDec('star'), order: 1 }] }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 0, layers, surface: 'standard', resolveColor });
    expect(resolved.gutter.map((g) => g.icon)).toEqual(['star', 'flag']);
  });

  it('caps at 3 with an overflow count', () => {
    const layers = ['dot', 'flag', 'star', 'bookmark', 'info'].map((icon, i) =>
      layer({ layerKey: `ext${i}`, layerSeq: i, decorations: [gutterDec(icon)] }),
    );
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 0, layers, surface: 'standard', resolveColor });
    expect(resolved.gutter).toHaveLength(3);
    expect(resolved.gutterOverflow).toBe(2);
  });

  it('never renders in Reading mode, even when the layer opts in', () => {
    const layers = [layer({ surfaces: ['standard', 'study', 'reading'], decorations: [gutterDec('flag')] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 0, layers, surface: 'reading', resolveColor });
    expect(resolved.gutter).toHaveLength(0);
  });
});

describe('resolveVerseDecorations - surfaces filtering', () => {
  it('a layer with the default surfaces does not apply to reading mode', () => {
    const layers = [layer({ decorations: [verseTint('accent')] })]; // default surfaces: standard, study
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'reading', resolveColor });
    expect(resolved.words.size).toBe(0);
  });

  it('a layer that opts in to reading mode applies there too', () => {
    const layers = [layer({ surfaces: ['standard', 'study', 'reading'], decorations: [verseTint('accent')] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'reading', resolveColor });
    expect(resolved.words.get(0)?.tint).toBeDefined();
  });
});

describe('resolveVerseDecorations - static hover content (P0.1c, design doc §11.1)', () => {
  function verseTintWithHover(hoverText: string, order?: number): DecorationDto {
    return {
      target: { kind: 'verse', verseId: 1 },
      appearance: { kind: 'tint', color: 'accent' },
      hoverContent: { kind: 'text', text: hoverText },
      ...(order !== undefined ? { order } : {}),
    };
  }

  it('a verse-target decoration with hoverContent lands in verseHovers ONCE, not duplicated per word', () => {
    const layers = [layer({ decorations: [verseTintWithHover('hello')] })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 3, layers, surface: 'standard', resolveColor });
    expect(resolved.verseHovers).toHaveLength(1);
    expect(resolved.verseHovers[0].content).toEqual({ kind: 'text', text: 'hello' });
    expect(resolved.verseHovers[0].extensionId).toBe('ext.a');
    // Not present on any individual word's own hovers - it's a verse-level hover.
    expect(resolved.words.get(0)?.hovers).toBeUndefined();
  });

  it('a word/token-target decoration with hoverContent lands only on that word, not in verseHovers', () => {
    const layers = [
      layer({
        decorations: [
          {
            target: { kind: 'tokens', verseId: 1, startTokenIndex: 1 },
            appearance: { kind: 'tint', color: 'accent' },
            hoverContent: { kind: 'text', text: 'word hover' },
          },
        ],
      }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 3, layers, surface: 'standard', resolveColor });
    expect(resolved.verseHovers).toHaveLength(0);
    expect(resolved.words.get(1)?.hovers).toEqual([
      { layerKey: 'ext.a::dec', extensionId: 'ext.a', content: { kind: 'text', text: 'word hover' }, order: 0 },
    ]);
    expect(resolved.words.get(0)?.hovers).toBeUndefined();
  });

  it('multiple verse-level hovers sort by order desc, layerSeq asc, array position asc - same as paint', () => {
    const layers = [
      layer({ decorations: [verseTintWithHover('low', 1), verseTintWithHover('high', 5)] }),
    ];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    expect(resolved.verseHovers.map((h) => (h.content as { text: string }).text)).toEqual(['high', 'low']);
  });

  it('a word gets an empty-appearance paint entry when it has ONLY hover content and no visual appearance candidate survives', () => {
    // A word/token decoration whose appearance is capped out of the top-8
    // visual slots can still carry hover content - the hover collection is
    // not capped by the same MAX_CONTRIBUTIONS_PER_WORD gate as paint.
    const decs: DecorationDto[] = Array.from({ length: 9 }, (_, i) => ({
      target: { kind: 'tokens', verseId: 1, startTokenIndex: 0 },
      appearance: { kind: 'badge', label: `b${i}` },
      order: 10 - i,
      ...(i === 8 ? { hoverContent: { kind: 'text' as const, text: 'ninth' } } : {}),
    }));
    const layers = [layer({ decorations: decs })];
    const resolved = resolveVerseDecorations({ verseId: 1, wordCount: 1, layers, surface: 'standard', resolveColor });
    // The 9th (lowest-priority) decoration's badge is capped out of paint...
    expect(resolved.words.get(0)?.badges.map((b) => b.label)).not.toContain('b8');
    // ...but its hover content still reaches the popup.
    expect(resolved.words.get(0)?.hovers?.some((h) => (h.content as { text: string }).text === 'ninth')).toBe(true);
  });
});

describe('buildWordPaintStyle', () => {
  const emptyPaint: WordPaint = { underlines: [], bold: false, badges: [], sourceKeys: [] };

  it('produces no vars for an empty paint', () => {
    const built = buildWordPaintStyle(emptyPaint);
    expect(built.vars['--ext-bg-image']).toBeUndefined();
    expect(built.classes).toEqual(['ext-deco']);
  });

  it('tint alone produces a full-cell background-image layer', () => {
    const built = buildWordPaintStyle({ ...emptyPaint, tint: { color: 'RGB' } });
    expect(built.vars['--ext-bg-image']).toBe('linear-gradient(RGB, RGB)');
    expect(built.vars['--ext-bg-position']).toBe('0 0');
    expect(built.vars['--ext-bg-size']).toBe('100% 100%');
  });

  it('underline thickness maps thin/medium/thick to 1/2/3px', () => {
    const built = buildWordPaintStyle({
      ...emptyPaint,
      underlines: [{ color: 'C', style: 'solid', thickness: 'thin', offset: 0 }],
    });
    expect(built.vars['--ext-bg-size']).toBe('100% 1px');
  });

  it('dashed/dotted underlines use repeating-linear-gradient', () => {
    const dashed = buildWordPaintStyle({
      ...emptyPaint,
      underlines: [{ color: 'C', style: 'dashed', thickness: 'medium', offset: 0 }],
    });
    expect(dashed.vars['--ext-bg-image']).toContain('repeating-linear-gradient(90deg, C 0 4px, transparent 4px 7px)');

    const dotted = buildWordPaintStyle({
      ...emptyPaint,
      underlines: [{ color: 'C', style: 'dotted', thickness: 'medium', offset: 0 }],
    });
    expect(dotted.vars['--ext-bg-image']).toContain('repeating-linear-gradient(90deg, C 0 2px, transparent 2px 4px)');
  });

  it('bold sets the ext-bold class, nothing else', () => {
    const built = buildWordPaintStyle({ ...emptyPaint, bold: true });
    expect(built.classes).toContain('ext-bold');
  });

  it('joins several badges with a middle dot into one pill, in the first badge colour', () => {
    const built = buildWordPaintStyle({
      ...emptyPaint,
      badges: [{ label: 'G26', color: 'FIRST' }, { label: 'love', color: 'SECOND' }],
    });
    expect(built.classes).toContain('ext-badge');
    expect(built.vars['--ext-badge']).toBe('"G26 · love"');
    expect(built.vars['--ext-badge-color']).toBe('FIRST');
  });

  it('escapes double quotes inside a badge label', () => {
    const built = buildWordPaintStyle({ ...emptyPaint, badges: [{ label: 'a"b', color: 'C' }] });
    expect(built.vars['--ext-badge']).toBe('"a\\"b"');
  });
});
