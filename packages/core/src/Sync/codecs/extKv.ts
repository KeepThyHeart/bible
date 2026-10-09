/** Codec for `extension_storage` (kind and type `ext.kv`, contracts 0063 §10). */
import type { Row } from '../../Backup/Registry';
import type { CodecContext, DecodeResult, RecordCodec } from './RecordCodec';
import { RecordDecodeError } from './errors';

const US = '\u001f';

/** registry column -> payload key. Every registry column of `extension_storage` is encoded. */
export const EXT_KV_COLUMN_MAP: Readonly<Record<string, string>> = {
  extension_id: 'ext', key: 'key', value: 'value', updated_at: 'updatedAt',
};

/** local key = extension_id + U+001F + key (the key may itself contain U+001F; split at the first one). */
function splitKey(localKey: string): [string, string] | null {
  const i = localKey.indexOf(US);
  return i < 0 ? null : [localKey.slice(0, i), localKey.slice(i + 1)];
}

export function createExtKvCodec(): RecordCodec {
  return {
    type: 'ext.kv',
    kind: 'ext.kv',
    version: 1,
    encode(localKey, ctx: CodecContext) {
      const parts = splitKey(localKey);
      if (!parts) return null;
      const row = ctx.sql.queryOne<Row>(
        'SELECT extension_id, key, value, updated_at FROM extension_storage WHERE extension_id = ? AND key = ?', parts);
      if (!row) return null;
      return { ext: String(row.extension_id), key: String(row.key), value: String(row.value), updatedAt: Number(row.updated_at) };
    },
    decode(d): DecodeResult {
      const { ext, key, value, updatedAt } = d;
      if (typeof ext !== 'string' || ext === '' || ext.includes(US) || typeof key !== 'string' || typeof value !== 'string'
        || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
        throw new RecordDecodeError('ext.kv: malformed record');
      }
      return { ok: true, row: { extension_id: ext, key, value, updated_at: updatedAt } };
    },
    upsert(row, _localKey, ctx) {
      const { extension_id: ext, key, value, updated_at: at } = row;
      if (typeof ext !== 'string' || typeof key !== 'string' || typeof value !== 'string' || typeof at !== 'number') {
        throw new Error('ext.kv: malformed row');
      }
      ctx.sql.execute(
        `INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (extension_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [ext, key, value, at]);
      return ext + US + key;
    },
    remove(localKey, ctx) {
      const parts = splitKey(localKey);
      if (parts) ctx.sql.execute('DELETE FROM extension_storage WHERE extension_id = ? AND key = ?', parts);
    },
    naturalKey(d) {
      return typeof d.ext === 'string' && typeof d.key === 'string' ? { scope: 'ext.kv', key: d.ext + US + d.key } : null;
    },
  };
}
