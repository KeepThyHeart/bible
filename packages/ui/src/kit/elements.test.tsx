import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UI_KIT_COMPONENTS } from '@bible/core/browser';
import { defineKthElement } from './defineKthElement';
import { KIT_ELEMENTS } from './elements';
import { setKitLocale } from './kitLocale';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  for (const [tag, { component, spec }] of Object.entries(KIT_ELEMENTS)) defineKthElement(tag, component, spec);
});

afterEach(() => {
  document.body.replaceChildren();
  setKitLocale({ locale: 'en', direction: 'ltr' });
});

function mount<T extends HTMLElement>(tag: string, attrs: Record<string, string> = {}): T {
  const el = document.createElement(tag) as T;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

function collect(name: string): CustomEvent[] {
  const seen: CustomEvent[] = [];
  document.body.addEventListener(name, (e) => seen.push(e as CustomEvent));
  return seen;
}

describe('kit elements', () => {
  it('match the core UI_KIT_COMPONENTS allowlist exactly', () => {
    expect(Object.keys(KIT_ELEMENTS).sort()).toEqual(UI_KIT_COMPONENTS['1'].map((c) => c.tag).sort());
  });

  describe('kth-reference-picker', () => {
    it('renders with label/placeholder attributes and the element id prefix', async () => {
      const el = mount('kth-reference-picker', { label: 'Go to', placeholder: 'ref here' });
      const input = (await within(el).findByRole('combobox')) as HTMLInputElement;
      expect(input).toHaveAttribute('placeholder', 'ref here');
      expect(within(el).getByLabelText('Go to')).toBe(input);
      expect(input.id).toMatch(/^kth-reference-picker-\d+-input$/);
    });

    it('a label attribute beats the labels property; the property fills the rest', async () => {
      const el = mount<HTMLElement & { labels?: unknown }>('kth-reference-picker', { label: 'From attr' });
      el.labels = { label: 'From prop', placeholder: 'prop placeholder' };
      const input = await within(el).findByLabelText('From attr');
      await waitFor(() => expect(input).toHaveAttribute('placeholder', 'prop placeholder'));
    });

    it('renders label strings as text, never as HTML', async () => {
      const el = mount('kth-reference-picker', { label: '<img src=x onerror=alert(1)>' });
      await within(el).findByRole('combobox');
      expect(el.querySelector('img')).toBeNull();
    });

    it('commits on Enter with a kth-change event (bubbles, composed, plain detail)', async () => {
      const seen = collect('kth-change');
      const el = mount('kth-reference-picker');
      const input = await within(el).findByRole('combobox');
      const user = userEvent.setup();
      await user.type(input, 'John 3:16{Enter}');
      await waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0].detail).toEqual({ verseId: 43003016, ref: 'John 3:16' });
      expect(seen[0].bubbles).toBe(true);
      expect(seen[0].composed).toBe(true);
    });

    it('uses the kit locale for book names and ref', async () => {
      setKitLocale({ locale: 'es', direction: 'ltr' });
      const seen = collect('kth-change');
      const el = mount('kth-reference-picker');
      const input = await within(el).findByRole('combobox');
      await userEvent.setup().type(input, 'Juan 3:16{Enter}');
      await waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0].detail).toEqual({ verseId: 43003016, ref: 'Juan 3:16' });
    });

    it('takes the kit direction unless the element sets dir', async () => {
      setKitLocale({ locale: 'ar', direction: 'rtl' });
      const a = mount('kth-reference-picker');
      const b = mount('kth-reference-picker', { dir: 'ltr' });
      await waitFor(() => expect(a.querySelector('.kth-combobox')).toHaveAttribute('dir', 'rtl'));
      await waitFor(() => expect(b.querySelector('.kth-combobox')).toHaveAttribute('dir', 'ltr'));
    });

    it('the value attribute seeds the text, disabled and no-whole-chapter apply', async () => {
      const el = mount('kth-reference-picker', { value: 'John 3', disabled: '' });
      const input = (await within(el).findByRole('combobox')) as HTMLInputElement;
      expect(input.value).toBe('John 3');
      expect(input).toBeDisabled();
    });

    it('changing the value attribute resets the text; typing before that is kept', async () => {
      const el = mount('kth-reference-picker', { value: 'John 3' });
      const input = (await within(el).findByRole('combobox')) as HTMLInputElement;
      await userEvent.setup().type(input, ':16');
      expect(input.value).toBe('John 3:16');
      el.setAttribute('value', 'Jude 5');
      await waitFor(() => expect(input.value).toBe('Jude 5'));
    });

    it('an invalid number attribute falls back to the default', async () => {
      const el = mount('kth-reference-picker', { 'max-suggestions': 'lots' });
      const input = await within(el).findByRole('combobox');
      await userEvent.setup().type(input, 'Jo');
      await waitFor(() => expect(within(el).getAllByRole('option')).toHaveLength(8));
    });
  });

  describe('kth-highlight-swatch', () => {
    it('renders the palette, with the group label attribute', async () => {
      const el = mount('kth-highlight-swatch', { 'group-label': 'Colour' });
      const group = await within(el).findByRole('radiogroup', { name: 'Colour' });
      expect(within(group).getAllByRole('radio')).toHaveLength(6);
    });

    it('colors attribute limits and orders the palette; unknown tokens are dropped', async () => {
      const el = mount('kth-highlight-swatch', { colors: 'blue nope red' });
      await within(el).findByRole('radiogroup');
      expect(within(el).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Blue', 'Red']);
    });

    it('value checks a swatch; choosing fires kth-change { color, hex }', async () => {
      const seen = collect('kth-change');
      const el = mount('kth-highlight-swatch', { value: '#FFF3A3' });
      const radios = await within(el).findAllByRole('radio');
      expect(radios[0]).toHaveAttribute('aria-checked', 'true');
      await userEvent.setup().click(radios[1]);
      await waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0].detail).toEqual({ color: 'green', hex: '#B7E4C7' });
      expect(seen[0].bubbles && seen[0].composed).toBe(true);
    });

    it('label properties render as text', async () => {
      const el = mount<HTMLElement & { labels?: unknown }>('kth-highlight-swatch');
      el.labels = { colors: { yellow: '<b>Gelb</b>' } };
      await waitFor(() => expect(within(el).getAllByRole('radio')[0]).toHaveAttribute('aria-label', '<b>Gelb</b>'));
      expect(el.querySelector('b')).toBeNull();
    });
  });

  describe('kth-book-chapter-picker', () => {
    it('renders localized book names and marks the current passage', async () => {
      setKitLocale({ locale: 'es', direction: 'ltr' });
      const el = mount('kth-book-chapter-picker', { book: '43', chapter: '3', 'no-autofocus': '' });
      await within(el).findByText('Juan');
      expect(within(el).queryByText('John')).toBeNull();
    });

    it('a book then a chapter fires kth-pick with the verse id', async () => {
      const seen = collect('kth-pick');
      const el = mount('kth-book-chapter-picker', { 'no-autofocus': '' });
      const user = userEvent.setup();
      await user.click(await within(el).findByRole('button', { name: /^Jude$/ }));
      await waitFor(() => expect(seen).toHaveLength(1)); // single-chapter book picks immediately
      expect(seen[0].detail).toEqual({ book: 65, chapter: 1, verseId: 65001001 });
      expect(seen[0].bubbles && seen[0].composed).toBe(true);
    });

    it('a typed reference reports the verse and range end', async () => {
      const seen = collect('kth-pick');
      const el = mount('kth-book-chapter-picker', { 'no-autofocus': '' });
      const input = await within(el).findByRole('textbox');
      await userEvent.setup().type(input, 'John 3:16-18{Enter}');
      await waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0].detail).toEqual({ book: 43, chapter: 3, verseId: 43003016, endVerseId: 43003018 });
    });

    it('Escape at the book list fires kth-close', async () => {
      const seen = collect('kth-close');
      const el = mount('kth-book-chapter-picker', { 'no-autofocus': '' });
      await within(el).findByRole('textbox');
      await userEvent.setup().keyboard('{Escape}');
      await waitFor(() => expect(seen).toHaveLength(1));
    });
  });

  it('is reachable through screen queries (light DOM, no shadow root)', async () => {
    const el = mount('kth-highlight-swatch');
    await screen.findByRole('radiogroup');
    expect(el.shadowRoot).toBeNull();
  });
});
