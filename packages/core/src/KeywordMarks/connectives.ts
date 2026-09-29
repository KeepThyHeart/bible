/**
 * Connective lexicon: per category, the surface forms per language and the
 * Greek/Hebrew Strong's numbers that anchor them. Anchors are draft data
 * (task 0065 C3): with interlinear rows a surface hit only counts when it is
 * aligned to an anchor, which removes "for" the preposition.
 */
import type { ConnectiveCategory, MarkColorKey, MarkSymbol } from './types';

export interface ConnectiveEntry {
  /** Surface forms by primary language subtag. Multi-word forms are phrases. */
  forms: Record<string, string[]>;
  /** Strong's numbers (normalized, no leading zeros). */
  anchors: string[];
  symbol: MarkSymbol;
  color: MarkColorKey;
  labels: Record<string, string>;
}

export const CONNECTIVE_LEXICON: Record<ConnectiveCategory, ConnectiveEntry> = {
  inference: {
    forms: {
      en: ['therefore', 'wherefore', 'so then', 'thus', 'accordingly', 'hence'],
      es: ['por tanto', 'por lo tanto', 'así que', 'por consiguiente', 'de modo que'],
    },
    anchors: ['G3767', 'G1352', 'G686', 'G5620', 'G5106', 'H3651'],
    symbol: '∴', color: 'mark.1',
    labels: { en: 'Inference', es: 'Inferencia' },
  },
  reason: {
    forms: {
      en: ['for', 'because', 'since', 'seeing'],
      es: ['porque', 'pues', 'ya que', 'puesto que'],
    },
    anchors: ['G1063', 'G3754', 'G1360', 'G1893', 'H3588', 'H3282'],
    symbol: '∵', color: 'mark.2',
    labels: { en: 'Reason', es: 'Razón' },
  },
  contrast: {
    forms: {
      en: ['but', 'yet', 'however', 'nevertheless', 'notwithstanding', 'howbeit'],
      es: ['pero', 'mas', 'sino', 'sin embargo', 'no obstante'],
    },
    anchors: ['G1161', 'G235', 'G4133', 'G3305', 'H61', 'H389'],
    symbol: '⇄', color: 'mark.3',
    labels: { en: 'Contrast', es: 'Contraste' },
  },
  purpose: {
    forms: {
      en: ['so that', 'in order that', 'in order to', 'lest'],
      es: ['para que', 'a fin de que', 'a fin de', 'no sea que'],
    },
    anchors: ['G2443', 'G3704', 'H4616'],
    symbol: '→', color: 'mark.4',
    labels: { en: 'Purpose', es: 'Propósito' },
  },
  condition: {
    forms: {
      en: ['if', 'unless', 'except', 'provided'],
      es: ['si', 'a menos que', 'excepto'],
    },
    anchors: ['G1487', 'G1437', 'G3361', 'H518'],
    symbol: '?', color: 'mark.5',
    labels: { en: 'Condition', es: 'Condición' },
  },
  comparison: {
    forms: {
      en: ['as', 'just as', 'likewise', 'even so', 'so also', 'like'],
      es: ['como', 'así como', 'asimismo', 'de la misma manera'],
    },
    anchors: ['G5613', 'G2531', 'G3668', 'G3779', 'H834'],
    symbol: '■', color: 'mark.6',
    labels: { en: 'Comparison', es: 'Comparación' },
  },
  time: {
    forms: {
      en: ['when', 'then', 'after', 'until', 'while', 'before'],
      es: ['cuando', 'entonces', 'después', 'hasta que', 'mientras', 'antes'],
    },
    anchors: ['G3753', 'G5119', 'G2193', 'G3752', 'G3326', 'H227'],
    symbol: '●', color: 'mark.7',
    labels: { en: 'Time', es: 'Tiempo' },
  },
};

/** Primary language subtag, lower-cased ("en-US" -> "en"). */
export function primaryLanguage(tag: string): string {
  return (tag || '').split(/[-_]/)[0].toLowerCase();
}

/** Languages for which a connective lexicon exists. */
export function connectiveLanguages(): string[] {
  return ['en', 'es'];
}

export function connectiveForms(category: ConnectiveCategory, language: string): string[] {
  return CONNECTIVE_LEXICON[category]?.forms[primaryLanguage(language)] ?? [];
}

/** Normalize "strong:G02316a", "g2316" -> "G2316". Returns all numbers found. */
export function normalizeStrongs(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const re = /([GH])\s*0*(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out.push(`${m[1].toUpperCase()}${m[2]}`);
  return out;
}
