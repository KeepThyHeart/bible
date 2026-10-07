'use strict';

/**
 * Word Count — a reference extension for the Bible desktop app.
 *
 * Listens for the active verse to change, fetches the full chapter, counts the
 * words, and shows the total in the status bar and as a badge on its own app
 * ("Word Count" in the app switcher). The app view (ui/app.html) asks this
 * worker for the chapter statistics over the panel channel.
 */

var APP_ID = 'counts';
var APP_PANEL_ID = 'app:' + APP_ID;
var STATUS_ID = 'ext.bible-app.word-count.display';
var OPEN_COMMAND = 'ext.bible-app.word-count.open';

var STOP_WORDS = new Set((
  'a about after all also an and any are as at be been but by can did do for from had has have he her him his how i if ' +
  'in into is it its me my no not o of on or our shall she so than that the their them then there these they this ' +
  'those thou thee thy to unto up us was we were what when which who will with ye you your'
).split(' '));

/** @type {Map<number, object>} chapter key (book*1000+chapter) -> stats */
var statsCache = new Map();
/** @type {object | null} stats of the chapter the user is in */
var current = null;
var appVisible = false;
var bookNames = null;


/** @type {import('@bible/core/Extensions/ExtensionApiDtos').DisposableHandle | null} */
let statusBarHandle = null;

/** @type {import('@bible/core/Extensions/ExtensionApiDtos').DisposableHandle | null} */
let eventHandle = null;

/** @type {Array<{ dispose(): Promise<void> | void }>} */
var otherHandles = [];

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

/** '342', '1.2k' (at most 4 characters). */
function compact(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  return Math.round(n / 1000000) + 'M';
}

/** Lower-cased words of a text, letters and inner apostrophes only. */
function tokenize(text) {
  return (text.toLowerCase().match(/[\p{L}]+(?:['\u2019][\p{L}]+)*/gu)) || [];
}

/**
 * Statistics for one chapter's verses.
 * @param {Array<{ verseId: number, text: string, textPlain?: string }>} verses
 */
function computeStats(verses, reference) {
  var freq = new Map();
  var perVerse = [];
  var total = 0;
  for (var i = 0; i < verses.length; i++) {
    var plain = verses[i].textPlain || stripHtml(verses[i].text);
    var n = countWords(plain);
    total += n;
    perVerse.push({ verse: parseVerseId(verses[i].verseId).verse, words: n });
    var toks = tokenize(plain);
    for (var j = 0; j < toks.length; j++) {
      if (STOP_WORDS.has(toks[j]) || toks[j].length < 2) continue;
      freq.set(toks[j], (freq.get(toks[j]) || 0) + 1);
    }
  }
  var topWords = Array.from(freq.entries())
    .sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); })
    .slice(0, 10)
    .map(function (e) { return { word: e[0], count: e[1] }; });
  return { reference: reference, total: total, verseCount: verses.length, topWords: topWords, perVerse: perVerse };
}

async function bookName(api, book) {
  try {
    if (!bookNames) {
      bookNames = new Map();
      var books = await api.bible.listBooks();
      for (var i = 0; i < books.length; i++) {
        var nm = books[i].name;
        bookNames.set(books[i].bookNumber, typeof nm === 'string' ? nm : books[i].shortName);
      }
    }
  } catch (err) {
    bookNames = bookNames || new Map();
  }
  return bookNames.get(book) || 'Book ' + book;
}

async function statsFor(api, verseId) {
  var parsed = parseVerseId(verseId);
  var key = parsed.book * 1000 + parsed.chapter;
  var hit = statsCache.get(key);
  if (hit) return hit;
  // Verse 1 through 200 (generous upper bound; the API returns only verses that exist).
  var verses = await api.bible.getRange(
    makeVerseId(parsed.book, parsed.chapter, 1),
    makeVerseId(parsed.book, parsed.chapter, 200),
  );
  var stats = computeStats(verses, (await bookName(api, parsed.book)) + ' ' + parsed.chapter);
  statsCache.set(key, stats);
  if (statsCache.size > 20) statsCache.delete(statsCache.keys().next().value);
  return stats;
}

function pushStats(api) {
  if (!api.apps || !appVisible || !current) return Promise.resolve();
  return api.panels.postMessage({ type: 'stats', stats: current }, { panelId: APP_PANEL_ID }).catch(function () {});
}

async function setBadge(api, stats) {
  if (!api.apps) return;
  try {
    await api.apps.setBadge(APP_ID, stats === null ? null : {
      kind: 'text',
      value: compact(stats.total),
      tone: 'neutral',
      label: stats.total + ' words in this chapter',
    });
  } catch (err) {
    console.error('[word-count] badge failed:', err);
  }
}

/**
 * Called by the extension host when this extension is activated.
 * @param {import('@bible/core/Extensions/ExtensionApiTypes').BibleExtensionAPI} api
 */
exports.activate = async function activate(api) {
  // Register a status bar item on the right side. Clicking it runs the
  // "Word Count: Open" command, which opens the app.
  statusBarHandle = await api.ui.registerStatusBarItem({
    id: STATUS_ID,
    text: 'Words: --',
    tooltip: 'Word count for the current chapter',
    command: OPEN_COMMAND,
    alignment: 'right',
    priority: 100,
  });

  // The command is declared in extension.json with `handlerEndpoint: 'openApp'`;
  // this binds that endpoint. `api.apps` is absent on hosts without extension apps.
  otherHandles.push(
    await api.runtime.expose('openApp', async function openApp() {
      if (!api.apps) return false;
      return api.apps.open(APP_ID);
    }),
  );

  // The app view asks for stats on load; there is one channel per extension.
  otherHandles.push(
    await api.panels.onMessage(async function onPanelMessage(message) {
      if (message && message.type === 'getStats') return current;
      throw new Error('unknown request');
    }),
  );

  if (api.apps) {
    otherHandles.push(
      await api.apps.onDidChangeVisibility(function onVisibility(e) {
        if (e.appId !== APP_ID) return;
        appVisible = e.visible;
        if (e.visible) void pushStats(api);
      }),
    );
  }

  // Each verse change only updates the item's text and tooltip (patched in
  // place) and, when the chapter changed, the app badge and the open app view.
  eventHandle = await api.events.subscribe(
    'verse.activeChanged',
    async function onVerseChanged(payload) {
      if (!payload) {
        current = null;
        await api.ui.updateStatusBarItem(STATUS_ID, {
          text: 'Words: --',
          tooltip: 'Word count for the current chapter',
        });
        await setBadge(api, null);
        return;
      }

      try {
        var stats = await statsFor(api, payload.verseId);
        var changed = current !== stats;
        current = stats;

        await api.ui.updateStatusBarItem(STATUS_ID, {
          text: 'Words: ' + stats.total,
          tooltip: 'Word count for ' + stats.reference + ' (' + stats.verseCount + ' verses)',
        });
        if (changed) {
          await setBadge(api, stats);
          await pushStats(api);
        }
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
  for (var i = 0; i < otherHandles.length; i++) {
    await otherHandles[i].dispose();
  }
  otherHandles = [];
  if (statusBarHandle) {
    await statusBarHandle.dispose();
    statusBarHandle = null;
  }
  current = null;
  appVisible = false;
  statsCache.clear();
};
