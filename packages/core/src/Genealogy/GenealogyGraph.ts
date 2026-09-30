import type { GenealogyDatasetDto, GenealogyEdgeDto, GenealogyPersonDto, LineageDto } from './types';

export interface GenealogyGraphOptions {
  /**
   * Chosen reading per reading_group (group id -> reading label). A group with no
   * choice uses the row whose reading is 'default'; if none is 'default', the first row.
   */
  readings?: Record<string, string>;
  /** Include links whose confidence is 'disputed'. Default true. */
  showDisputed?: boolean;
}

const PARENT_TYPES = new Set(['father_of', 'mother_of']);
const SPOUSE_TYPES = new Set(['husband_of', 'wife_of']);

/**
 * Indexed, read-only view of a genealogy dataset. Canonical stored edges are
 * `father_of` / `mother_of` (parent -> child) and `husband_of` / `wife_of`;
 * siblings, ancestors and descendants are derived, never stored twice.
 */
export class GenealogyGraph {
  readonly dataset: GenealogyDatasetDto;
  readonly options: Required<GenealogyGraphOptions>;
  private readonly people = new Map<string, GenealogyPersonDto>();
  private readonly parentEdges = new Map<string, GenealogyEdgeDto[]>(); // child id -> edges
  private readonly childEdges = new Map<string, GenealogyEdgeDto[]>(); // parent id -> edges
  private readonly spouseEdges = new Map<string, GenealogyEdgeDto[]>();
  private readonly otherEdges = new Map<string, GenealogyEdgeDto[]>();
  private readonly byName = new Map<string, string[]>();
  private readonly lineageById = new Map<string, LineageDto>();
  /** Edges hidden by the reading filter, by reading group (for the card's "other readings"). */
  private readonly alternatives = new Map<string, GenealogyEdgeDto[]>();

  static from(ds: GenealogyDatasetDto, opts: GenealogyGraphOptions = {}): GenealogyGraph {
    return new GenealogyGraph(ds, opts);
  }

  private constructor(ds: GenealogyDatasetDto, opts: GenealogyGraphOptions) {
    this.dataset = ds;
    this.options = { readings: opts.readings ?? {}, showDisputed: opts.showDisputed ?? true };
    for (const p of ds.persons) {
      this.people.set(p.id, p);
      for (const n of [p.name, ...(p.aliases ?? [])]) {
        const k = normName(n);
        const list = this.byName.get(k);
        if (list) { if (!list.includes(p.id)) list.push(p.id); } else this.byName.set(k, [p.id]);
      }
    }
    for (const l of ds.lineages) this.lineageById.set(l.id, l);

    const groups = new Map<string, GenealogyEdgeDto[]>();
    for (const e of ds.edges) {
      if (e.readingGroup) {
        const g = groups.get(e.readingGroup);
        if (g) g.push(e); else groups.set(e.readingGroup, [e]);
      }
    }
    const chosen = new Set<string>();
    for (const [gid, rows] of groups) {
      const want = this.options.readings[gid];
      const pick = rows.find(r => r.reading === want) ?? rows.find(r => r.reading === 'default') ?? rows[0];
      chosen.add(pick.id);
      this.alternatives.set(gid, rows);
    }
    for (const e of ds.edges) {
      if (e.readingGroup && !chosen.has(e.id)) continue;
      // A link inside a reading group is one alternative reading (the chosen one is kept even when
      // 'disputed', so the KJV wording, e.g. Luke 3:23 "son of Heli", is never dropped by the toggle).
      if (!this.options.showDisputed && e.confidence === 'disputed' && !e.readingGroup) continue;
      if (!this.people.has(e.from) || !this.people.has(e.to)) continue;
      if (PARENT_TYPES.has(e.type)) {
        push(this.childEdges, e.from, e);
        push(this.parentEdges, e.to, e);
      } else if (SPOUSE_TYPES.has(e.type)) {
        push(this.spouseEdges, e.from, e);
        push(this.spouseEdges, e.to, e);
      } else {
        push(this.otherEdges, e.from, e);
        push(this.otherEdges, e.to, e);
      }
    }
    for (const list of this.childEdges.values()) list.sort(bySort);
  }

  person(id: string): GenealogyPersonDto | undefined { return this.people.get(id); }
  has(id: string): boolean { return this.people.has(id); }
  allPersons(): GenealogyPersonDto[] { return this.dataset.persons; }
  lineage(id: string): LineageDto | undefined { return this.lineageById.get(id); }
  lineages(): LineageDto[] { return this.dataset.lineages; }

  /** Edges (father_of/mother_of) whose `to` is `id`. */
  parents(id: string): GenealogyEdgeDto[] { return this.parentEdges.get(id) ?? []; }
  /** Edges (father_of/mother_of) whose `from` is `id`, in birth order. */
  children(id: string): GenealogyEdgeDto[] { return this.childEdges.get(id) ?? []; }
  /** husband_of / wife_of edges touching `id`. */
  spouses(id: string): GenealogyEdgeDto[] { return this.spouseEdges.get(id) ?? []; }
  /** Other edges (possibly_same_as, founded_by, ...) touching `id`. */
  others(id: string): GenealogyEdgeDto[] { return this.otherEdges.get(id) ?? []; }

  parentIds(id: string): string[] { return uniq(this.parents(id).map(e => e.from)); }
  childIds(id: string): string[] { return uniq(this.children(id).map(e => e.to)); }
  spouseIds(id: string): string[] {
    return uniq(this.spouses(id).map(e => (e.from === id ? e.to : e.from)));
  }
  /**
   * father_of edges into `id`, most direct first: no qualifier and not disputed, then the rest by
   * sort order, keeping dataset order for ties. A person with two listed fathers (Joseph, Zerubbabel,
   * Salah) has both, so callers can show both links.
   */
  fatherEdges(id: string): GenealogyEdgeDto[] {
    const rank = (e: GenealogyEdgeDto) => (e.qualifier ? 2 : 0) + (e.confidence === 'disputed' ? 1 : 0);
    return this.parents(id)
      .filter(e => e.type === 'father_of')
      .map((e, i) => ({ e, i }))
      .sort((a, b) => rank(a.e) - rank(b.e) || bySort(a.e, b.e) || a.i - b.i)
      .map(x => x.e);
  }
  /** The first of `fatherEdges` (deterministic, independent of the "show disputed" toggle order). */
  fatherId(id: string): string | undefined {
    return this.fatherEdges(id)[0]?.from;
  }
  motherId(id: string): string | undefined {
    return this.parents(id).find(e => e.type === 'mother_of')?.from;
  }
  /** Derived: people sharing at least one parent (excluding self), in dataset order. */
  siblings(id: string): string[] {
    const out = new Set<string>();
    for (const p of this.parentIds(id)) for (const c of this.childIds(p)) if (c !== id) out.add(c);
    return [...out];
  }

  /** All readings of a disputed link (including the hidden ones), or [] when not in dispute. */
  readingsOf(readingGroup: string): GenealogyEdgeDto[] { return this.alternatives.get(readingGroup) ?? []; }

  /** People with the same name or alias (excluding `id`), for the "other people named X" list. */
  namesakes(id: string): GenealogyPersonDto[] {
    const p = this.people.get(id);
    if (!p) return [];
    const out = new Map<string, GenealogyPersonDto>();
    for (const n of [p.name, ...(p.aliases ?? [])]) {
      for (const other of this.byName.get(normName(n)) ?? []) {
        if (other !== id) { const o = this.people.get(other); if (o) out.set(other, o); }
      }
    }
    return [...out.values()];
  }

  /** Persons matching a name or alias (case-insensitive, exact). */
  findByName(name: string): GenealogyPersonDto[] {
    return (this.byName.get(normName(name)) ?? []).map(i => this.people.get(i)!).filter(Boolean);
  }

  /** Case-insensitive prefix/substring search over names and aliases, best matches first. */
  search(query: string, limit = 20): GenealogyPersonDto[] {
    const q = normName(query);
    if (!q) return [];
    const scored: { p: GenealogyPersonDto; s: number }[] = [];
    for (const p of this.dataset.persons) {
      let best = Infinity;
      [p.name, ...(p.aliases ?? [])].forEach((n, idx) => {
        const k = normName(n);
        const i = k.indexOf(q);
        const penalty = idx === 0 ? 0 : 0.5; // an alias match ranks below a primary-name match
        if (i === 0) best = Math.min(best, (k === q ? 0 : 1) + penalty);
        else if (i > 0) best = Math.min(best, 2 + penalty);
      });
      if (best < Infinity) scored.push({ p, s: best });
    }
    scored.sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name));
    return scored.slice(0, limit).map(x => x.p);
  }
}

function normName(s: string): string { return s.trim().toLowerCase(); }
function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v); else m.set(k, [v]);
}
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function bySort(a: GenealogyEdgeDto, b: GenealogyEdgeDto): number {
  return (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
}
