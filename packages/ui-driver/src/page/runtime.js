/*
 * Page-side runtime of the UI driver, injected into every document as a plain
 * script (kept as .js so no transpiler can alter it). Installs `window.__uid`:
 *
 *   snap({ nextRef, seed })   compact accessibility tree with refs
 *   resolve(ref)              the element behind a ref, or null when it is gone
 *   hint(ref)                 how a Playwright script can find it again
 *   settle(quietMs, maxMs)    resolves once the DOM stops changing
 *   audit(kinds)              cheap heuristics (see AuditItem in types.ts)
 *   focusRef()                ref of the focused element, or 'body'
 *
 * Refs: every emitted element gets `r<N>`. An element keeps its ref while it is
 * connected. When a framework replaces an element by an equivalent one (same
 * role, name and parent ref), the newcomer adopts the old ref, so remounts do
 * not churn refs. Numbers never repeat in a session: Node passes its counter.
 */
(function () {
  if (window.__uid) return;

  /** ref -> WeakRef(Element) */
  const refs = new Map();
  /** Element -> ref */
  const byEl = new WeakMap();
  /** ref -> signature (role|name|parentRef) */
  const sigOf = new Map();
  /** signature -> [refs], for adoption */
  let seedSigs = new Map();
  let counter = 1;
  let scopedWalk = false;
  let walks = 0;
  let visibleOnly = false;
  let scopeRoot = null;
  /** Refs emitted by the last full walk: what audits look at (an older ref may sit under aria-hidden). */
  let lastSeen = new Set();
  let walkClaimed = new Set();

  const INTERACTIVE = new Set([
    'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider',
    'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem',
    'clickable', 'listbox', 'gridcell',
  ]);
  /** Structural roles worth a line of their own. Others are flattened. */
  const STRUCTURAL = new Set([
    'dialog', 'alertdialog', 'alert', 'menu', 'menubar', 'tablist', 'tabpanel', 'list', 'grid', 'table',
    'tree', 'toolbar', 'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'search',
    'heading', 'img', 'progressbar', 'meter', 'status', 'iframe', 'form', 'region', 'group', 'radiogroup',
    'article', 'figure', 'tooltip', 'log', 'marquee', 'timer', 'separator', 'row', 'listitem', 'cell',
    'columnheader', 'rowheader', 'feed',
  ]);
  /** Structural roles emitted only when they have a name. */
  const NAMED_ONLY = new Set(['form', 'region', 'group', 'article', 'figure', 'separator', 'listitem', 'row', 'cell', 'status']);
  const NAME_FROM_CONTENT = new Set([
    'button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem',
    'heading', 'checkbox', 'radio', 'switch', 'clickable', 'tooltip', 'cell', 'gridcell', 'columnheader',
    'rowheader', 'row',
  ]);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'svg', 'SVG', 'PATH']);
  const NAME_MAX = 60;
  const TEXT_MAX = 80;

  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function implicitRole(el) {
    const tag = el.tagName;
    switch (tag) {
      case 'A': case 'AREA': return el.hasAttribute('href') ? 'link' : '';
      case 'BUTTON': case 'SUMMARY': return 'button';
      case 'INPUT': {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'hidden') return 'none';
        if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
        if (t === 'checkbox') return el.getAttribute('role') === 'switch' ? 'switch' : 'checkbox';
        if (t === 'radio') return 'radio';
        if (t === 'range') return 'slider';
        if (t === 'number') return 'spinbutton';
        if (t === 'search') return el.hasAttribute('list') ? 'combobox' : 'searchbox';
        if (t === 'file') return 'button';
        if (t === 'color' || t === 'date' || t === 'time' || t === 'datetime-local' || t === 'month' || t === 'week') return 'textbox';
        return el.hasAttribute('list') ? 'combobox' : 'textbox';
      }
      case 'SELECT': return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
      case 'OPTION': return 'option';
      case 'TEXTAREA': return 'textbox';
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return 'heading';
      case 'NAV': return 'navigation';
      case 'MAIN': return 'main';
      case 'HEADER': return el.closest('article,aside,main,nav,section') ? '' : 'banner';
      case 'FOOTER': return el.closest('article,aside,main,nav,section') ? '' : 'contentinfo';
      case 'ASIDE': return 'complementary';
      case 'FORM': return 'form';
      case 'SECTION': return 'region';
      case 'DIALOG': return 'dialog';
      case 'UL': case 'OL': case 'MENU': return 'list';
      case 'LI': return 'listitem';
      case 'TABLE': return 'table';
      case 'TR': return 'row';
      case 'TD': return 'cell';
      case 'TH': return 'columnheader';
      case 'IMG': return el.getAttribute('alt') === '' ? 'none' : 'img';
      case 'PROGRESS': return 'progressbar';
      case 'METER': return 'meter';
      case 'FIELDSET': return 'group';
      case 'DETAILS': return 'group';
      case 'IFRAME': return 'iframe';
      case 'HR': return 'separator';
      case 'ARTICLE': return 'article';
      case 'FIGURE': return 'figure';
      case 'SEARCH': return 'search';
      default: return '';
    }
  }

  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    if (explicit && explicit !== 'presentation' && explicit !== 'none' && explicit !== 'generic') return explicit;
    if (explicit === 'presentation' || explicit === 'none') return 'none';
    const r = implicitRole(el);
    if (r) return r;
    if (el.isContentEditable && (!el.parentElement || !el.parentElement.isContentEditable)) return 'textbox';
    return '';
  }

  /** Text of an element for name-from-content, skipping hidden parts. */
  function contentText(el, depth) {
    if (depth > 6) return '';
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        if (n.getAttribute('aria-hidden') === 'true' || SKIP_TAGS.has(n.tagName)) {
          if (n.tagName === 'svg' || n.tagName === 'SVG') {
            const t = n.querySelector && n.querySelector('title');
            if (t && n.getAttribute('aria-hidden') !== 'true') out += ' ' + t.textContent;
          }
          continue;
        }
        if (n.tagName === 'IMG') { out += ' ' + (n.getAttribute('alt') || ''); continue; }
        const al = n.getAttribute('aria-label');
        if (al) { out += ' ' + al; continue; }
        if (n.tagName === 'BR') { out += ' '; continue; }
        out += ' ' + contentText(n, depth + 1) + ' ';
      }
    }
    return out;
  }

  function idsText(el, attr) {
    const ids = (el.getAttribute(attr) || '').trim();
    if (!ids) return '';
    const root = el.getRootNode();
    return ids.split(/\s+/).map((id) => {
      const t = root.getElementById ? root.getElementById(id) : document.getElementById(id);
      return t ? (t.getAttribute('aria-label') || contentText(t, 0)) : '';
    }).join(' ');
  }

  function nameOf(el, role) {
    let n = idsText(el, 'aria-labelledby');
    if (!squash(n)) n = el.getAttribute('aria-label') || '';
    if (!squash(n) && el.labels && el.labels.length && el.type !== 'hidden') {
      n = Array.from(el.labels).map((l) => contentText(l, 0)).join(' ');
    }
    if (!squash(n)) {
      const tag = el.tagName;
      if (tag === 'IMG' || tag === 'AREA') n = el.getAttribute('alt') || '';
      else if (tag === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) n = el.value || (el.type === 'submit' ? 'Submit' : el.type === 'reset' ? 'Reset' : '');
      else if (tag === 'INPUT' && el.type === 'image') n = el.alt || '';
      else if (tag === 'FIELDSET') { const lg = el.querySelector(':scope > legend'); n = lg ? contentText(lg, 0) : ''; }
      else if (tag === 'TABLE') { const c = el.querySelector(':scope > caption'); n = c ? contentText(c, 0) : ''; }
      else if (tag === 'IFRAME') n = el.getAttribute('title') || '';
      else if (NAME_FROM_CONTENT.has(role)) n = contentText(el, 0);
      else if (role === 'dialog' || role === 'alertdialog') {
        const h = el.querySelector('h1,h2,h3,[role=heading]');
        n = h ? contentText(h, 0) : '';
      }
    }
    if (!squash(n)) n = el.getAttribute('title') || '';
    if (!squash(n) && (role === 'textbox' || role === 'searchbox' || role === 'combobox')) n = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || '';
    return clip(squash(n), NAME_MAX);
  }

  function valueOf(el, role) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const t = (el.type || '').toLowerCase();
      if (['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file'].includes(t)) return undefined;
      if (t === 'password') return el.value ? '•••' : undefined;
      return el.value ? clip(squash(el.value), 40) : undefined;
    }
    if (tag === 'SELECT') {
      const o = el.selectedOptions && el.selectedOptions[0];
      return o ? clip(squash(o.textContent), 40) : undefined;
    }
    if (role === 'slider' || role === 'spinbutton' || role === 'progressbar' || role === 'meter' || role === 'scrollbar') {
      const v = el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow') || (el.value !== undefined && el.value !== '' ? String(el.value) : '');
      return v || undefined;
    }
    if (role === 'textbox' && el.isContentEditable) {
      const v = squash(el.textContent);
      return v ? clip(v, 40) : undefined;
    }
    return undefined;
  }

  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  function statesOf(el, role, active) {
    const s = [];
    const aria = (n) => el.getAttribute(n);
    const tag = el.tagName;
    if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
      const c = tag === 'INPUT' ? (el.indeterminate ? 'mixed' : String(el.checked)) : aria('aria-checked');
      s.push(c === 'true' ? 'checked' : c === 'mixed' ? 'mixed' : 'unchecked');
    }
    const exp = aria('aria-expanded');
    if (exp === 'true') s.push('expanded');
    else if (exp === 'false') s.push('collapsed');
    if (tag === 'DETAILS') s.push(el.open ? 'expanded' : 'collapsed');
    if (aria('aria-selected') === 'true' || (tag === 'OPTION' && el.selected)) s.push('selected');
    const pr = aria('aria-pressed');
    if (pr === 'true') s.push('pressed');
    if (el.disabled || aria('aria-disabled') === 'true') s.push('disabled');
    if (el === active) s.push('focused');
    if (el.required || aria('aria-required') === 'true') s.push('required');
    if (aria('aria-invalid') === 'true') s.push('invalid');
    const cur = aria('aria-current');
    if (cur && cur !== 'false') s.push('current');
    if ((el.readOnly && (tag === 'INPUT' || tag === 'TEXTAREA')) || aria('aria-readonly') === 'true') s.push('readonly');
    if (tag === 'DIALOG' && el.open && el.matches(':modal')) s.push('modal');
    else if (aria('aria-modal') === 'true') s.push('modal');
    return s.length ? s : undefined;
  }

  function hidden(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.inert) return true;
    if (el.tagName === 'DIALOG' && !el.open) return true;
    if (typeof el.checkVisibility === 'function') {
      // display:contents boxes report "not visible" although their children render
      if (!el.checkVisibility({ visibilityProperty: true }) && getComputedStyle(el).display !== 'contents') return true;
    } else {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  }

  /** Clickable by cursor, for div/span onClick controls with no role. */
  function looksClickable(el) {
    if (el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'LI' || el.tagName === 'LABEL' || el.tagName === 'I' || el.tagName === 'SVG' || el.tagName === 'svg') {
      if (el.hasAttribute('tabindex') && el.tabIndex >= 0) return true;
      if (el.hasAttribute('onclick')) return true;
      const cs = getComputedStyle(el);
      if (cs.cursor !== 'pointer') return false;
      const p = el.parentElement;
      if (p && getComputedStyle(p).cursor === 'pointer') return false;
      return true;
    }
    return false;
  }

  function isDead(ref) {
    const w = refs.get(ref);
    const el = w && w.deref();
    return !el || !el.isConnected;
  }

  /** Assign (or adopt) a ref for `el`. */
  function refFor(el, sig, claimed) {
    let r = byEl.get(el);
    if (r && refs.get(r) && refs.get(r).deref() === el) {
      if (!scopedWalk) { sigOf.delete(r); sigOf.set(r, sig); }
      claimed.add(r);
      return r;
    }
    const cands = seedSigs.get(sig);
    if (cands) {
      for (const c of cands) {
        if (!claimed.has(c) && isDead(c)) { r = c; break; }
      }
    }
    if (!r) r = 'r' + counter++;
    claimed.add(r);
    refs.set(r, new WeakRef(el));
    byEl.set(el, r);
    sigOf.set(r, sig);
    return r;
  }

  /**
   * Walk the DOM. Returns the root RawNode. Text is merged into one line per
   * flattened run; structural/interactive elements become nodes.
   */
  function walk(rootEl) {
    const active = deepActive();
    const claimed = new Set();
    walkClaimed = claimed;
    // sig counts per parent so equal siblings get distinct signatures
    function visit(el, parentRef, out, sibCounts) {
      if (el.nodeType === 3) {
        const t = el.nodeValue;
        if (t && t.trim()) pushText(out, t);
        return;
      }
      if (el.nodeType !== 1) return;
      if (SKIP_TAGS.has(el.tagName) && el.tagName !== 'svg' && el.tagName !== 'SVG') return;
      if (hidden(el)) return;
      if (visibleOnly) {
        const b = el.getBoundingClientRect();
        if ((b.width || b.height) && (b.bottom <= 0 || b.right <= 0 || b.top >= innerHeight || b.left >= innerWidth)) return;
      }
      let role = roleOf(el);
      if (role === 'none') { visitChildren(el, parentRef, out, sibCounts); return; }
      if (!role && looksClickable(el)) role = 'clickable';
      if (el.tagName === 'svg' || el.tagName === 'SVG') {
        if (role !== 'img' && role !== 'clickable' && !INTERACTIVE.has(role)) return;
      }
      const interactive = INTERACTIVE.has(role);
      let name = role ? nameOf(el, role) : '';
      const structural = STRUCTURAL.has(role) && (!NAMED_ONLY.has(role) || name);
      if (!interactive && !structural) { visitChildren(el, parentRef, out, sibCounts); return; }
      if (interactive && el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0 && !el.childElementCount) return;
      }
      if (role === 'clickable' && !name) { visitChildren(el, parentRef, out, sibCounts); return; }
      const base = role + '|' + name + '|' + parentRef;
      const k = (sibCounts.get(base) || 0);
      sibCounts.set(base, k + 1);
      const ref = refFor(el, k ? base + '#' + k : base, claimed);
      const node = { ref, role };
      if (name) node.name = name;
      const v = valueOf(el, role);
      if (v !== undefined) node.value = v;
      if (role === 'heading') {
        const m = /^H(\d)$/.exec(el.tagName);
        node.level = m ? Number(m[1]) : Number(el.getAttribute('aria-level')) || 2;
      }
      const st = statesOf(el, role, active);
      if (st) node.states = st;
      // Leaf-like interactive elements: their content is their name.
      const leaf = NAME_FROM_CONTENT.has(role) && role !== 'row' && role !== 'cell' && role !== 'gridcell' && !el.querySelector('input,select,textarea,button,a[href],[role=button],[role=link],[role=checkbox],[tabindex]');
      if (!leaf && role !== 'heading' && el.tagName !== 'SELECT' && role !== 'img' && role !== 'iframe') {
        const kids = [];
        visitChildren(el, ref, kids, new Map());
        if (kids.length) node.children = kids;
      } else if (el.tagName === 'SELECT' && el === scopeRoot) {
        // native selects list their options only when snapshotted on their own
        node.children = Array.from(el.options).slice(0, 50).map((o) => ({ role: 'option', name: clip(squash(o.label), NAME_MAX), ...(o.selected ? { states: ['selected'] } : {}) }));
      }
      out.push(node);
    }
    function visitChildren(el, parentRef, out, sibCounts) {
      if (el.shadowRoot) {
        for (const c of el.shadowRoot.childNodes) visit(c, parentRef, out, sibCounts);
        return;
      }
      if (el.tagName === 'SLOT') {
        for (const c of el.assignedNodes({ flatten: true })) visit(c, parentRef, out, sibCounts);
        return;
      }
      for (const c of el.childNodes) visit(c, parentRef, out, sibCounts);
      // block elements break text runs
      if (out.length && out[out.length - 1].role === 'text' && el.nodeType === 1 && isBlock(el)) out[out.length - 1].closed = true;
    }
    function pushText(out, t) {
      const last = out[out.length - 1];
      if (last && last.role === 'text' && !last.closed) last.name += ' ' + t;
      else out.push({ role: 'text', name: t });
    }
    const root = { role: 'page', children: [] };
    if (rootEl === document.documentElement || rootEl === document.body) {
      visitChildren(document.body || document.documentElement, '', root.children, new Map());
    } else {
      visit(rootEl, '', root.children, new Map());
    }
    finishText(root);
    return root;
  }

  function isBlock(el) {
    const d = getComputedStyle(el).display;
    return d !== 'inline' && d !== 'inline-block' && d !== 'contents' && d !== 'inline-flex';
  }

  function finishText(node) {
    if (!node.children) return;
    const kids = [];
    for (const c of node.children) {
      if (c.role === 'text') {
        const t = squash(c.name);
        if (!t) continue;
        kids.push({ role: 'text', name: clip(t, TEXT_MAX) });
      } else {
        finishText(c);
        kids.push(c);
      }
    }
    node.children = kids.length ? kids : undefined;
  }

  function seed(list) {
    seedSigs = new Map();
    if (!list) return;
    for (const ref in list) {
      const sig = list[ref];
      if (!seedSigs.has(sig)) seedSigs.set(sig, []);
      seedSigs.get(sig).push(ref);
    }
  }

  function snap(opts) {
    opts = opts || {};
    if (opts.nextRef && opts.nextRef > counter) counter = opts.nextRef;
    // Node's memory seeds a fresh document (after a reload) once.
    if (opts.seed && walks === 0) for (const r in opts.seed) if (!sigOf.has(r)) sigOf.set(r, opts.seed[r]);
    // Adoption candidates: every ref seen in this session, not only the last walk, so an
    // element that was briefly absent (a view re-rendering) gets its old ref back.
    const m = {};
    for (const [r, s] of sigOf) m[r] = s;
    seed(m);
    let rootEl = document.documentElement;
    if (opts.scope) {
      const el = resolveRaw(opts.scope);
      if (!el) return { error: 'stale' };
      rootEl = el;
    }
    walks++;
    visibleOnly = !!opts.visible;
    scopedWalk = !!opts.scope || visibleOnly;
    scopeRoot = opts.scope ? rootEl : null;
    let root = null;
    let behind = 0;
    if (visibleOnly && !opts.scope) {
      const modal = openModal();
      if (modal) {
        root = walk(modal);
        behind = 1;
      }
    }
    if (!root) root = walk(rootEl);
    if (!scopedWalk) lastSeen = walkClaimed;
    scopedWalk = false;
    if (sigOf.size > 4000) {
      for (const r of sigOf.keys()) { if (sigOf.size <= 3000) break; if (isDead(r)) sigOf.delete(r); }
    }
    // keep sigs of refs not seen this walk (e.g. outside the scope) for adoption
    const sigs = {};
    for (const [r, s] of sigOf) sigs[r] = s;
    const a = deepActive();
    const focus = a && a !== document.body && a !== document.documentElement ? (byEl.get(a) || 'unref') : 'body';
    return {
      url: location.href, title: document.title, vw: innerWidth, vh: innerHeight,
      focus, root, nextRef: counter, sigs, ...(behind ? { modalOnly: true } : {}),
    };
  }

  function resolveRaw(ref) {
    const w = refs.get(ref);
    const el = w && w.deref();
    return el && el.isConnected ? el : null;
  }

  function resolve(ref) {
    let el = resolveRaw(ref);
    if (el) return el;
    if (!refs.has(ref) && !sigOf.has(ref)) return null;
    // Maybe remounted: a fresh walk lets an equivalent element adopt it.
    snap({});
    return resolveRaw(ref);
  }

  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift('#' + el.id); break; }
      let p = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
        if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      parts.unshift(p);
      el = parent;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    if (!el || el.nodeType !== 1) return '?';
    const r = byEl.get(el);
    if (r && resolveRaw(r) === el) {
      const role = roleOf(el) || 'clickable';
      const n = nameOf(el, role);
      return '[' + r + '] ' + role + (n ? ' "' + clip(n, 30) + '"' : '');
    }
    let d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => c && c.length < 30).slice(0, 2) : [];
    if (cls.length) d += '.' + cls.join('.');
    const tid = el.getAttribute('data-testid');
    if (tid) d += '[testid=' + tid + ']';
    for (let a = el.parentElement, i = 0; a && i < 8; a = a.parentElement, i++) {
      const ar = byEl.get(a);
      if (ar && resolveRaw(ar) === a) return d + ' in ' + describe(a);
    }
    return d;
  }

  function hint(ref) {
    const el = resolveRaw(ref);
    if (!el) return null;
    const h = {};
    const tid = el.getAttribute('data-testid');
    if (tid && document.querySelectorAll('[data-testid="' + CSS.escape(tid) + '"]').length === 1) h.testId = tid;
    let role = roleOf(el);
    if (!role && looksClickable(el)) role = 'clickable';
    const name = role ? nameOf(el, role) : '';
    if (role && role !== 'clickable') {
      h.role = role;
      if (name && !name.endsWith('…')) h.name = name;
      // nth among the same role+name
      let n = 0; let idx = -1;
      for (const [r, w] of refs) {
        const e = w.deref();
        if (!e || !e.isConnected) continue;
        if (roleOf(e) === role && nameOf(e, role) === name) {
          if (e === el) idx = n;
          n++;
        }
        void r;
      }
      if (n > 1 && idx >= 0) h.nth = idx;
    } else if (name) h.text = name;
    h.css = cssPath(el);
    return h;
  }

  function settle(quietMs, maxMs) {
    return new Promise((res) => {
      const t0 = performance.now();
      let n = 0;
      let timer = null;
      const done = () => { obs.disconnect(); clearTimeout(timer); clearTimeout(cap); res({ mutations: n, ms: Math.round(performance.now() - t0) }); };
      const obs = new MutationObserver((list) => { n += list.length; clearTimeout(timer); timer = setTimeout(done, quietMs); });
      obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      timer = setTimeout(done, quietMs);
      const cap = setTimeout(done, maxMs);
    });
  }

  function focusRef() {
    const a = deepActive();
    if (!a || a === document.body || a === document.documentElement) return 'body';
    return byEl.get(a) || describe(a);
  }

  // ------------------------------------------------------------------ audits

  function allEls() {
    const out = [];
    const stack = [document.documentElement];
    while (stack.length) {
      const el = stack.pop();
      out.push(el);
      if (el.shadowRoot) for (const c of el.shadowRoot.children) stack.push(c);
      for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
    }
    return out;
  }

  function liveRefEls() {
    const out = [];
    for (const r of lastSeen) {
      const w = refs.get(r);
      const el = w && w.deref();
      if (el && el.isConnected && !hidden(el)) out.push([r, el]);
    }
    return out;
  }

  function scrollsX(el) {
    const o = getComputedStyle(el).overflowX;
    return o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip';
  }

  function openModal() {
    for (const m of document.querySelectorAll('dialog[open], [aria-modal="true"]')) {
      if (hidden(m)) continue;
      if (m.tagName === 'DIALOG' && !m.matches(':modal') && m.getAttribute('aria-modal') !== 'true') continue;
      return m;
    }
    return null;
  }

  /** The nearest fixed or sticky ancestor (or self), else null. Cached per audit. */
  let pinCache = new WeakMap();
  function pinned(el) {
    if (pinCache.has(el)) return pinCache.get(el);
    let res = null;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const pos = getComputedStyle(a).position;
      if (pos === 'fixed' || pos === 'sticky') { res = a; break; }
    }
    pinCache.set(el, res);
    return res;
  }

  /** Line boxes cut to the visible (clipped) rect. */
  function cut(list, c) {
    return list.map((r) => ({ left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) }))
      .map((r) => ({ ...r, width: r.right - r.left, height: r.bottom - r.top }))
      .filter((r) => r.width > 1 && r.height > 1);
  }

  function boxes(el) {
    const list = Array.from(el.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
    return list.length ? list : [el.getBoundingClientRect()];
  }

  /** The element's rect cut by every ancestor that clips overflow; null when nothing is left. */
  function clippedRect(el) {
    const b = el.getBoundingClientRect();
    let l = b.left, t = b.top, r = b.right, btm = b.bottom;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const ab = a.getBoundingClientRect();
      if (cs.overflowX !== 'visible') { l = Math.max(l, ab.left); r = Math.min(r, ab.right); }
      if (cs.overflowY !== 'visible') { t = Math.max(t, ab.top); btm = Math.min(btm, ab.bottom); }
      if (r <= l || btm <= t) return null;
    }
    return { left: l, top: t, right: r, bottom: btm, width: r - l, height: btm - t };
  }

  const I18N_KEY = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_-]+){1,5}$/;
  const FILE_LIKE = /\.(html?|js|ts|css|json|png|jpe?g|svg|db|pdf|txt|md|com|org|net|io)$/i;
  const PLACEHOLDER = /\{\{\s*[\w.]+\s*\}\}|\{\s*[a-zA-Z_]\w*\s*(,\s*(plural|select|number|date)\b[^}]*)?\}|\$t\(|\[missing ["'][^"']+["'] translation\]|__[A-Z_]{3,}__/;
  const EN_WORDS = new Set(['the', 'and', 'of', 'to', 'your', 'with', 'for', 'this', 'that', 'is', 'are', 'you', 'not', 'from', 'settings', 'search', 'open', 'close', 'cancel', 'save', 'delete', 'loading', 'please', 'select', 'show', 'hide']);

  function audit(kinds) {
    pinCache = new WeakMap();
    const want = new Set(kinds);
    const items = [];
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = innerHeight;
    const refEls = liveRefEls();
    if (want.has('names')) {
      for (const [r, el] of refEls) {
        const role = roleOf(el) || (looksClickable(el) ? 'clickable' : '');
        if (!INTERACTIVE.has(role) || role === 'clickable') continue;
        if (!nameOf(el, role)) items.push({ kind: 'unnamed', ref: r, detail: 'has no accessible name' });
      }
    }
    if (want.has('overflow')) {
      const docW = document.documentElement.scrollWidth;
      if (docW > vw + 1) items.push({ kind: 'page-x', detail: 'page scrolls sideways: ' + docW + '>' + vw });
      let n = 0;
      for (const el of allEls()) {
        if (n > 40) break;
        if (el === document.documentElement || el === document.body || hidden(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // escapes the viewport sideways, and its parent does not (topmost culprit)
        if (r.right > vw + 1 || r.left < -1) {
          const p = el.parentElement;
          let inScroller = false;
          for (let a = p; a && a !== document.body; a = a.parentElement) if (scrollsX(a)) { inScroller = true; break; }
          if (inScroller) continue;
          const pr = p && p.getBoundingClientRect();
          const position = getComputedStyle(el).position;
          if (position === 'fixed' && r.left >= vw) continue; // parked off-canvas drawer
          if (pr && (pr.right > vw + 1 || pr.left < -1) && p !== document.body) continue;
          items.push({ kind: 'off-viewport', ref: byEl.get(el), el: byEl.get(el) ? undefined : describe(el), detail: 'x ' + Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + vw });
          n++;
        }
      }
      // clipped text / content wider than its box
      let c = 0;
      for (const el of allEls()) {
        if (c > 20) break;
        if (el.scrollWidth <= el.clientWidth + 2 || el.clientWidth <= 2 || el.clientHeight <= 2) continue; // 1px boxes are screen-reader-only text
        const cs = getComputedStyle(el);
        if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') continue;
        if (cs.textOverflow === 'ellipsis') continue;
        if (!squash(el.textContent) || hidden(el)) continue;
        if (el.childElementCount > 3) continue; // layout container, not a text box
        items.push({ kind: 'clipped', ref: byEl.get(el), el: byEl.get(el) ? undefined : describe(el), detail: 'content ' + el.scrollWidth + 'px in ' + el.clientWidth + 'px' + (el.textContent ? ' "' + clip(squash(el.textContent), 30) + '"' : '') });
        c++;
      }
    }
    if (want.has('overlap')) {
      const modal = openModal();
      const inView = [];
      let behindModal = 0;
      for (const [r, el] of refEls) {
        const role = roleOf(el) || 'clickable';
        if (!INTERACTIVE.has(role) && !looksClickable(el)) continue;
        const b = clippedRect(el);
        if (!b || b.width < 2 || b.height < 2) continue;
        if (b.bottom <= 0 || b.right <= 0 || b.top >= vh || b.left >= vw) continue;
        if (modal && !modal.contains(el)) { behindModal++; continue; }
        inView.push([r, el, b]);
      }
      if (behindModal) {
        items.push({ kind: 'modal-background', ref: byEl.get(modal), detail: behindModal + ' controls behind the open modal are not inert/aria-hidden (screen readers still reach them)' });
      }
      const topmost = [];
      let n = 0;
      for (const [r, el, b] of inView) {
        // first line box: the centre of a wrapped inline element's bounding box can sit on other text
        const fb = boxes(el)[0];
        const cx = Math.min(Math.max(Math.max(fb.left, b.left) + Math.min(fb.width, b.width) / 2, 0), vw - 1);
        const cy = Math.min(Math.max(Math.max(fb.top, b.top) + Math.min(fb.height, b.height) / 2, 0), vh - 1);
        let hit = document.elementFromPoint(cx, cy);
        while (hit && hit.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(cx, cy); if (!inner || inner === hit) break; hit = inner; }
        if (!hit || hit === el || el.contains(hit) || hit.contains(el) ||
          (el.labels && Array.from(el.labels).some((l) => l.contains(hit))) || (hit.tagName === 'LABEL' && hit.control === el)) {
          topmost.push([r, el, b]);
          continue;
        }
        // scrolling content passing under fixed/sticky chrome is normal
        // (a small fixed bar); a fixed layer over most of the screen (a scrim) is reported
        const pin = pinned(hit);
        if (pin && !pinned(el)) {
          const pr = pin.getBoundingClientRect();
          const bar = pr.width >= 0.9 * vw || pr.height >= 0.9 * vh;
          if (bar && pr.width * pr.height < 0.4 * vw * vh) continue;
        }
        if (n++ < 15) items.push({ kind: 'covered', ref: r, detail: 'center hit ' + describe(hit) });
      }
      // overlapping pairs of controls that are both visible at their centres
      let m = 0;
      for (let i = 0; i < topmost.length && m < 10; i++) {
        for (let j = i + 1; j < topmost.length && m < 10; j++) {
          const [ra, ea, a] = topmost[i]; const [rb, eb, bb] = topmost[j];
          if (ea.contains(eb) || eb.contains(ea)) continue;
          if (pinned(ea) !== pinned(eb)) {
            const pin = pinned(ea) || pinned(eb);
            const pr = pin.getBoundingClientRect();
            if ((pr.width >= 0.9 * vw || pr.height >= 0.9 * vh) && pr.width * pr.height < 0.4 * vw * vh) continue;
          }
          // per line box: wrapped inline elements have rects that do not overlap although their bounding boxes do
          let area = 0;
          const ra2 = cut(boxes(ea), a); const rb2 = cut(boxes(eb), bb);
          for (const x of ra2) for (const y of rb2) {
            const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
            const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
            // lines of adjacent inline text overlap a little vertically (content box > line height): not a bug
            if (w > 1 && h > 0.5 * Math.min(x.height, y.height)) area += w * h;
          }
          if (!area) continue;
          const small = Math.min(a.width * a.height, bb.width * bb.height);
          if (area / small < 0.25) continue;
          items.push({ kind: 'overlap', ref: ra, detail: Math.round(100 * area / small) + '% with [' + rb + ']' });
          m++;
        }
      }
    }
    if (want.has('focus')) {
      const a = deepActive();
      if (a && a !== document.body && a !== document.documentElement) {
        const b = a.getBoundingClientRect();
        if (hidden(a) || b.width === 0 || b.height === 0) items.push({ kind: 'focus-hidden', ref: byEl.get(a), el: byEl.get(a) ? undefined : describe(a), detail: 'focused element is not visible' });
        else if (b.bottom < 0 || b.top > vh || b.right < 0 || b.left > vw) items.push({ kind: 'focus-offscreen', ref: byEl.get(a), el: byEl.get(a) ? undefined : describe(a), detail: 'focused element is outside the viewport' });
        const modal = openModal();
        if (modal && !modal.contains(a)) items.push({ kind: 'focus-outside-modal', ref: byEl.get(a), detail: 'a modal is open but focus is outside it' });
      }
    }
    if (want.has('i18n')) {
      const lang = (document.documentElement.lang || '').toLowerCase();
      const nonEn = lang && !lang.startsWith('en');
      const seen = new Set();
      let n = 0;
      const check = (text, el, where) => {
        const t = squash(text);
        if (!t || seen.has(t) || n > 15) return;
        let why = '';
        if (I18N_KEY.test(t) && !FILE_LIKE.test(t) && /[a-z]{2,}\.[a-z]/i.test(t)) why = 'looks like an i18n key';
        else if (PLACEHOLDER.test(t)) why = 'unresolved placeholder';
        else if (nonEn) {
          const words = t.toLowerCase().split(/[^a-z']+/).filter(Boolean);
          const hits = words.filter((w) => EN_WORDS.has(w)).length;
          if (words.length >= 2 && hits >= 2 && hits / words.length >= 0.3) why = 'English text on a ' + lang + ' page';
        }
        if (!why) return;
        seen.add(t);
        n++;
        items.push({ kind: 'i18n', ref: byEl.get(el), el: byEl.get(el) ? undefined : describe(el), detail: why + (where ? ' (' + where + ')' : '') + ': "' + clip(t, 40) + '"' });
      };
      const tw = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
      for (let node = tw.nextNode(); node; node = tw.nextNode()) {
        const p = node.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName) || p.closest('[translate="no"],code,pre,[contenteditable="true"]')) continue;
        if (hidden(p)) continue;
        check(node.nodeValue, p, '');
      }
      for (const el of allEls()) {
        for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
          const v = el.getAttribute && el.getAttribute(attr);
          if (v) check(v, el, attr);
        }
      }
    }
    return items;
  }

  window.__uid = {
    snap,
    resolve,
    hint,
    settle,
    audit,
    focusRef,
    describe: (ref) => { const el = resolveRaw(ref); return el ? describe(el) : null; },
    /** The element at a point, described (for "covered by" errors). */
    describeAt: (x, y) => describe(document.elementFromPoint(x, y)),
    refOf: (el) => byEl.get(el) || null,
  };
})();
