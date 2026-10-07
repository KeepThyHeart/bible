/**
 * Word Study Service
 *
 * Answers "everything about this word" for one installed Bible module:
 *  - a Strong's number (original-language study), from the module's
 *    `interlinear_word` tagging plus the Strong's dictionaries; or
 *  - a {@link WordGroup} (any language), by matching the module's own verse
 *    text, with per-language stemming and user-defined variants.
 *
 * Both produce the same {@link WordStudyOverview} shape so the UI is shared.
 */

import { IBibleRepository } from '../Data/Repositories/IBibleRepository';
import { IDictionaryRepository } from '../Data/Repositories/IDictionaryRepository';
import { StrongsNumberHelper } from '../Data/Core/StrongsNumberHelper';
import { WordFamilyService } from './WordFamilyService';
import {
  ISemanticRangeSource, SemanticRangeData, WordKeyCandidate, WordOccurrenceItem, WordOccurrencePage,
  WordOccurrenceQuery, WordStudyEntry, WordStudyFamilyMember, WordStudyModuleInfo, WordStudyOptions,
  WordStudyOverview, WordStudySubject,
} from '../WordStudy/types';
import { parseStrongsDefinition } from '../WordStudy/strongsDefinition';
import { RenderingMode, glossMatchesRendering, groupRenderings } from '../WordStudy/renderings';
import { GroupMatch, WordGroup, compileWordGroup } from '../WordStudy/wordGroup';
import { foldLemma } from '../Text';

export interface WordStudyServiceDeps {
  /** Installed Bible modules, keyed by abbreviation. Called each time so installs show up. */
  bibles: () => Map<string, IBibleRepository>;
  greek?: IDictionaryRepository | null;
  hebrew?: IDictionaryRepository | null;
  family?: WordFamilyService | null;
  senseSources?: ISemanticRangeSource[];
}

/** Built-in semantic-range source: Strong's sense text, its KJV list and observed renderings. */
export const StrongsSenseSource: ISemanticRangeSource = {
  id: 'strongs-usage',
  label: "Strong's and translation usage",
  getSenses({ entry, renderings, module }) {
    const senses: SemanticRangeData['senses'] = [];
    if (entry?.sense) senses.push({ label: entry.sense, source: 'strongs' });
    for (const r of renderings.slice(0, 8)) {
      senses.push({
        label: r.label,
        detail: r.members.length > 1 ? r.members.slice(0, 4).map(m => m.phrase).join(', ') : undefined,
        share: r.share,
        source: `usage:${module}`,
      });
    }
    return senses.length ? { sourceLabel: `Summary from Strong's and ${module.toUpperCase()} usage`, senses } : null;
  },
};

const TEXT_SCAN_CACHE_MAX = 6;
const FIRST_VERSE = 1001001;
const LAST_VERSE = 66999999;

export class WordStudyService {
  private lemmaIndex: Array<{ key: string; folded: string; candidate: WordKeyCandidate }> | null = null;
  private scanCache = new Map<string, Array<{ verseId: number; matches: GroupMatch[] }>>();

  constructor(private readonly deps: WordStudyServiceDeps) {}

  // ---- resolve ------------------------------------------------------------

  /** Map "G25", "g0025", "ἀγαπάω", "agapao" or "ahab" to Strong's candidates. */
  resolve(query: string): WordKeyCandidate[] {
    const q = query.trim();
    if (!q) return [];
    const display = StrongsNumberHelper.toDisplayFormat(q);
    if (display) {
      const c = this.candidateFor(display);
      return c ? [c] : [];
    }
    const folded = foldLemma(q);
    if (!folded) return [];
    const index = this.ensureLemmaIndex();
    const exact = new Map<string, WordKeyCandidate>();
    const prefix = new Map<string, WordKeyCandidate>();
    for (const e of index) {
      if (e.folded === folded) exact.set(e.candidate.strongs, e.candidate);
      else if (e.folded.startsWith(folded)) prefix.set(e.candidate.strongs, e.candidate);
    }
    return [...exact.values(), ...[...prefix.values()].filter(c => !exact.has(c.strongs))].slice(0, 20);
  }

  private dictFor(display: string): IDictionaryRepository | null {
    return (display.startsWith('G') ? this.deps.greek : this.deps.hebrew) ?? null;
  }

  private candidateFor(display: string): WordKeyCandidate | null {
    const info = this.deps.family?.getEntryInfo(display);
    if (info) {
      return { strongs: display, language: display.startsWith('G') ? 'Greek' : 'Hebrew',
        word: info.word, translit: info.transliteration, gloss: info.gloss };
    }
    const e = this.readEntry(display);
    if (!e) return null;
    return { strongs: display, language: display.startsWith('G') ? 'Greek' : 'Hebrew',
      word: e.word, translit: e.translit, gloss: e.lexiconRenderings.join(', ') || e.sense };
  }

  private ensureLemmaIndex(): Array<{ key: string; folded: string; candidate: WordKeyCandidate }> {
    if (this.lemmaIndex) return this.lemmaIndex;
    const out: Array<{ key: string; folded: string; candidate: WordKeyCandidate }> = [];
    for (const [dict, prefix, language] of [
      [this.deps.greek, 'G', 'Greek'], [this.deps.hebrew, 'H', 'Hebrew'],
    ] as const) {
      if (!dict) continue;
      for (const entry of dict.getAllEntries({ limit: 20000 })) {
        const n = parseInt(entry.entryKey, 10);
        if (!n) continue;
        const parsed = parseStrongsDefinition(entry.definition ?? '', language);
        const candidate: WordKeyCandidate = {
          strongs: `${prefix}${n}`, language, word: parsed.originalWord, translit: parsed.transliteration,
          gloss: parsed.lexiconRenderings.join(', ') || parsed.sense,
        };
        for (const form of [parsed.originalWord, parsed.transliteration, entry.word]) {
          const f = form ? foldLemma(form) : '';
          if (f) out.push({ key: candidate.strongs, folded: f, candidate });
        }
      }
    }
    this.lemmaIndex = out;
    return out;
  }

  private readEntry(display: string): WordStudyEntry | null {
    const dict = this.dictFor(display);
    if (!dict) return null;
    const key = StrongsNumberHelper.toDictionaryKey(display);
    const entry = key ? dict.getEntryByKey(key) : undefined;
    if (!entry) return null;
    const p = parseStrongsDefinition(entry.definition ?? '', display.startsWith('G') ? 'Greek' : 'Hebrew');
    return {
      word: p.originalWord, translit: p.transliteration, pronunciation: p.pronunciation,
      sense: p.sense, lexiconRenderings: p.lexiconRenderings,
      source: display.startsWith('G') ? "Strong's Greek" : "Strong's Hebrew",
    };
  }

  // ---- modules ------------------------------------------------------------

  private moduleList(strongs?: string): WordStudyModuleInfo[] {
    const variants = strongs ? StrongsNumberHelper.toInterlinearVariants(strongs) : [];
    const out: WordStudyModuleInfo[] = [];
    for (const [abbr, repo] of this.deps.bibles()) {
      const info = repo.getModuleInfo();
      const tagged = repo.hasInterlinearData();
      const m: WordStudyModuleInfo = {
        module: abbr, name: info?.fullName ?? abbr, languageCode: info?.languageCode, strongsTagged: tagged,
      };
      if (strongs) {
        if (!tagged) continue;
        const c = repo.countStrongs(variants);
        if (c.occurrences === 0) continue;
        m.occurrences = c.occurrences;
        m.verses = c.verses;
        const books = Object.keys(repo.countStrongsByBook(variants)).map(Number);
        const ot = books.some(b => b < 40), nt = books.some(b => b >= 40);
        m.testament = ot && nt ? 'both' : ot ? 'OT' : 'NT';
      }
      out.push(m);
    }
    return out;
  }

  private pickModule(list: WordStudyModuleInfo[], wanted?: string): WordStudyModuleInfo | undefined {
    return list.find(m => m.module === wanted) ??
      list.find(m => m.module.toLowerCase() === 'kjv') ?? list[0];
  }

  // ---- overview -----------------------------------------------------------

  getOverview(subject: WordStudySubject, options: WordStudyOptions = {}): WordStudyOverview {
    return subject.kind === 'strongs' ? this.strongsOverview(subject.strongs, options)
      : this.groupOverview(subject.group, options);
  }

  private strongsOverview(strongsIn: string, options: WordStudyOptions): WordStudyOverview {
    const display = StrongsNumberHelper.toDisplayFormat(strongsIn) ?? strongsIn;
    const language = display.startsWith('H') ? 'Hebrew' : 'Greek';
    const entry = this.readEntry(display);
    const modules = this.moduleList(display);
    const chosen = this.pickModule(modules, options.module);
    const mode: RenderingMode = options.renderingMode ?? 'head';
    const base: WordStudyOverview = {
      subject: { kind: 'strongs', label: entry?.word ?? display, strongs: display, language },
      entry, modules, module: chosen?.module, moduleLanguage: chosen?.languageCode,
      totals: { occurrences: 0, verses: 0 }, bookCounts: {}, forms: [], morphology: [], family: [],
      semanticRange: null,
      ...(chosen ? {} : { notice: (this.anyTagged() ? 'no-occurrences' : 'not-tagged') as 'no-occurrences' | 'not-tagged' }),
    };
    base.family = this.family(display, chosen?.module);
    if (!chosen) return base;

    const repo = this.deps.bibles().get(chosen.module)!;
    const variants = StrongsNumberHelper.toInterlinearVariants(display);
    base.totals = repo.countStrongs(variants);
    base.bookCounts = repo.countStrongsByBook(variants);
    base.forms = groupRenderings(repo.getStrongsGlossCounts(variants), mode, chosen.languageCode ?? 'en');
    base.morphology = repo.getStrongsMorphCounts(variants).slice(0, 12);
    for (const src of [StrongsSenseSource, ...(this.deps.senseSources ?? [])]) {
      const s = src.getSenses({ strongs: display, entry, renderings: base.forms, module: chosen.module });
      if (s) { base.semanticRange = base.semanticRange
        ? { ...base.semanticRange, senses: [...base.semanticRange.senses, ...s.senses], domains: [...(base.semanticRange.domains ?? []), ...(s.domains ?? [])] }
        : s; }
    }
    return base;
  }

  private anyTagged(): boolean {
    for (const r of this.deps.bibles().values()) if (r.hasInterlinearData()) return true;
    return false;
  }

  private family(display: string, module?: string): WordStudyFamilyMember[] {
    const fam = this.deps.family?.getWordFamily(display);
    if (!fam) return [];
    const repo = module ? this.deps.bibles().get(module) : undefined;
    return fam.members.map(m => ({
      strongs: m.strongsNumber, word: m.word, translit: m.transliteration, gloss: m.gloss,
      relationship: m.relationship,
      occurrences: repo ? repo.countStrongs(StrongsNumberHelper.toInterlinearVariants(m.strongsNumber)).occurrences : undefined,
    }));
  }

  private groupOverview(group: WordGroup, options: WordStudyOptions): WordStudyOverview {
    const modules = this.moduleList();
    const chosen = this.pickModule(modules, options.module);
    const base: WordStudyOverview = {
      subject: { kind: 'group', label: group.label, groupId: group.id },
      entry: null, modules, module: chosen?.module, moduleLanguage: chosen?.languageCode,
      totals: { occurrences: 0, verses: 0 }, bookCounts: {}, forms: [], morphology: [], family: [],
      semanticRange: null, ...(chosen ? {} : { notice: 'no-module' as const }),
    };
    if (!chosen) return base;
    const matcher = compileWordGroup(group, chosen.languageCode);
    base.stemming = matcher.stemming;
    const scan = this.scan(chosen.module, group, chosen.languageCode);
    const formCounts = new Map<string, number>();
    for (const v of scan) {
      base.totals.verses++;
      const book = Math.floor(v.verseId / 1000000);
      for (const m of v.matches) {
        base.totals.occurrences++;
        base.bookCounts[book] = (base.bookCounts[book] ?? 0) + 1;
        const k = m.form.toLowerCase();
        formCounts.set(k, (formCounts.get(k) ?? 0) + 1);
      }
    }
    base.forms = groupRenderings([...formCounts].map(([gloss, count]) => ({ gloss, count })), 'phrase');
    if (base.totals.occurrences === 0) base.notice = 'no-occurrences';
    else base.semanticRange = {
      sourceLabel: `Forms found in ${chosen.module.toUpperCase()}`,
      senses: base.forms.slice(0, 10).map(f => ({ label: f.label, share: f.share, source: `usage:${chosen.module}` })),
    };
    return base;
  }

  // ---- occurrences ----------------------------------------------------------

  getOccurrences(subject: WordStudySubject, q: WordOccurrenceQuery): WordOccurrencePage {
    const repo = this.deps.bibles().get(q.module);
    if (!repo) return { total: 0, items: [] };
    const offset = Math.max(0, q.offset ?? 0);
    const limit = Math.max(1, Math.min(q.limit ?? 100, 500));
    const range = q.book ? { startVerseId: q.book * 1000000 + 1, endVerseId: q.book * 1000000 + 999999 } : undefined;
    let items: WordOccurrenceItem[] = [];

    if (subject.kind === 'strongs') {
      const variants = StrongsNumberHelper.toInterlinearVariants(subject.strongs);
      const lang = repo.getModuleInfo()?.languageCode ?? 'en';
      const mode = q.renderingMode ?? 'head';
      const hits = repo.getStrongsHits(variants, { range });
      const filtered = q.form ? hits.filter(h => h.gloss !== undefined && glossMatchesRendering(h.gloss, q.form!, mode, lang)) : hits;
      items = filtered.map(h => ({ verseId: h.verseId, start: h.start, end: h.end, extra: h.extra,
        form: h.gloss ?? '', morph: h.morph, original: h.original }));
    } else {
      const scan = this.scan(q.module, subject.group, repo.getModuleInfo()?.languageCode);
      for (const v of scan) {
        if (range && (v.verseId < range.startVerseId || v.verseId > range.endVerseId)) continue;
        for (const m of v.matches) {
          if (q.form && m.form.toLowerCase() !== q.form) continue;
          items.push({ verseId: v.verseId, start: m.start, end: m.end, form: m.form });
        }
      }
    }
    const total = items.length;
    const page = items.slice(offset, offset + limit);
    const texts = repo.getVerseTexts([...new Set(page.map(i => i.verseId))]);
    for (const it of page) it.text = texts.get(it.verseId)?.text;
    return { total, items: page };
  }

  // ---- text scan ----------------------------------------------------------

  private scan(module: string, group: WordGroup, language?: string): Array<{ verseId: number; matches: GroupMatch[] }> {
    const key = `${module}\u0000${JSON.stringify([group.terms, group.exclude ?? [], group.stem !== false])}`;
    const cached = this.scanCache.get(key);
    if (cached) {
      this.scanCache.delete(key); this.scanCache.set(key, cached);
      return cached;
    }
    const repo = this.deps.bibles().get(module);
    const matcher = compileWordGroup(group, language);
    const out: Array<{ verseId: number; matches: GroupMatch[] }> = [];
    if (repo) {
      const rows = repo.getSql().queryAll<{ verse_id: number; text: string }>(
        'SELECT verse_id, text FROM bible_verse WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id',
        [FIRST_VERSE, LAST_VERSE]
      );
      for (const r of rows) {
        const matches = matcher.matchText(r.text ?? '');
        if (matches.length) out.push({ verseId: r.verse_id, matches });
      }
    }
    this.scanCache.set(key, out);
    while (this.scanCache.size > TEXT_SCAN_CACHE_MAX) this.scanCache.delete(this.scanCache.keys().next().value as string);
    return out;
  }
}
