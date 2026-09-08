'use strict';

/**
 * Word Count — a reference extension for the Bible desktop app.
 *
 * Listens for the active verse to change, fetches the full chapter,
 * counts the words, and displays the total in the status bar.
 */

/** @type {import('@bible/core/Extensions/ExtensionApiDtos').DisposableHandle | null} */
let statusBarHandle = null;

/** @type {import('@bible/core/Extensions/ExtensionApiDtos').DisposableHandle | null} */
let eventHandle = null;

/**
 * Strip HTML tags from a string (verse text may contain inline markup).
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Count words in a plain-text string.
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Parse a verse ID into its components.
 * verse_id = (book * 1_000_000) + (chapter * 1_000) + verse
 * @param {number} verseId
 * @returns {{ book: number, chapter: number, verse: number }}
 */
function parseVerseId(verseId) {
  const book = Math.floor(verseId / 1000000);
  const remainder = verseId % 1000000;
  const chapter = Math.floor(remainder / 1000);
  const verse = remainder % 1000;
  return { book, chapter, verse };
}

/**
 * Build a verse ID from components.
 * @param {number} book
 * @param {number} chapter
 * @param {number} verse
 * @returns {number}
 */
function makeVerseId(book, chapter, verse) {
  return book * 1000000 + chapter * 1000 + verse;
}

/**
 * Called by the extension host when this extension is activated.
 * @param {import('@bible/core/Extensions/ExtensionApiTypes').BibleExtensionAPI} api
 */
exports.activate = async function activate(api) {
  // Register a status bar item on the right side
  statusBarHandle = await api.ui.registerStatusBarItem({
    id: 'ext.bible-app.word-count.display',
    text: 'Words: --',
    tooltip: 'Word count for the current chapter',
    alignment: 'right',
    priority: 100,
  });

  // Listen for active verse changes
  eventHandle = await api.bible.onDidChangeActiveVerse.subscribe(
    async function onVerseChanged(payload) {
      if (!payload) {
        // No active verse — reset display
        await api.ui.registerStatusBarItem({
          id: 'ext.bible-app.word-count.display',
          text: 'Words: --',
          tooltip: 'Word count for the current chapter',
          alignment: 'right',
          priority: 100,
        });
        return;
      }

      try {
        var verseId = payload.verseId;
        var parsed = parseVerseId(verseId);

        // Fetch the full chapter: verse 1 through verse 200 (generous upper bound;
        // the API returns only verses that exist).
        var startId = makeVerseId(parsed.book, parsed.chapter, 1);
        var endId = makeVerseId(parsed.book, parsed.chapter, 200);
        var verses = await api.bible.getRange(startId, endId);

        // Sum word counts across all verses in the chapter
        var totalWords = 0;
        for (var i = 0; i < verses.length; i++) {
          // Prefer the plain-text field if available; fall back to stripping HTML
          var plain = verses[i].textPlain || stripHtml(verses[i].text);
          totalWords += countWords(plain);
        }

        // Update the status bar
        await api.ui.registerStatusBarItem({
          id: 'ext.bible-app.word-count.display',
          text: 'Words: ' + totalWords,
          tooltip:
            'Word count for chapter ' +
            parsed.chapter +
            ' (' +
            verses.length +
            ' verses)',
          alignment: 'right',
          priority: 100,
        });
      } catch (err) {
        // Silently handle errors — the status bar just keeps its last value
        console.error('[word-count] Error counting words:', err);
      }
    },
  );
};

/**
 * Called by the extension host when this extension is deactivated.
 */
exports.deactivate = async function deactivate() {
  if (eventHandle) {
    await eventHandle.dispose();
    eventHandle = null;
  }
  if (statusBarHandle) {
    await statusBarHandle.dispose();
    statusBarHandle = null;
  }
};
