import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { writeZip, readZip, checkEntryName, ZipError } from '../../Backup/Zip';
import { chunked, once } from '../../Backup/Streams';

const u8 = strToU8;
async function read(bytes: Uint8Array, limits = {}, chunk = 1000) {
  return readZip(chunked(bytes, chunk), limits);
}

describe('Zip writer/reader', () => {
  it('round-trips entries in order, including empty entries and odd chunking', async () => {
    const bytes = writeZip([
      { name: 'manifest.json', data: u8('{"a":1}') },
      { name: 'empty.txt', data: new Uint8Array(0) },
      { name: 'notes/Verse Notes/John/3/16.bn', data: u8('x'.repeat(5000)) },
      { name: 'db/blob.sqlite', data: new Uint8Array(3000).map((_, i) => i * 31), store: true },
    ]);
    for (const chunk of [1, 7, 1000, bytes.length]) {
      const got = await read(bytes, {}, chunk);
      expect(got.map((e) => e.name)).toEqual(['manifest.json', 'empty.txt', 'notes/Verse Notes/John/3/16.bn', 'db/blob.sqlite']);
      expect(new TextDecoder().decode(got[0].data)).toBe('{"a":1}');
      expect(got[1].data.length).toBe(0);
      expect(got[2].data.length).toBe(5000);
      expect(got[3].data[100]).toBe((100 * 31) & 0xff);
    }
  });
  it('is deterministic', () => {
    const e = [{ name: 'a', data: u8('hello') }];
    expect(writeZip(e)).toEqual(writeZip(e));
  });
  it('starts with PK\\x03\\x04 so a reader can sniff it', () => {
    expect(Array.from(writeZip([{ name: 'a', data: u8('x') }]).subarray(0, 4))).toEqual([0x50, 0x4b, 3, 4]);
  });
  it.each(['../x', '/abs', 'a/../b', 'a\\b', 'a\u0000b', 'C:/x', 'a//b', './a', '', 'x/./y'])('refuses unsafe name %j', (name) => {
    expect(checkEntryName(name)).not.toBeNull();
    expect(() => writeZip([{ name, data: u8('x') }])).toThrow(ZipError);
  });
  it('accepts safe names', () => {
    for (const n of ['a', 'a/b.c', 'notes/Verse Notes/John 3/16 (copy).bn', 'ext/ext.pub.name/kv.ndjson', 'dir/']) {
      expect(checkEntryName(n)).toBeNull();
    }
  });
  it('rejects hostile archives made by another tool', async () => {
    // fflate itself will happily write these names; the reader must refuse them.
    const evil = zipSync({ '../evil': u8('x') });
    await expect(read(evil)).rejects.toThrow(/relative|segment/);
    const backslash = zipSync({ 'a\\b': u8('x') });
    await expect(read(backslash)).rejects.toThrow(ZipError);
  });
  it('rejects case-insensitive duplicate names', async () => {
    const dup = zipSync({ 'A.txt': u8('1'), 'a.txt': u8('2') });
    await expect(read(dup)).rejects.toThrow(/duplicate/);
    expect(() => writeZip([{ name: 'A', data: u8('1') }, { name: 'a', data: u8('2') }])).toThrow(/duplicate/);
  });
  it('rejects a zip bomb by ratio, oversize entries, oversize totals and entry counts', async () => {
    const bomb = writeZip([{ name: 'z.bin', data: new Uint8Array(4 * 1024 * 1024) }]);
    await expect(read(bomb, { ratioMinBytes: 1000 })).rejects.toThrow(/ratio/);
    await expect(read(bomb, { maxEntryBytes: 1000 })).rejects.toThrow(/too large/);
    await expect(read(bomb, { maxTotalBytes: 1000 })).rejects.toThrow(/too large/);
    const many = writeZip([{ name: 'a', data: u8('1') }, { name: 'b', data: u8('2') }]);
    await expect(read(many, { maxEntries: 1 })).rejects.toThrow(/too many/);
  });
  it('rejects truncated archives, garbage and the empty archive', async () => {
    const noise = Uint8Array.from({ length: 20000 }, (_, i) => (i * 2654435761) >>> 24);
    const good = writeZip([{ name: 'a.txt', data: noise }]);
    await expect(read(good.subarray(0, 500))).rejects.toThrow(ZipError);
    await expect(read(u8('this is not a zip file at all'))).rejects.toThrow(ZipError);
    await expect(readZip(once(new Uint8Array(0)))).rejects.toThrow(ZipError);
  });
  it('rejects a data-descriptor style entry whose sizes are not declared', async () => {
    const { Zip, ZipDeflate } = await import('fflate');
    const parts: Uint8Array[] = [];
    const z = new Zip((err, chunk) => { if (err) throw err; parts.push(chunk); });
    const f = new ZipDeflate('s.txt');
    z.add(f);
    f.push(u8('streamed'), true);
    z.end();
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    await expect(read(all)).rejects.toThrow(/sizes/);
  });
});
