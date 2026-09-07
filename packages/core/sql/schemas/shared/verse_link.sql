-- WHAT THE COLUMNS MEAN
-- ---------------------
-- A `verse_link` row says: "this piece of content points at this passage."
--
--   source_type   The OWNER of the link: the name of the table, IN THIS DATABASE,
--   source_id     The ID of the content record which contains the verse link.  This 
--                 varies by module type; e.g., a commentary entry, a book section, or a
--                 verse in a Bible module (for cross-references).
--   verse_id_start / verse_id_end
--                 The TARGET of the link: the passage being pointed AT. Inclusive
--                 at both ends; a single verse is `verse_id_end = verse_id_start`.
--   link_type     What kind of pointing this is -- 'reference' (a plain citation),
--                 'primary_passage' (the passage the content is chiefly about),
--                 'annotation', 'cross_reference'.
--   sort_order    Display order among the links belonging to one owner row.
--   context       Optional freeform note carried with this single link, e.g. the
--                 phrase that prompted it.
--   metadata      JSON: anything else.
--
-- Worked example -- a cross-reference from John 3:16 to Genesis 3:15, as a
-- cross-reference module stores it:
--
--   cross_reference_group  group_id = 7,
--                          verse_id_start = verse_id_end = 43003016   <- John 3:16,
--                          phrase = 'For God so loved the world'
--   verse_link             source_type = 'cross_reference_group', source_id = 7,
--                          verse_id_start = verse_id_end = 1003015    <- Gen 3:15,
--                          link_type = 'cross_reference'
--
-- So John 3:16 -- the verse the reference hangs off -- lives in the OWNER row, and
-- Genesis 3:15 -- the verse pointed at -- lives in the `verse_link` row. Forward
-- lookup ("what does this content cite?") drives off (source_type, source_id);
-- reverse lookup ("what cites verse V?") drives off the verse_id range and joins
-- back to the owner table.
--
-- no CHECK on verse_link.source_type or verse_link.link_type. Both are
-- open/extensible sets; validation lives in TypeScript
-- (packages/core/src/Data/Core/Types.ts) and is enforced at the repository boundary.
--
CREATE TABLE verse_link (
    link_id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- Row id; nothing references it
    source_type     TEXT NOT NULL,                  -- Owning table; see the block above. Source of
                                                    -- truth: SOURCE_TYPES in Data/Core/Types.ts. Open
                                                    -- set, no CHECK. One value per content table that
                                                    -- can cite scripture:
                                                    --   In module databases --
                                                    --     'commentary_entry', 'book_section',
                                                    --     'dictionary_entry', 'devotional_entry',
                                                    --     'topic', 'cross_reference_group',
                                                    --     'verse' (a bible module shipping the
                                                    --      publisher's own cross-references),
                                                    --     'entity_facet' (tag graph -- its only
                                                    --      integer-keyed link source; the graph's
                                                    --      slug-keyed links use entity_verse_link)
                                                    --   In the user database --
                                                    --     'note', 'journal', 'prayer', 'document'
    source_id       INTEGER NOT NULL,               -- Owning row's key. Never a verse_id
    verse_id_start  INTEGER NOT NULL,               -- Target passage, inclusive
    verse_id_end    INTEGER NOT NULL,               -- inclusive; single verse is expressed as end = start
    link_type       TEXT NOT NULL DEFAULT 'reference',  -- What kind of pointing this is. Source of
                                                    -- truth: LINK_TYPES in Data/Core/Types.ts. Open
                                                    -- set, no CHECK:
                                                    --   'reference'        A plain citation (default)
                                                    --   'primary_passage'  The passage the content is
                                                    --                      chiefly about, as opposed to
                                                    --                      one it merely mentions
                                                    --   'annotation'       A note attached to the verse
                                                    --   'cross_reference'  A see-also link between
                                                    --                      passages
    sort_order      INTEGER NOT NULL DEFAULT 0,     -- Display order within one owner
    context         TEXT,                           -- Freeform note carried with this one link
    metadata        TEXT                            -- JSON
);

CREATE INDEX idx_verse_link_source ON verse_link(source_type, source_id, sort_order);
CREATE INDEX idx_verse_link_start  ON verse_link(verse_id_start);
CREATE INDEX idx_verse_link_range  ON verse_link(verse_id_start, verse_id_end);
-- R-2: the reverse pair, so a containment probe (start <= X AND end >= X) can be
-- driven from either side. Cheap, and only useful once end is NOT NULL.
CREATE INDEX idx_verse_link_covering ON verse_link(verse_id_end, verse_id_start);
