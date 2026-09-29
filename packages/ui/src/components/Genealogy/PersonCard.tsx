/**
 * PersonCard: the details of one person from a `GenealogyGraph`: name, sex/tribe/nation, every relationship
 * with its verse link and confidence badge, the alternative readings of a disputed link (radio choices), other
 * people with the same name, interpretive case notes with the KJV text, and the "Read" / "Show family tree"
 * buttons. Pass the graph and a person id; the card derives the rest. Verse ids are formatted by `formatVerse`
 * (the number when omitted). Labels are props with English defaults.
 */
import { useId } from 'react';
import type { GenealogyEdgeDto, GenealogyGraph, GenealogyPersonDto } from '@bible/core/browser';
import { cx, fill } from './util';

export interface PersonCardLabels {
  close: string;
  read: string;
  showTree: string;
  male: string;
  female: string;
  group: string;
  /** Words for relationships, keyed by the other person's role. */
  father: string;
  mother: string;
  son: string;
  daughter: string;
  child: string;
  husband: string;
  wife: string;
  samePerson: string;
  related: string;
  relationships: string;
  noRelationships: string;
  /** Legend of the alternative-readings radio group. */
  readings: string;
  /** Text of one alternative reading; `{from}`, `{to}` (person names) and `{reading}` are replaced. */
  readingOption: string;
  namesakes: string;
  /** `{name}` is replaced. */
  namesakesFor: string;
  cases: string;
  kjv: string;
  /** `{holder}` is replaced. */
  heldBy: string;
  legal: string;
  levirate: string;
  adoptive: string;
  ancestor: string;
  /** Confidence badge texts by token; unknown tokens are shown as they are. */
  confidence: Record<string, string>;
  /** Accessible name of the verse link; `{verse}` is replaced. */
  openVerse: string;
  tribe: string;
  nation: string;
  roles: string;
  aliases: string;
}

export const DEFAULT_PERSON_CARD_LABELS: PersonCardLabels = {
  close: 'Close',
  read: 'Read',
  showTree: 'Show family tree',
  male: 'Male',
  female: 'Female',
  group: 'Group',
  father: 'Father',
  mother: 'Mother',
  son: 'Son',
  daughter: 'Daughter',
  child: 'Child',
  husband: 'Husband',
  wife: 'Wife',
  samePerson: 'Possibly the same as',
  related: 'Related to',
  relationships: 'Relationships',
  noRelationships: 'No recorded relationships',
  readings: 'Alternative readings of this link',
  readingOption: '{from} → {to}: {reading}',
  namesakes: 'Other people with this name',
  namesakesFor: 'Other people named {name}',
  cases: 'Notes on interpretation',
  kjv: 'KJV',
  heldBy: 'held by {holder}',
  legal: 'legal',
  levirate: 'levirate',
  adoptive: 'adoptive',
  ancestor: 'ancestor',
  confidence: { certain: 'certain', probable: 'probable', possible: 'possible', disputed: 'disputed', derived: 'derived' },
  openVerse: 'Open {verse}',
  tribe: 'Tribe',
  nation: 'Nation',
  roles: 'Roles',
  aliases: 'Also called',
};

export interface PersonCardProps {
  graph: GenealogyGraph;
  personId: string;
  /** Format a numeric verse id ("Genesis 5:3"). Fallback: the number. */
  formatVerse?: (verseId: number) => string;
  /** Chosen reading per reading group; defaults to `graph.options.readings`. */
  readings?: Record<string, string>;
  labels?: Partial<PersonCardLabels>;
  /** Render as a bottom sheet (narrow containers). */
  sheet?: boolean;
  onOpenVerse?: (verseId: number) => void;
  onFocusPerson?: (personId: string) => void;
  onSelectReading?: (readingGroup: string, reading: string) => void;
  onClose?: () => void;
}

interface Row { edge: GenealogyEdgeDto; other: GenealogyPersonDto | undefined; relation: string }

export function PersonCard({
  graph, personId, formatVerse = String, readings, labels: labelOverrides, sheet = false,
  onOpenVerse, onFocusPerson, onSelectReading, onClose,
}: PersonCardProps) {
  const labels: PersonCardLabels = {
    ...DEFAULT_PERSON_CARD_LABELS, ...labelOverrides,
    confidence: { ...DEFAULT_PERSON_CARD_LABELS.confidence, ...labelOverrides?.confidence },
  };
  const uid = useId();
  const person = graph.person(personId);
  if (!person) return null;
  const chosen = readings ?? graph.options.readings;

  const rows: Row[] = [];
  for (const e of graph.parents(personId)) {
    rows.push({ edge: e, other: graph.person(e.from), relation: e.type === 'mother_of' ? labels.mother : labels.father });
  }
  for (const e of graph.spouses(personId)) {
    const other = graph.person(e.from === personId ? e.to : e.from);
    const otherIsHusband = e.type === 'husband_of' ? e.from !== personId : e.from === personId;
    rows.push({ edge: e, other, relation: otherIsHusband ? labels.husband : labels.wife });
  }
  for (const e of graph.children(personId)) {
    const other = graph.person(e.to);
    rows.push({ edge: e, other, relation: other?.sex === 'male' ? labels.son : other?.sex === 'female' ? labels.daughter : labels.child });
  }
  for (const e of graph.others(personId)) {
    const other = graph.person(e.from === personId ? e.to : e.from);
    rows.push({ edge: e, other, relation: e.type === 'possibly_same_as' ? labels.samePerson : labels.related });
  }

  const groups: string[] = [];
  for (const r of rows) if (r.edge.readingGroup && !groups.includes(r.edge.readingGroup)) groups.push(r.edge.readingGroup);

  const namesakes = graph.namesakes(personId);
  const cases = (graph.dataset.cases ?? []).filter((c) => c.personIds.includes(personId));
  const facts: Array<[string, string]> = [];
  if (person.sex) facts.push([person.sex === 'male' ? labels.male : labels.female, '']);
  else if (person.kind === 'group') facts.push([labels.group, '']);
  if (person.tribe) facts.push([labels.tribe, person.tribe]);
  if (person.nation) facts.push([labels.nation, person.nation]);
  if (person.roles?.length) facts.push([labels.roles, person.roles.join(', ')]);
  if (person.aliases?.length) facts.push([labels.aliases, person.aliases.join(', ')]);

  const verseButton = (id: number) => (
    <button key={id} type="button" className="kth-btn kth-btn--ghost kth-btn--sm kth-genealogy-card__verse"
      aria-label={fill(labels.openVerse, { verse: formatVerse(id) })} onClick={() => onOpenVerse?.(id)}>
      {formatVerse(id)}
    </button>
  );
  const qualifier = (e: GenealogyEdgeDto) => (e.qualifier ? labels[e.qualifier] : '');
  const name = (id: string) => graph.person(id)?.name ?? id;

  return (
    <aside className={cx('kth-genealogy-card', sheet && 'kth-genealogy-card--sheet')} aria-labelledby={`${uid}-title`}>
      <header className="kth-genealogy-card__header">
        <h2 id={`${uid}-title`} className="kth-genealogy-card__title">{person.name}</h2>
        {onClose && (
          <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" aria-label={labels.close} onClick={onClose}>×</button>
        )}
      </header>
      {facts.length > 0 && (
        <p className="kth-genealogy-card__facts">
          {facts.map(([k, v], i) => (
            <span key={k} className="kth-genealogy-card__fact">{v ? `${k}: ${v}` : k}{i < facts.length - 1 ? ' · ' : ''}</span>
          ))}
        </p>
      )}
      {person.notes && <p className="kth-genealogy-card__notes">{person.notes}</p>}
      <div className="kth-genealogy-card__actions">
        <button type="button" className="kth-btn kth-btn--primary kth-btn--sm" disabled={person.firstRef === undefined}
          onClick={() => person.firstRef !== undefined && onOpenVerse?.(person.firstRef)}>{labels.read}</button>
        <button type="button" className="kth-btn kth-btn--sm" onClick={() => onFocusPerson?.(personId)}>{labels.showTree}</button>
      </div>

      <section aria-labelledby={`${uid}-rel`}>
        <h3 id={`${uid}-rel`} className="kth-genealogy-card__heading">{labels.relationships}</h3>
        {rows.length === 0 ? <p className="kth-genealogy-card__empty">{labels.noRelationships}</p> : (
          <ul className="kth-genealogy-card__list">
            {rows.map(({ edge, other, relation }) => (
              <li key={edge.id} className="kth-genealogy-card__row" data-edge-id={edge.id}>
                <span className="kth-genealogy-card__relation">{relation}</span>{' '}
                {other ? (
                  <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" onClick={() => onFocusPerson?.(other.id)}>{other.name}</button>
                ) : null}
                {qualifier(edge) && <span className="kth-genealogy-card__qualifier"> ({qualifier(edge)})</span>}
                {edge.confidence ? (
                  <span className={cx('kth-badge', 'kth-genealogy-card__confidence', `kth-genealogy-card__confidence--${edge.confidence}`)}>
                    {labels.confidence[edge.confidence] ?? edge.confidence}
                  </span>
                ) : null}
                {edge.verses.map((v) => verseButton(v.start))}
              </li>
            ))}
          </ul>
        )}
      </section>

      {groups.map((g) => {
        const options = graph.readingsOf(g);
        if (options.length < 2) return null;
        const current = options.find((o) => o.reading === chosen[g]) ?? options.find((o) => o.reading === 'default') ?? options[0];
        return (
          <fieldset key={g} className="kth-genealogy-card__readings" role="radiogroup">
            <legend>{labels.readings}</legend>
            {options.map((o) => {
              const reading = o.reading ?? 'default';
              return (
                <label key={o.id} className="kth-genealogy-card__reading">
                  <input type="radio" name={`${uid}-${g}`} value={reading} checked={o === current}
                    onChange={() => onSelectReading?.(g, reading)} />{' '}
                  {fill(labels.readingOption, { from: name(o.from), to: name(o.to), reading })}
                  {o.verses[0] ? <> {verseButton(o.verses[0].start)}</> : null}
                </label>
              );
            })}
          </fieldset>
        );
      })}

      {namesakes.length > 0 && (
        <section aria-labelledby={`${uid}-same`}>
          <h3 id={`${uid}-same`} className="kth-genealogy-card__heading">{fill(labels.namesakesFor, { name: person.name })}</h3>
          <ul className="kth-genealogy-card__list">
            {namesakes.map((n) => (
              <li key={n.id}>
                <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" onClick={() => onFocusPerson?.(n.id)}>{n.name}</button>
                {n.firstRef !== undefined && <span className="kth-genealogy-card__ref"> {formatVerse(n.firstRef)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {cases.length > 0 && (
        <section aria-labelledby={`${uid}-cases`}>
          <h3 id={`${uid}-cases`} className="kth-genealogy-card__heading">{labels.cases}</h3>
          {cases.map((c) => (
            <article key={c.id} className="kth-genealogy-card__case">
              <h4 className="kth-genealogy-card__case-title">{c.title}</h4>
              <blockquote className="kth-genealogy-card__kjv" aria-label={labels.kjv}>{c.text}</blockquote>
              {c.verses.map((v) => verseButton(v.start))}
              <ul className="kth-genealogy-card__list">
                {c.readings.map((r) => (
                  <li key={r.label}>
                    <strong>{r.label}</strong>: {r.summary}
                    {r.heldBy ? ` (${fill(labels.heldBy, { holder: r.heldBy })})` : ''}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}
    </aside>
  );
}
