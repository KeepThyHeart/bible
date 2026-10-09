import type { SpeechBias } from '@bible/core/speech';

/** Bias phrases de-duplicated (case-insensitive), in the order given, joined with ', '. The token cap is applied in the worker. */
export function promptFor(bias?: SpeechBias): string {
  if (!bias || bias.level === 'none' || !bias.phrases?.length) return '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of bias.phrases) {
    const p = raw.trim();
    const k = p.toLowerCase();
    if (!p || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out.join(', ');
}
