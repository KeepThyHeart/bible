'use strict';

/**
 * Word Count app view. Runs in a sandboxed ext-ui:// iframe: it has no api.* of
 * its own. It asks the extension's worker (src/main.js) for statistics over the
 * host bridge and draws them.
 *
 * This example ships without a bundler, so instead of importing
 * @bible/extension-ui it speaks the same tiny postMessage RPC the SDK's
 * RpcClient does (`panel.invoke` for requests, `panel.message` for pushes).
 * With a bundler, replace `invoke` / `onPush` with
 * `BibleExtUI.init().postToWorker(msg)` and `.onWorkerMessage(cb)`.
 */
(function () {
  var seq = 0;
  var pending = new Map();
  var pushHandlers = [];

  window.addEventListener('message', function (event) {
    var d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.kind === 'response') {
      var p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      clearTimeout(p.timer);
      if (d.error) p.reject(new Error(d.error.message)); else p.resolve(d.result);
    } else if (d.kind === 'event' && d.channel === 'panel.message') {
      pushHandlers.forEach(function (h) { h(d.payload); });
    } else if (d.kind === 'event' && d.channel === 'theme.changed') {
      var t = d.payload && d.payload.mode;
      if (typeof t === 'string') relinkTheme(t);
    }
  });

  function request(method, args) {
    return new Promise(function (resolve, reject) {
      var id = 'wc-' + Date.now() + '-' + (++seq);
      var timer = setTimeout(function () { pending.delete(id); reject(new Error('timeout: ' + method)); }, 10000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      window.parent.postMessage({ kind: 'request', id: id, method: method, args: args || [] }, '*');
    });
  }

  /** Swap the host token sheet when the user changes theme (keeps the old one until the new loads). */
  function relinkTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
    var old = document.querySelector('link[href^="ext-ui://host/theme.css"]');
    var next = document.createElement('link');
    next.rel = 'stylesheet';
    next.href = 'ext-ui://host/theme.css?theme=' + encodeURIComponent(id);
    next.onload = function () { if (old) old.remove(); };
    document.head.appendChild(next);
  }

  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat();

  function bars(list, items, labelOf, valueOf) {
    list.textContent = '';
    var max = 1;
    items.forEach(function (it) { max = Math.max(max, valueOf(it)); });
    items.forEach(function (it) {
      var li = document.createElement('li');
      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = labelOf(it);
      var track = document.createElement('span');
      track.className = 'track';
      var fill = document.createElement('span');
      fill.className = 'fill';
      fill.style.inlineSize = Math.round((valueOf(it) / max) * 100) + '%';
      track.appendChild(fill);
      var num = document.createElement('span');
      num.className = 'num';
      num.textContent = nf.format(valueOf(it));
      li.append(label, track, num);
      list.appendChild(li);
    });
  }

  function render(stats) {
    var has = stats && typeof stats.total === 'number';
    $('empty').hidden = has;
    $('content').hidden = !has;
    if (!has) return;
    $('ref').textContent = stats.reference;
    $('total').textContent = nf.format(stats.total);
    $('verses').textContent = nf.format(stats.verseCount);
    bars($('top'), stats.topWords, function (w) { return w.word; }, function (w) { return w.count; });
    bars($('perverse'), stats.perVerse, function (v) { return String(v.verse); }, function (v) { return v.words; });
  }

  pushHandlers.push(function (msg) {
    if (msg && msg.type === 'stats') render(msg.stats);
  });

  request('panel.invoke', [{ type: 'getStats' }])
    .then(render)
    .catch(function () { render(null); });
})();
