import { beforeEach, describe, expect, it } from 'vitest';
import { VIEWER_CSS, VIEWER_HTML, VIEWER_JS } from './viewerPage';
import type { PresentSnapshot } from './types';

/** Drives the real page script against a fake EventSource: the page must follow every state it is sent. */
class FakeEventSource {
  static last: FakeEventSource;
  listeners: Record<string, Array<(e: { data: string }) => void>> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown = {}) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) });
  }
}

const snap = (version: number, focus: number, patch: Partial<PresentSnapshot> = {}): PresentSnapshot => ({
  version,
  live: {
    reference: 'John 3:16–17',
    module: 'KJV',
    bookName: 'John',
    chapter: 3,
    verses: [
      { verse: 16, text: 'For God so loved <b>the world</b>' },
      { verse: 17, text: 'For God sent not his Son' },
    ],
    focus,
  },
  display: { fontStep: 0, blanked: false, theme: 'dark' },
  viewerCount: 1,
  ...patch,
});

beforeEach(() => {
  document.documentElement.innerHTML = VIEWER_HTML.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>\s*$/, '');
  (document.body.querySelector('script') as HTMLElement | null)?.remove();
  (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  Element.prototype.scrollIntoView = () => {};
  // eslint-disable-next-line no-new-func
  new Function(VIEWER_JS)();
});

describe('screen page', () => {
  it('connects to the relative events stream and waits for the presenter', () => {
    expect(FakeEventSource.last.url).toBe('events');
    expect(document.getElementById('status')!.hidden).toBe(false);
  });

  it('follows each snapshot: reference, verses, focus', () => {
    const es = FakeEventSource.last;
    es.emit('state', snap(1, 16));
    expect(document.getElementById('ref')!.textContent).toBe('John 3:16–17');
    expect(document.querySelectorAll('.v')).toHaveLength(2);
    expect(document.querySelector('.v.focus')!.getAttribute('data-verse')).toBe('16');
    es.emit('state', snap(2, 17));
    expect(document.querySelector('.v.focus')!.getAttribute('data-verse')).toBe('17');
  });

  it('shows verse text as text, never as markup', () => {
    FakeEventSource.last.emit('state', snap(1, 16));
    expect(document.querySelector('.v b')).toBeNull();
    expect(document.querySelector('.v')!.textContent).toContain('<b>the world</b>');
  });

  it('applies blank, theme and text size; ignores older versions', () => {
    const es = FakeEventSource.last;
    es.emit('state', snap(5, 16, { display: { fontStep: 3, blanked: true, theme: 'light' } }));
    expect(document.body.classList.contains('blanked')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect((document.getElementById('wall') as HTMLElement).style.getPropertyValue('--size')).toContain('vmin');
    es.emit('state', snap(4, 17));
    expect(document.querySelector('.v.focus')!.getAttribute('data-verse')).toBe('16');
  });

  it('keeps what is on screen on a malformed frame and shows the end only on a closed event', () => {
    const es = FakeEventSource.last;
    es.emit('state', snap(1, 16));
    for (const fn of es.listeners.state) fn({ data: '{not json' });
    expect(document.querySelectorAll('.v')).toHaveLength(2);
    es.emit('closed');
    expect(es.closed).toBe(true);
    expect(document.getElementById('status')!.textContent).toContain('ended');
  });

  it('needs no inline script or style (CSP: self only)', () => {
    expect(VIEWER_HTML).not.toMatch(/<script>|<style>|\son\w+=/i);
    expect(VIEWER_CSS.length).toBeGreaterThan(50);
  });
});
