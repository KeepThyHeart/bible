-- ENUM / CHECK POLICY
-- --------------------------
-- SQLite cannot ALTER a CHECK constraint: changing one requires rebuilding the
-- whole table (create-new / copy / drop / rename). A CHECK on a value set that is
-- expected to grow therefore turns a routine additive change into a migration of
-- every shipped module file. Consequently:
--
--   * KEEP a CHECK only for closed domain sets fixed by the domain itself --
--     `testament IN ('OT','NT')`, boolean 0/1 flags, and structural invariants
--     (`info_id = 1`, `verse_id > 0`).
--   * DROP the CHECK for open / extensible sets -- `module_type`,
--     `versification`, `license_spdx`, `format`, `feature_name`, and any future
--     vocabulary. These are validated in TypeScript at the repository boundary,
--     with the union types in `packages/core/src/Data/Core/Types.ts` as the single
--     source of truth.
--
CREATE TABLE module_info (
    info_id INTEGER PRIMARY KEY CHECK (info_id = 1),  -- Singleton guard: exactly one row

    -- Identity
    module_uuid TEXT NOT NULL,                      -- Stable identity across content revisions
                                                    -- (RFC 4122 UUID). This -- not `abbreviation`
                                                    -- -- is the cross-database join key.
    module_type TEXT NOT NULL,                      -- 'bible', 'commentary', 'dictionary', 'book',
                                                    -- 'devotional', 'cross_reference',
                                                    -- 'topical_index', 'tag_graph'. Open set with
                                                    -- no CHECK and no default: the writer states
                                                    -- it, TypeScript validates it. See the
                                                    -- per-schema note above for this file's value.
    abbreviation TEXT NOT NULL,                     -- "KJV", "TSK" (display / lookup convenience
                                                    -- only, never an identity key)
    full_name TEXT NOT NULL,                        -- "King James Version"

    -- Format + content versioning
    format TEXT NOT NULL,                           -- Container format name. Open set, no CHECK. One
                                                    -- per schema file: 'bible-module',
                                                    -- 'commentary-module', 'dictionary-module',
                                                    -- 'book-module', 'devotional-module',
                                                    -- 'topical-index-module',
                                                    -- 'cross-reference-module', 'tag-graph-module'.
                                                    -- Hyphenated, unlike module_type's underscores --
                                                    -- these are two vocabularies, not one.
    format_version TEXT NOT NULL DEFAULT '0.1',     -- Spec version this file conforms to
    content_version TEXT,                           -- The module's own content revision
    content_sha256 TEXT,                            -- Integrity / dedup hash of the content

    -- Descriptive
    author TEXT,                                    -- Translator, editor or compiler of the CONTENT --
                                                    -- "the Translators", "Matthew Henry". Not whoever
                                                    -- built the module file.
    publisher TEXT,                                 -- Publishing body, where the work has one
    year_published INTEGER,                         -- Year of the edition this module reproduces, not
                                                    -- of the module build. Four-digit; 0 means unknown
                                                    -- and is common in SWORD-derived modules.
    description TEXT,                               -- Freeform blurb for the module browser. May
                                                    -- contain markup inherited from the source
                                                    -- (SWORD-derived text can carry RTF escapes);
                                                    -- sanitise before rendering.
    language_code TEXT NOT NULL DEFAULT 'en',       -- Language of this module's CONTENT. ISO 639-1
                                                    -- two-letter where a code exists ("en", "es",
                                                    -- "he"); ISO 639-3 three-letter where none does --
                                                    -- 639-1 has no Ancient Greek or Biblical Hebrew, so
                                                    -- those are "grc" and "hbo". Lowercase, bare: no
                                                    -- region or script subtag.
    is_original_language INTEGER NOT NULL DEFAULT 0, -- 1 for a Hebrew/Greek text or lexicon
    right_to_left INTEGER NOT NULL DEFAULT 0,       -- 1 for Hebrew/Aramaic/Arabic/Syriac. Only two
                                                    -- directions exist for scripture: Unicode bidi
                                                    -- has exactly two, and vertical writing is CSS
                                                    -- writing-mode, not direction.

    -- Licensing + provenance
    copyright TEXT,                                 -- Freeform, DISPLAY ONLY. Never parsed to
                                                    -- infer licensing -- use license_spdx.
    license_spdx TEXT,                              -- SPDX identifier -- the machine-readable licence,
                                                    -- as opposed to freeform `copyright`. Open set, no
                                                    -- CHECK; any valid SPDX id is allowed. In use:
                                                    --   'PD'            Public domain (KJV, Webster's)
                                                    --   'CC-BY-4.0'     Attribution
                                                    --   'CC-BY-SA-4.0'  Attribution-ShareAlike
                                                    --   'CC-BY-ND-4.0'  Attribution-NoDerivatives
                                                    --   'Proprietary'   All rights reserved; not
                                                    --                   redistributable
                                                    -- NULL = unknown, which is NOT public domain --
                                                    -- treat it as restricted.
    license_url TEXT,                               -- Full terms
    source_url TEXT,                                -- Where this module came from

    -- Versification of the verse references this module makes or uses. The canon is
    -- always the 66-book Protestant canon and is not recorded; only the numbering
    -- within it varies: whether a Hebrew psalm title counts as verse 1, whether
    -- 3 John ends at 14 or 15, whether Malachi has 3 chapters or 4. A reference
    -- resolves to the wrong verse if two modules disagree, which is why every
    -- module type declares a scheme, not just a bible.
    versification TEXT NOT NULL DEFAULT 'kjv-english',  -- Numbering scheme name. Open set, no CHECK --
                                                    -- see the block just above and the enum policy.
                                                    --   'kjv-english'  The project default and the
                                                    --                  only scheme in use today
                                                    -- Names anticipated if other schemes are added:
                                                    -- 'nrsv', 'lxx', 'vulgate', 'mt' (Masoretic
                                                    -- numbering, where Hebrew psalm titles are
                                                    -- verse 1). Adding one means a mapping table, not
                                                    -- just a new string here.

    created_date TEXT DEFAULT CURRENT_TIMESTAMP,    -- ISO-8601 UTC when this module FILE was built.
                                                    -- Unrelated to year_published, which dates the
                                                    -- work itself.
    metadata TEXT,                                  -- JSON: anything not worth a column

    -- Closed sets only, per the enum policy
    CHECK (is_original_language IN (0, 1)),
    CHECK (right_to_left IN (0, 1))
);
