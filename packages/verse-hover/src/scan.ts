import type { Ref } from './types';

/** Elements whose text is never scanned. The TreeWalker rejects the whole subtree in one step. */
const SKIP_TAGS = new Set('A BUTTON SCRIPT STYLE NOSCRIPT TEXTAREA INPUT SELECT OPTION CODE PRE KBD SAMP VAR SVG MATH IFRAME CANVAS TEMPLATE TITLE HEAD'.split(' '));

export interface ScanHooks {
  detect(text: string): Ref[];
  /** Builds the link element for one reference. Must use textContent only. */
  make(ref: Ref, text: string, host: Element): HTMLElement;
  /** Called for manually marked elements ([data-vh-ref]). */
  mark(el: HTMLElement): void;
  prefix: string;
  skip?: string;
  scope?: string[] | string;
  observe: boolean;
}

interface Record_ { orig: Text; nodes: Node[] }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const tick = (): Promise<void> => {
  const w = window as unknown as { scheduler?: { yield?: () => Promise<void> } };
  if (w.scheduler?.yield) return w.scheduler.yield();
  return new Promise((r) => (window.requestIdleCallback ? window.requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 0)));
};

export function createScanner(h: ScanHooks) {
  const scopes = h.scope ? (Array.isArray(h.scope) ? h.scope : [h.scope]).filter(Boolean).join(',') : '';
  const skipSel = `[contenteditable]:not([contenteditable="false"]),[translate=no],[data-vh=off],.${h.prefix}skip,.${h.prefix}pop,.${h.prefix}rd,.${h.prefix}ref${h.skip ? ',' + h.skip : ''}`;
  const records: Record_[] = [];
  const own = new WeakSet<Node>();
  let observer: MutationObserver | null = null;
  let queue: Node[] = [];
  let timer = 0;
  let gen = 0;

  const skipped = (el: Element) => SKIP_TAGS.has(el.tagName.toUpperCase()) || el.matches(skipSel);

  /** True when an ancestor (or the node itself) is skipped, or, with a scope, when no scope element contains it. */
  function blocked(node: Node): boolean {
    let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
    if (scopes && !el?.closest(scopes)) return true;
    for (; el; el = el.parentElement) if (skipped(el)) return true;
    return false;
  }

  function roots(root: Node): Node[] {
    if (!scopes) return [root];
    if (root.nodeType === 1) {
      const el = root as Element;
      if (el.closest(scopes)) return [root];
      return Array.from(el.querySelectorAll(scopes));
    }
    return root.parentElement?.closest(scopes) ? [root] : [];
  }

  async function scan(root: Node = document.body): Promise<number> {
    const my = gen;
    const found: { node: Text; refs: Ref[] }[] = [];
    let deadline = now() + 8;
    for (const start of roots(root)) {
      if (start.nodeType === 3) {
        if (!blocked(start)) collect(start as Text, found);
        continue;
      }
      if (blocked(start)) continue;
      const walker = document.createTreeWalker(start, 1 | 4, {
        acceptNode: (n) => (n.nodeType === 1 ? (skipped(n as Element) ? 2 : 3) : own.has(n) ? 3 : 1),
      });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 3) collect(n as Text, found);
        if (now() > deadline) {
          await tick();
          if (my !== gen) return 0;
          deadline = now() + 8;
        }
      }
      if (start.nodeType === 1) manual(start as Element);
    }
    // Writes are applied together, in slices, so layout is not thrashed.
    let done = 0;
    deadline = now() + 8;
    for (const f of found) {
      if (f.node.isConnected) { rewrite(f.node, f.refs); done += f.refs.length; }
      if (now() > deadline) {
        await tick();
        if (my !== gen) return done;
        deadline = now() + 8;
      }
    }
    return done;
  }

  function collect(node: Text, out: { node: Text; refs: Ref[] }[]) {
    const t = node.data;
    if (t.length < 3 || !/\d/.test(t)) return;
    const refs = h.detect(t);
    if (refs.length) out.push({ node, refs });
  }

  function manual(root: Element) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-vh-ref]'))) {
      if (!el.classList.contains(h.prefix + 'ref') && !blocked(el.parentElement || el)) h.mark(el);
    }
  }

  function rewrite(node: Text, refs: Ref[]) {
    const t = node.data;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const r of refs) {
      if (r.start > at) add(frag, document.createTextNode(t.slice(at, r.start)));
      add(frag, h.make(r, t.slice(r.start, r.end), node.parentElement as Element));
      at = r.end;
    }
    if (at < t.length) add(frag, document.createTextNode(t.slice(at)));
    const nodes = Array.from(frag.childNodes);
    node.replaceWith(frag);
    if (records.length > 500 && records.length % 500 === 0) for (let i = records.length - 1; i >= 0; i--) if (!records[i].nodes[0]?.isConnected) records.splice(i, 1);
    records.push({ orig: node, nodes });
  }

  function add(frag: DocumentFragment, n: Node) {
    own.add(n);
    frag.appendChild(n);
  }

  /** Restores the exact original text nodes under `root` (default: everything). */
  function unscan(root?: Node) {
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i];
      const first = rec.nodes[0];
      if (root && !(first && root.contains(first))) continue;
      if (first && first.parentNode) {
        first.parentNode.insertBefore(rec.orig, first);
        for (const n of rec.nodes) n.parentNode?.removeChild(n);
      }
      records.splice(i, 1);
    }
  }

  function flush() {
    timer = 0;
    const q = queue;
    queue = [];
    for (const n of q) if (n.isConnected && !own.has(n)) void scan(n);
  }

  function watch(root: Node = document.body) {
    if (!h.observe || observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver((muts) => {
      for (const m of muts) for (const n of Array.from(m.addedNodes)) if (!own.has(n) && (n.nodeType === 1 || n.nodeType === 3)) queue.push(n);
      if (queue.length && !timer) timer = window.setTimeout(flush, 100);
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function destroy() {
    gen++;
    observer?.disconnect();
    observer = null;
    clearTimeout(timer);
    timer = 0;
    unscan();
  }

  return { scan, unscan, watch, destroy, own };
}
