-- A row exists iff frames were encoded against a dictionary; module_info.compression
-- = 'none' means this table is empty. See module_info.compression for the codec
-- vocabulary.
CREATE TABLE compression_dictionary (
    codec        TEXT PRIMARY KEY,   -- matches module_info.compression
    dict_id      INTEGER NOT NULL,   -- zstd dictID, or Adler-32 of dict_blob for deflate
    dict_blob    BLOB NOT NULL,      -- <= 128 KiB; 32 KiB for deflate, 110 KiB for zstd
    trained_from TEXT,               -- JSON provenance: {samples, bytes, tool, level, seed}
    created_date TEXT DEFAULT CURRENT_TIMESTAMP
);
