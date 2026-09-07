-- Optional per-module capability flags. Nothing here is specific to one module
-- type: a bible declares 'strongs' or 'morphology', a dictionary could declare
-- 'audio', a commentary 'greek_text'. Only BibleTranslation.sql includes it
-- today; any other schema that needs it adds the same one-line include rather
-- than a second definition.
CREATE TABLE module_feature (
    feature_id INTEGER PRIMARY KEY AUTOINCREMENT,   -- Row id. `feature_name` is the real identity --
                                                    -- see the UNIQUE on it below.
    feature_name TEXT NOT NULL UNIQUE,              -- What the module offers. Source of truth:
                                                    -- ModuleFeature in Data/Models/Main/
                                                    -- ModuleMetadata.ts. Open set, no CHECK:
                                                    --   'strongs_numbers'   Strong's numbers on words
                                                    --   'morphology'        Parsing codes
                                                    --   'interlinear'       Original-language alignment
                                                    --                       (interlinear_word rows)
                                                    --   'footnotes'         Translator footnotes
                                                    --   'cross_references'  Publisher cross-references
                                                    --   'red_letter'        Words of Christ marked
                                                    --   'section_headings'  Editorial headings
                                                    --   'word_occurrences'  Concordance occurrence data
                                                    -- NOTE the spelling is 'strongs_numbers' here,
                                                    -- while module_info.dictionary_type uses 'strongs'.
                                                    -- Different vocabularies; not interchangeable.
    is_enabled INTEGER DEFAULT 1,                   -- 0 = the module declares the feature but it is
                                                    -- turned off, e.g. shipped but incomplete data.
                                                    -- Absence of the row means "not offered at all";
                                                    -- these are different states.
    metadata TEXT,                                  -- JSON: feature-specific configuration

    CHECK (is_enabled IN (0, 1))
);
