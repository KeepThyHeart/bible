import { describe, expect, it } from 'vitest';
import {
  booksLike,
  creditedAs,
  mentions,
  peopleLike,
  personLikeness,
  pickDistractors,
  placesLike,
} from './distractors.js';
import type { Person, Place } from './sources.js';
import { seededRandom } from '../../room/state.js';

function person(name: string, overrides: Partial<Person> = {}): Person {
  return {
    name,
    accept: [],
    sex: 'male',
    era: 'exodus',
    roles: [],
    difficulty: 2,
    clues: [],
    ...overrides,
  };
}

const moses = person('Moses', { roles: ['prophet', 'leader'], difficulty: 1 });
const people: Person[] = [
  moses,
  person('Aaron', { roles: ['priest', 'leader'] }),
  person('Joshua', { roles: ['leader'] }),
  person('Caleb', { roles: ['leader'] }),
  person('Miriam', { sex: 'female', roles: ['prophet'] }),
  person('Esther', { sex: 'female', era: 'exile' }),
  person('Timothy', { era: 'church' }),
  person('Lydia', { sex: 'female', era: 'church' }),
  person('Paul', { era: 'church', accept: ['Saul'] }),
  person('Abraham', { era: 'patriarchs' }),
  person('Gideon', { era: 'judges', roles: ['leader'] }),
  person('Samuel', { era: 'judges', roles: ['prophet'] }),
  person('Elijah', { era: 'prophets', roles: ['prophet'], accept: ['Elias'] }),
];

function random(seed = 7): () => number {
  return seededRandom(seed).random;
}

describe('resemblance', () => {
  it('ranks a man of the same story above a woman of another', () => {
    expect(personLikeness(moses, person('Aaron', { roles: ['leader'] }))).toBeGreaterThan(
      personLikeness(moses, person('Esther', { sex: 'female', era: 'exile' }))
    );
  });

  it('ranks the next era above a distant one', () => {
    const judges = personLikeness(moses, person('Gideon', { era: 'judges' }));
    const church = personLikeness(moses, person('Timothy', { era: 'church' }));
    expect(judges).toBeGreaterThan(church);
  });

  it('prefers books of the same section, then the same testament', () => {
    const ranked = booksLike(40).sort((a, b) => b.score - a.score);
    expect(ranked.slice(0, 3).map((book) => book.name).sort()).toEqual(['John', 'Luke', 'Mark']);
    expect(ranked.at(-1)?.name).not.toBe('Acts');
  });
});

describe('picking', () => {
  it('leads with the three most plausible wrong answers', () => {
    const picked = pickDistractors({
      answer: moses,
      candidates: peopleLike(moses, people),
      shown: [],
      random: random(),
    });
    expect(picked.slice(0, 3).sort()).toEqual(['Aaron', 'Caleb', 'Joshua']);
    expect(picked).toHaveLength(8);
    expect(new Set(picked).size).toBe(8);
    expect(picked).not.toContain('Moses');
  });

  it('never offers the other sex while the same sex has candidates left', () => {
    const anna = person('Anna', { sex: 'female', era: 'gospels', roles: ['prophet'] });
    const pool = [
      anna,
      person('John the Baptist', { era: 'gospels', roles: ['prophet'] }),
      person('Lydia', { sex: 'female', era: 'church' }),
      person('Eve', { sex: 'female', era: 'beginnings' }),
    ];
    const picked = pickDistractors({
      answer: anna,
      candidates: peopleLike(anna, pool),
      shown: [],
      random: random(),
      count: 2,
    });
    expect(picked.sort()).toEqual(['Eve', 'Lydia']);
  });

  it('offers fewer wrong answers rather than one of a different kind', () => {
    const place = (name: string, kind: Place['kind']): Place => ({
      name,
      accept: [],
      kind,
      testament: 'new',
      difficulty: 3,
    });
    const bethesda = place('Pool of Bethesda', 'water');
    const pool = [
      bethesda,
      place('Pool of Siloam', 'water'),
      place('Sea of Galilee', 'water'),
      place('Jordan', 'water'),
      place('Rome', 'city'),
      place('Patmos', 'region'),
    ];
    const picked = pickDistractors({
      answer: bethesda,
      candidates: placesLike(bethesda, pool),
      shown: [],
      random: random(),
    });
    expect(picked.sort()).toEqual(['Jordan', 'Pool of Siloam', 'Sea of Galilee']);
  });

  it('crosses to another kind only when its own cannot fill a round', () => {
    const eden: Place = { name: 'Eden', accept: [], kind: 'site', testament: 'old', difficulty: 1 };
    const pool: Place[] = [
      eden,
      { name: 'Golgotha', accept: [], kind: 'site', testament: 'new', difficulty: 2 },
      { name: 'Babel', accept: [], kind: 'city', testament: 'old', difficulty: 2 },
      { name: 'Ur', accept: [], kind: 'city', testament: 'old', difficulty: 3 },
    ];
    expect(placesLike(eden, pool)).toHaveLength(3);
  });

  it('never offers someone the round already names, under any of their names', () => {
    const jesus = person('Jesus', { era: 'gospels' });
    const picked = pickDistractors({
      answer: jesus,
      candidates: peopleLike(jesus, people),
      shown: ['Saul, Saul, why persecutest thou me?'],
      random: random(),
    });
    expect(picked).not.toContain('Paul');
  });

  it('never offers a name the matcher would credit as the answer', () => {
    const elijah = people.find((entry) => entry.name === 'Elijah') as Person;
    const picked = pickDistractors({
      answer: elijah,
      candidates: [...peopleLike(elijah, people), { name: 'Elias', accept: [], score: 99 }],
      shown: [],
      random: random(),
    });
    expect(picked).not.toContain('Elias');
  });

  it('draws the same wrong answers from the same generator', () => {
    const draw = (): string[] =>
      pickDistractors({ answer: moses, candidates: peopleLike(moses, people), shown: [], random: random(3) });
    expect(draw()).toEqual(draw());
  });

  it('offers fewer rather than inventing any when the pool runs short', () => {
    const picked = pickDistractors({
      answer: moses,
      candidates: peopleLike(moses, people.slice(0, 3)),
      shown: [],
      random: random(),
    });
    expect(picked.sort()).toEqual(['Aaron', 'Joshua']);
  });
});

describe('the helpers the validator shares', () => {
  it('credits an alternate name in either direction', () => {
    expect(creditedAs({ name: 'Saul', accept: [] }, { name: 'Paul', accept: ['Saul'] })).toBe(true);
    expect(creditedAs({ name: 'Silas', accept: [] }, { name: 'Paul', accept: ['Saul'] })).toBe(false);
  });

  it('finds a quotation whatever its punctuation and quote marks', () => {
    const verse = 'And the Lord God called unto Adam, and said unto him, Where art thou?';
    expect(mentions(verse, 'Where art thou')).toBe(true);
    expect(mentions(verse, 'Where are you?')).toBe(false);
  });

  it('matches whole words only', () => {
    expect(mentions('Samuel judged Israel', 'Sam')).toBe(false);
  });
});
