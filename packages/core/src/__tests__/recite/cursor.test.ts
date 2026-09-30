import { describe, it, expect } from 'vitest';
import { ReciteCursor } from '../../recite/cursor';
import { englishKit } from '../../recite/lang/en';
import { alignRecitation } from '../../recite/align';
import { POLICIES } from '../../recite/policy';
import { ev, rw } from './helpers';

const PASSAGE = ev(
  'In the beginning God created the heaven and the earth. And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters. And God said, Let there be light: and there was light. And God saw the light, that it was good: and God divided the light from the darkness.',
);

function cursor() {
  return new ReciteCursor(PASSAGE, englishKit);
}

describe('ReciteCursor', () => {
  it('follows in-order chunks', () => {
    const c = cursor();
    expect(c.position).toBe(-1);
    const e1 = c.push(rw('in the beginning God created the heaven and the earth'));
    expect(e1).toEqual({ kind: 'on-track', position: 9 });
    const e2 = c.push(rw('and the earth was without form and void'));
    expect(e2.kind).toBe('on-track');
    expect(c.position).toBe(17);
    expect(c.furthest).toBe(17);
    expect(c.isComplete).toBe(false);
  });

  it('completes at the end', () => {
    const c = new ReciteCursor(ev('The Lord is my shepherd I shall not want'), englishKit);
    c.push(rw('the Lord is my shepherd'));
    expect(c.isComplete).toBe(false);
    c.push(rw('I shall not want'));
    expect(c.isComplete).toBe(true);
  });

  it('detects a skipped verse', () => {
    const c = cursor();
    c.push(rw('in the beginning God created the heaven and the earth'));
    const e = c.push(rw('and the Spirit of God moved upon the face of the waters'));
    expect(e.kind).toBe('jumped-ahead');
    if (e.kind === 'jumped-ahead') {
      expect(e.from).toBe(9);
      expect(e.to).toBeGreaterThan(9);
    }
    expect(c.position).toBe(c.furthest);
  });

  it('detects a repeated verse', () => {
    const c = cursor();
    c.push(rw('in the beginning God created the heaven and the earth'));
    c.push(rw('and the earth was without form and void and darkness was upon the face of the deep'));
    const e = c.push(rw('in the beginning God created the heaven and the earth'));
    expect(e).toEqual({ kind: 'went-back', to: 9 });
    expect(c.position).toBe(9);
    expect(c.furthest).toBeGreaterThan(9);
  });

  it('reports lost on nonsense, twice', () => {
    const c = cursor();
    c.push(rw('in the beginning God created the heaven and the earth'));
    expect(c.push(rw('purple monkey dishwasher banana telephone'))).toEqual({ kind: 'lost' });
    expect(c.push(rw('quantum spaghetti lighthouse pyjamas violin'))).toEqual({ kind: 'lost' });
  });

  it('never derails on a short chunk', () => {
    const c = cursor();
    c.push(rw('in the beginning God created the heaven and the earth'));
    expect(c.push(rw('banana telephone')).kind).toBe('uncertain');
    expect(c.position).toBe(9);
    expect(c.heard.length).toBe(12);
  });

  it('a short on-track chunk advances', () => {
    const c = cursor();
    expect(c.push(rw('in the')).kind).toBe('on-track');
    expect(c.position).toBe(1);
  });

  it('recognises whole-chunk commands and does not keep them', () => {
    const c = cursor();
    expect(c.push(rw('hint'))).toEqual({ kind: 'command', command: 'hint' });
    expect(c.push(rw('um where am I'))).toEqual({ kind: 'command', command: 'where' });
    expect(c.heard).toEqual([]);
  });

  it('a command word inside a longer chunk is not a command', () => {
    const c = cursor();
    const e = c.push(rw('in the beginning stop'));
    expect(e.kind).not.toBe('command');
    expect(c.heard.length).toBe(4);
  });

  it('"next" in verse text is not a command', () => {
    const c = new ReciteCursor(ev('And the next day he went forth into the field'), englishKit);
    const e = c.push(rw('and the next day'));
    expect(e.kind).toBe('on-track');
  });

  it('final score is a plain alignment of everything heard', () => {
    const c = cursor();
    c.push(rw('in the beginning God created the heaven and the earth'));
    c.push(rw('and the earth was without form and void'));
    const r = alignRecitation(PASSAGE, c.heard, englishKit, POLICIES.normal, { mode: 'prefix' });
    expect(r.lastMatched).toBe(17);
  });
});
