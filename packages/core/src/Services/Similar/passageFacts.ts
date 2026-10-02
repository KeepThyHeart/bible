/**
 * Similar passages (task 0070): gather the facts `explainMatch` compares, through readers
 * injected by each app (desktop repositories, web providers). Pure orchestration.
 */

import type { PassageFacts, PassageRange } from './SimilarTypes';

/** One interlinear word as the readers report it (flatten the app's own rows to this). */
export interface InterlinearFact {
  /** Strong's number such as "G25" or "H1254"; rows without one are skipped. */
  strongs: string | null | undefined;
  lemma?: string;
  gloss?: string;
}

/** One topic tied to the passage. */
export interface TopicFact {
  label: string;
  source: 'naves' | 'torrey' | 'tag';
}

export interface PassageFactsDeps {
  /** Language of the text returned by `text` (e.g. 'en'). */
  language: string;
  /** Passage text; HTML is stripped. */
  text(r: PassageRange): string | Promise<string>;
  interlinear?(r: PassageRange): InterlinearFact[] | Promise<InterlinearFact[]>;
  topics?(r: PassageRange): TopicFact[] | Promise<TopicFact[]>;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Strip HTML tags (block-level tags become spaces) and decode the common entities. */
export function stripFactsHtml(html: string): string {
  return html
    .replace(/<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|blockquote)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export async function gatherPassageFacts(r: PassageRange, deps: PassageFactsDeps): Promise<PassageFacts> {
  const [rawText, words, topics] = await Promise.all([
    deps.text(r),
    deps.interlinear ? deps.interlinear(r) : [],
    deps.topics ? deps.topics(r) : [],
  ]);

  const strongs: PassageFacts['strongs'] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const id = w.strongs?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    strongs.push({
      strongs: id,
      ...(w.lemma ? { lemma: w.lemma } : {}),
      ...(w.gloss ? { gloss: w.gloss } : {}),
    });
  }

  const seenT = new Set<string>();
  const outTopics: PassageFacts['topics'] = [];
  for (const t of topics) {
    const key = `${t.source}|${t.label.toLowerCase()}`;
    if (!t.label || seenT.has(key)) continue;
    seenT.add(key);
    outTopics.push({ label: t.label, source: t.source });
  }

  return {
    range: { startVerseId: r.startVerseId, endVerseId: r.endVerseId },
    language: deps.language,
    text: stripFactsHtml(rawText ?? ''),
    strongs,
    topics: outTopics,
  };
}
