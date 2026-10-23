/**
 * The screen page the Presenter server hands to a browser: plain HTML, one script and one
 * stylesheet, no dependencies and no build step. Served from three separate URLs so the page's
 * CSP can stay `script-src 'self'` / `style-src 'self'` (no inline code at all).
 *
 * It renders `PresentSnapshot`s from the `events` stream. Verse text goes in with `textContent`
 * only. A connection drop never changes what is on screen (EventSource reconnects by itself);
 * only an explicit `closed` event ends the display.
 */

export const VIEWER_HTML = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Presentation</title>
<link rel="stylesheet" href="viewer.css">
</head>
<body>
<main id="wall" aria-live="polite">
  <p id="status">Waiting for the presenter&hellip;</p>
  <h1 id="ref" hidden></h1>
  <div id="verses"></div>
</main>
<p id="hint" hidden>Press F for full screen</p>
<script src="viewer.js"></script>
</body>
</html>
`;

export const VIEWER_CSS = `
:root { --bg: #0b0d10; --fg: #f1f1ee; --dim: #8b9099; --accent: #f2c14e; }
[data-theme="light"] { --bg: #fbfaf6; --fg: #15171a; --dim: #6a6f78; --accent: #b4540a; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); }
body { font-family: Georgia, "Times New Roman", serif; overflow: hidden; }
#wall { box-sizing: border-box; height: 100%; overflow-y: auto; padding: 4vh 6vw 30vh; --size: 3.2vmin; font-size: var(--size); line-height: 1.5; scroll-behavior: smooth; }
body.blanked #wall { visibility: hidden; }
#status { margin: 30vh 0 0; text-align: center; color: var(--dim); font-size: 0.8em; }
#ref { margin: 0 0 0.6em; font-size: 0.8em; letter-spacing: 0.04em; color: var(--accent); font-weight: 600; }
.v { margin: 0 0 0.5em; opacity: 0.45; transition: opacity 0.2s; }
.v.focus { opacity: 1; }
.v sup { font-size: 0.55em; margin-right: 0.35em; color: var(--accent); font-family: system-ui, sans-serif; }
#hint { position: fixed; right: 1rem; bottom: 0.6rem; margin: 0; font: 12px system-ui, sans-serif; color: var(--dim); opacity: 0.8; }
`;

export const VIEWER_JS = `(function () {
  'use strict';
  var wall = document.getElementById('wall');
  var statusEl = document.getElementById('status');
  var refEl = document.getElementById('ref');
  var versesEl = document.getElementById('verses');
  var hint = document.getElementById('hint');
  var shownVersion = -1;
  var shownPassage = '';

  function render(s) {
    if (typeof s.version !== 'number' || s.version < shownVersion) return;
    shownVersion = s.version;
    document.documentElement.setAttribute('data-theme', s.display.theme === 'light' ? 'light' : 'dark');
    document.body.classList.toggle('blanked', !!s.display.blanked);
    wall.style.setProperty('--size', (3.2 * Math.pow(1.14, s.display.fontStep || 0)) + 'vmin');
    if (!s.live) {
      statusEl.hidden = false;
      statusEl.textContent = 'Waiting for the presenter\\u2026';
      refEl.hidden = true;
      versesEl.textContent = '';
      shownPassage = '';
      return;
    }
    statusEl.hidden = true;
    refEl.hidden = false;
    refEl.textContent = s.live.reference;
    var key = s.live.module + '|' + s.live.reference + '|' + s.live.verses.length;
    if (key !== shownPassage) {
      shownPassage = key;
      versesEl.textContent = '';
      s.live.verses.forEach(function (v) {
        var p = document.createElement('p');
        p.className = 'v';
        p.dataset.verse = String(v.verse);
        var n = document.createElement('sup');
        n.textContent = String(v.verse);
        p.appendChild(n);
        p.appendChild(document.createTextNode(v.text));
        versesEl.appendChild(p);
      });
    }
    var focusEl = null;
    Array.prototype.forEach.call(versesEl.children, function (el) {
      var on = Number(el.dataset.verse) === s.live.focus;
      el.classList.toggle('focus', on);
      if (on) focusEl = el;
    });
    if (focusEl) focusEl.scrollIntoView({ block: 'center' });
  }

  var source = new EventSource('events');
  source.addEventListener('state', function (e) {
    try { render(JSON.parse(e.data)); } catch (err) { /* keep what is on screen */ }
  });
  source.addEventListener('closed', function () {
    source.close();
    statusEl.hidden = false;
    statusEl.textContent = 'The presentation has ended.';
    refEl.hidden = true;
    versesEl.textContent = '';
  });

  hint.hidden = !document.fullscreenEnabled;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(function () {});
    }
  });
  document.addEventListener('fullscreenchange', function () { hint.hidden = !!document.fullscreenElement; });
})();
`;
