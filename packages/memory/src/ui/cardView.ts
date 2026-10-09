/**
 * The memory-card stack (task 0072): one recall card at a time.
 *
 * Flow per card: read the prompt (reference, optional first words), say the
 * passage to yourself, reveal it, then grade honestly - Missed / Partly /
 * Knew it. Grades are disabled until the reveal so a card cannot be marked
 * without looking. After grading the worker hands back the remaining stack
 * and we simply show its first card; nothing is tracked client-side except
 * how many cards this visit has already handled (for "i of n").
 *
 * Keys: Space reveals; 1/2/3 grade once revealed. They are bound on the
 * document (focus is usually on the body after navigation) and unbound as
 * soon as the screen is detached.
 */

import type { CardStackView, RecallCardView, RecallGrade } from '../core/pushTypes';
import { button, el, replace } from './dom';
import { breadcrumb } from './components';
import type { PanelHost } from './host';
import { renderPassage } from './scripture';

const GRADES: { grade: RecallGrade; label: string; key: string }[] = [
  { grade: 'missed', label: 'Missed', key: '1' },
  { grade: 'partly', label: 'Partly', key: '2' },
  { grade: 'knew', label: 'Knew it', key: '3' },
];

function timeLabel(at: number | null): string {
  if (at === null) return 'now';
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function renderCardStack(host: PanelHost, initial: CardStackView): HTMLElement {
  const root = el('section', { class: 'sm-screen sm-screen-cards' });
  const body = el('div', { class: 'sm-card-body' });

  let stack = initial;
  let handled = 0;
  let revealed = false;
  let shownAt = host.now();
  let revealMs = 0;
  let busy = false;
  let gradeButtons: HTMLButtonElement[] = [];
  let revealButton: HTMLButtonElement | null = null;

  root.appendChild(
    breadcrumb({
      crumbs: [{ label: 'Home', onClick: () => host.go({ type: 'goPlan' }) }, { label: 'Memory cards' }],
    }),
  );
  root.appendChild(body);

  // --- keyboard -----------------------------------------------------------
  let observer: MutationObserver | null = null;
  const cleanup = (): void => {
    document.removeEventListener('keydown', onKey);
    observer?.disconnect();
    observer = null;
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (!root.isConnected) {
      cleanup();
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target as HTMLElement | null;
    // Embedded in the host page (no iframe any more): only keys typed inside the Memory app count,
    // and never while the app is hidden (another app on screen keeps it mounted, inert).
    // Keys with no focused element (a click on plain card text leaves focus on <body>) count too,
    // since a visible Memory app is the only app on screen.
    const appRoot = root.closest('.sm-app') ?? root;
    if (root.closest('[inert],[hidden],[aria-hidden="true"]')) return;
    // Not while one of Memory's own dialogs or menus is open on top of the card.
    if (t instanceof Element && t.closest('[role="dialog"],[role="menu"],[role="alertdialog"]')) return;
    const unfocused = t === null || t === document.body || t === document.documentElement;
    if (!unfocused && !(t instanceof Node && appRoot.contains(t))) return;
    if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
    if (ev.key === ' ' || ev.key === 'Spacebar') {
      if (t && t.tagName === 'BUTTON') return; // the button handles its own Space
      if (revealButton && !revealed) {
        ev.preventDefault();
        reveal();
      }
      return;
    }
    const g = GRADES.find((x) => x.key === ev.key);
    if (g && revealed && !busy) {
      ev.preventDefault();
      void grade(g.grade);
    }
  };
  document.addEventListener('keydown', onKey);
  // Unbind as soon as the screen leaves the document, not on the next key press.
  if (typeof MutationObserver !== 'undefined' && document.body) {
    let wasConnected = false;
    observer = new MutationObserver(() => {
      if (root.isConnected) wasConnected = true;
      else if (wasConnected) cleanup();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // --- actions ------------------------------------------------------------
  const versesBox = el('div', { class: 'sm-card-verses', attrs: { 'aria-live': 'polite' } });

  function reveal(): void {
    const card = stack.cards[0];
    if (!card || revealed) return;
    revealed = true;
    revealMs = Math.max(0, host.now() - shownAt);
    replace(versesBox, renderPassage(card.verses, () => ({ showLabel: card.verses.length > 1 })));
    if (revealButton) revealButton.hidden = true;
    for (const b of gradeButtons) b.disabled = false;
    gradeButtons[0]?.focus({ preventScroll: true });
  }

  async function grade(g: RecallGrade): Promise<void> {
    const card = stack.cards[0];
    if (!card || !revealed || busy) return;
    busy = true;
    for (const b of gradeButtons) b.disabled = true;
    const reply = await host.request({
      type: 'gradeRecall',
      passageId: card.passageId,
      grade: g,
      ...(card.key ? { key: card.key } : {}),
      durationMs: revealMs,
    });
    busy = false;
    if (!reply.ok) {
      host.announce(reply.error);
      for (const b of gradeButtons) b.disabled = false;
      return;
    }
    handled += 1;
    stack = reply.data.stack;
    show();
  }

  async function snooze(card: RecallCardView): Promise<void> {
    if (busy) return;
    busy = true;
    const reply = await host.request({
      type: 'snoozeCard',
      passageId: card.passageId,
      ...(card.key ? { key: card.key } : {}),
    });
    if (!reply.ok) {
      busy = false;
      host.announce(reply.error);
      return;
    }
    const fresh = await host.request({ type: 'getCardStack' });
    busy = false;
    handled += 1;
    if (fresh.ok) stack = fresh.data;
    else stack = { cards: stack.cards.slice(1), waitingCount: Math.max(0, stack.waitingCount - 1) };
    show();
  }

  // --- drawing ------------------------------------------------------------
  function show(): void {
    revealed = false;
    revealButton = null;
    gradeButtons = [];
    shownAt = host.now();
    const card = stack.cards[0];
    if (!card) {
      replace(body, [endState()]);
      return;
    }
    replace(body, [cardElement(card)]);
    host.announce(`${handled + 1} of ${handled + stack.cards.length}: ${card.reference}`);
    (revealButton as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  function endState(): HTMLElement {
    if (handled === 0) {
      return el('div', { class: 'sm-card-end' }, [
        el('p', { class: 'sm-card-empty', text: 'No cards waiting.' }),
        button('Back', () => host.go({ type: 'goPlan' }), { class: 'sm-btn' }),
      ]);
    }
    return el('div', { class: 'sm-card-end' }, [
      el('p', { class: 'sm-card-empty', text: 'All cards done.' }),
      el('div', { class: 'sm-card-actions' }, [
        button("Practice what's due", () => void host.startFlow({ kind: 'variety' }), {
          class: 'sm-btn sm-btn-primary',
        }),
        button('Back', () => host.go({ type: 'goPlan' }), { class: 'sm-btn' }),
      ]),
    ]);
  }

  function cardElement(card: RecallCardView): HTMLElement {
    const total = handled + stack.cards.length;
    replace(versesBox, []);

    revealButton = button('Show verse (Space)', reveal, { class: 'sm-btn sm-btn-primary sm-btn-large' });
    gradeButtons = GRADES.map((g) =>
      button(`${g.label} (${g.key})`, () => void grade(g.grade), {
        class: 'sm-btn sm-card-grade',
        disabled: true,
        attrs: { 'aria-keyshortcuts': g.key },
      }),
    );

    return el('article', { class: 'sm-card', attrs: { 'aria-label': `Memory card for ${card.reference}` } }, [
      el('div', { class: 'sm-card-head' }, [
        el('span', { class: 'sm-card-kind', text: `Memory card · ${timeLabel(card.firedAt)}` }),
        el('span', { class: 'sm-card-count', text: `${handled + 1} of ${total}` }),
      ]),
      el('h2', { class: 'sm-card-ref', text: card.reference }),
      card.cue ? el('p', { class: 'sm-card-cue', text: card.cue }) : null,
      el('p', { class: 'sm-hint', text: 'Say it to yourself, then reveal.' }),
      revealButton,
      versesBox,
      el('div', { class: 'sm-card-grades', attrs: { role: 'group', 'aria-label': 'How did it go?' } }, gradeButtons),
      el('div', { class: 'sm-card-actions' }, [
        button('Practice this passage', () => void host.startSession(card.passageId), {
          class: 'sm-btn sm-btn-small sm-btn-quiet',
        }),
        button('Later (1 h)', () => void snooze(card), { class: 'sm-btn sm-btn-small sm-btn-quiet' }),
      ]),
    ]);
  }

  show();
  return root;
}
