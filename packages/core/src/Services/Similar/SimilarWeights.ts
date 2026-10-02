/**
 * Configurable ranking weights for similar passages (task 0070).
 *
 * One JSON-serialisable object drives both live ranking and the neighbour table
 * builder (which records it, and its hash, in the table's meta). It lets the
 * human weigh the embeddings of the raw verse text against the LLM-written
 * explanation rows while testing, without code changes.
 */

import type { SemanticLevel } from '../SemanticSearchService';

/** text = raw verse/passage text embedding; explanation = LLM-written description; facet = terse sub-facet phrase. */
export type SimilarRowKind = 'text' | 'explanation' | 'facet';

/** `idPattern` is a RegExp source; the first matching rule wins; no match means 'explanation'. */
export interface SimilarKindRule {
  kind: SimilarRowKind;
  idPattern: string;
}

export interface SimilarWeights {
  schema: 1;
  kindRules: SimilarKindRule[];
  /** Weight of same-channel pairs. 0 disables a channel. */
  channels: { text: number; meaning: number };
  /** Weight of text<->meaning pairs. Default 0 (off). */
  crossChannel: number;
  /** Multiplies any pair that involves a facet row. */
  facetDamping: number;
  combine: 'max' | 'blend';
  maxQueryVectors: number;
  perQueryTopK: number;
  /** Additive score bias per level. */
  levelBias: Record<SemanticLevel, number>;
}

export const DEFAULT_SIMILAR_WEIGHTS: SimilarWeights = {
  schema: 1,
  kindRules: [{ kind: 'facet', idPattern: '_s\\d+$' }],
  channels: { text: 1, meaning: 1 },
  crossChannel: 0,
  facetDamping: 0.92,
  combine: 'max',
  maxQueryVectors: 12,
  perQueryTopK: 200,
  levelBias: { verse: 0, paragraph: 0, chapter: 0 },
};

const KINDS: readonly SimilarRowKind[] = ['text', 'explanation', 'facet'];
const LEVELS: readonly SemanticLevel[] = ['verse', 'paragraph', 'chapter'];
const TOP_KEYS = new Set([
  'schema', 'kindRules', 'channels', 'crossChannel', 'facetDamping', 'combine',
  'maxQueryVectors', 'perQueryTopK', 'levelBias',
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isWeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}
function warn(msg: string): void {
  console.warn(`[similar] weights: ${msg}`);
}

function cloneDefaults(): SimilarWeights {
  return {
    ...DEFAULT_SIMILAR_WEIGHTS,
    kindRules: DEFAULT_SIMILAR_WEIGHTS.kindRules.map((r) => ({ ...r })),
    channels: { ...DEFAULT_SIMILAR_WEIGHTS.channels },
    levelBias: { ...DEFAULT_SIMILAR_WEIGHTS.levelBias },
  };
}

/**
 * Deep-merge and validate an override (an object, or a JSON string); bad keys are ignored with a
 * console.warn; never throws. Rules: weights finite and >= 0 (levelBias: any finite number, it is
 * additive); `combine` max|blend; `maxQueryVectors`/`perQueryTopK` integers >= 1; `kindRules`, when
 * given, replaces the default list (invalid entries are dropped).
 */
export function resolveSimilarWeights(override?: unknown): SimilarWeights {
  const out = cloneDefaults();
  let o: unknown = override;
  if (o === undefined || o === null) return out;
  if (typeof o === 'string') {
    if (o.trim() === '') return out;
    try {
      o = JSON.parse(o);
    } catch {
      warn('override is not valid JSON; using defaults');
      return out;
    }
  }
  if (!isObject(o)) {
    warn('override is not an object; using defaults');
    return out;
  }
  for (const key of Object.keys(o)) {
    if (!TOP_KEYS.has(key)) warn(`unknown key "${key}" ignored`);
  }
  if (o.schema !== undefined && o.schema !== 1) warn('schema must be 1; ignored');

  if (o.kindRules !== undefined) {
    if (!Array.isArray(o.kindRules)) {
      warn('kindRules must be an array; ignored');
    } else {
      const rules: SimilarKindRule[] = [];
      for (const r of o.kindRules) {
        if (!isObject(r) || !KINDS.includes(r.kind as SimilarRowKind) || typeof r.idPattern !== 'string') {
          warn('invalid kindRules entry ignored');
          continue;
        }
        try {
          new RegExp(r.idPattern);
        } catch {
          warn(`kindRules pattern "${r.idPattern}" does not compile; ignored`);
          continue;
        }
        rules.push({ kind: r.kind as SimilarRowKind, idPattern: r.idPattern });
      }
      out.kindRules = rules;
    }
  }
  if (o.channels !== undefined) {
    if (!isObject(o.channels)) {
      warn('channels must be an object; ignored');
    } else {
      for (const ch of ['text', 'meaning'] as const) {
        const v = o.channels[ch];
        if (v === undefined) continue;
        if (isWeight(v)) out.channels[ch] = v;
        else warn(`channels.${ch} must be a finite number >= 0; ignored`);
      }
    }
  }
  for (const k of ['crossChannel', 'facetDamping'] as const) {
    const v = o[k];
    if (v === undefined) continue;
    if (isWeight(v)) out[k] = v;
    else warn(`${k} must be a finite number >= 0; ignored`);
  }
  if (o.combine !== undefined) {
    if (o.combine === 'max' || o.combine === 'blend') out.combine = o.combine;
    else warn('combine must be "max" or "blend"; ignored');
  }
  for (const k of ['maxQueryVectors', 'perQueryTopK'] as const) {
    const v = o[k];
    if (v === undefined) continue;
    if (isPositiveInt(v)) out[k] = v;
    else warn(`${k} must be an integer >= 1; ignored`);
  }
  if (o.levelBias !== undefined) {
    if (!isObject(o.levelBias)) {
      warn('levelBias must be an object; ignored');
    } else {
      for (const lv of LEVELS) {
        const v = o.levelBias[lv];
        if (v === undefined) continue;
        if (typeof v === 'number' && Number.isFinite(v)) out.levelBias[lv] = v;
        else warn(`levelBias.${lv} must be a finite number; ignored`);
      }
    }
  }
  return out;
}

/** First matching rule wins; no match means 'explanation'. Uncompilable rules are skipped. */
export function compileKindClassifier(w: SimilarWeights): (rowId: string) => SimilarRowKind {
  const rules: Array<{ kind: SimilarRowKind; re: RegExp }> = [];
  for (const r of w.kindRules) {
    try {
      rules.push({ kind: r.kind, re: new RegExp(r.idPattern) });
    } catch {
      warn(`kindRules pattern "${r.idPattern}" does not compile; skipped`);
    }
  }
  return (rowId: string): SimilarRowKind => {
    for (const r of rules) if (r.re.test(rowId)) return r.kind;
    return 'explanation';
  };
}

export function channelOf(kind: SimilarRowKind): 'text' | 'meaning' {
  return kind === 'text' ? 'text' : 'meaning';
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObject(v)) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Stable hash (sorted-key JSON, FNV-1a 32 bit, 8 hex digits). */
export function similarWeightsHash(w: SimilarWeights): string {
  const s = stableJson(w);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
