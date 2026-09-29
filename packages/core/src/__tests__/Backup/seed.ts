import type { ISql } from '../../Data/Core/ISql';

/** A small but fully connected data set touching every content table. */
export function seedRich(db: ISql, tag = ''): void {
  const x = (sql: string, p: unknown[] = []) => db.execute(sql, p as never[]);
  x("INSERT INTO user_commentary (name, is_default, color) VALUES (?, 1, '#112233')", [`Default${tag}`]);
  x("INSERT INTO user_commentary (name, is_default) VALUES (?, 0)", [`Sermons${tag}`]);
  // note tree: 1 <- 2 <- 3, plus a loose one
  x("INSERT INTO user_note (user_commentary_id, title, content, note_type, created_date) VALUES (1, ?, '<p>root</p>', 'document', '2026-01-01 10:00:00')", [`Root${tag}`]);
  x("INSERT INTO user_note (user_commentary_id, parent_note_id, title, content, sort_order, created_date) VALUES (1, 1, ?, 'child', 1, '2026-01-02 10:00:00')", [`Child${tag}`]);
  x("INSERT INTO user_note (user_commentary_id, parent_note_id, title, content, sort_order, created_date) VALUES (2, 2, ?, 'grandchild', 2, '2026-01-03 10:00:00')", [`Grand${tag}`]);
  x("INSERT INTO user_note (title, verse_id_start, verse_id_end, content, created_date) VALUES (?, 43003016, 43003016, 'John 3:16 note', '2026-01-04 10:00:00')", [`Loose${tag}`]);
  x("INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end, link_type) VALUES ('note', 4, 43003016, 43003016, 'primary_passage')");
  x("INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end) VALUES ('document', 1, 45001001, 45001007)");
  x("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color, note_id, created_date) VALUES (1, 43003016, 43003016, '#FFF3A3', 4, '2026-02-01 00:00:00')");
  x("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color, created_date) VALUES (1, 43003017, 43003017, '#B7E4C7', '2026-02-02 00:00:00')");
  x("INSERT INTO collection (name, sort_order) VALUES (?, 0)", [`Top${tag}`]);
  x("INSERT INTO collection (parent_collection_id, name, sort_order) VALUES (1, ?, 1)", [`Sub${tag}`]);
  x("INSERT INTO pinned_item (collection_id, item_type, verse_id_start, verse_id_end, sort_order, created_date) VALUES (2, 'verse', 19023001, 19023001, 0, '2026-03-01 00:00:00')");
  x("INSERT INTO pinned_item (collection_id, item_type, reference_id, sort_order, title, created_date) VALUES (1, 'note', 1, 1, 'pinned note', '2026-03-02 00:00:00')");
  x("INSERT INTO reading_plan (name, plan_type, is_builtin) VALUES (?, 'sequential', 0)", [`Plan${tag}`]);
  x("INSERT INTO reading_plan_day (plan_id, day_number) VALUES (1, 1), (1, 2)");
  x("INSERT INTO reading_plan_passage (day_id, verse_id_start, verse_id_end, sort_order) VALUES (1, 1001001, 1001031, 0), (2, 1002001, 1002025, 0)");
  x("INSERT INTO user_reading_progress (plan_id, start_date, current_day) VALUES (1, '2026-04-01', 2)");
  x("INSERT INTO prayer_item (title, status, created_date) VALUES (?, 'active', '2026-05-01 00:00:00')", [`Pray${tag}`]);
  x("INSERT INTO prayer_update (prayer_id, update_text, update_date) VALUES (1, 'update', '2026-05-02 00:00:00')");
  x("INSERT INTO journal_entry (title, content, entry_date, created_date) VALUES (?, 'today', '2026-05-03', '2026-05-03 00:00:00')", [`Journal${tag}`]);
  x("INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end) VALUES ('journal', 1, 19023001, 19023001), ('prayer', 1, 19023002, 19023002)");
  x("INSERT INTO user_data_item (owner_uuid, collection, item_key, value, modified_date) VALUES ('app:x', 'c', 'k', '1', '2026-06-01 00:00:00')");
  x("INSERT INTO user_cross_reference (from_verse_id_start, from_verse_id_end, to_verse_id_start, to_verse_id_end, created_date) VALUES (1, 1, 2, 2, '2026-06-02 00:00:00')");
  x("INSERT INTO session (name, session_data, is_default, created_date) VALUES ('Saved', '{\"tabs\":[]}', 0, '2026-07-01 00:00:00'), ('Auto', '{}', 0, '2026-07-02 00:00:00')");
  x("UPDATE session SET is_autosave = 1 WHERE name = 'Auto'");
  x("INSERT INTO navigation_history (session_id, tab_id, module_id, verse_id_start, verse_id_end, navigation_date) VALUES (1, 't1', 1, 43003016, 43003016, '2026-07-03 00:00:00')");
  x("INSERT INTO user_search_history (query, search_date) VALUES ('grace', '2026-07-04 00:00:00')");
  x("INSERT INTO setting (category, key, value) VALUES ('ui', 'zoom', '110'), ('system', 'schema', '9')");
  x("INSERT INTO layout_preset (name, layout_data, is_stock, created_date) VALUES ('Mine', '{}', 0, '2026-07-05 00:00:00'), ('Stock', '{}', 1, '2026-07-05 00:00:00')");
  x("INSERT INTO module_display_option (module_id, option_key, option_value) VALUES (1, 'showStrongs', 'true')");
  x("INSERT INTO extension_storage VALUES ('ext.a.mem', 'k1', '1', 100), ('ext.a.mem', 'k2', '2', 200), ('ext.b.other', 'z', '\"z\"', 50)");
  x("INSERT INTO user_keybindings VALUES ('cmd.a', 'ctrl+k', NULL, NULL)");
  x("INSERT INTO command_history VALUES ('cmd.a', 1000, 5)");
}
