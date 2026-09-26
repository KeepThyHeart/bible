import { useEffect } from 'react';
import { waitFor } from '@testing-library/react';
import { coerce, defineKthElement } from './defineKthElement';
import type { KthElementSpec } from './defineKthElement';
import { setKitLocale } from './kitLocale';

// Roots created outside RTL would otherwise warn about act() under React 18.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

let n = 0;
const nextTag = () => `kth-t-${++n}`;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  document.body.replaceChildren();
  setKitLocale({ locale: 'en', direction: 'ltr' });
});

const spec: KthElementSpec = {
  attrs: {
    label: { prop: 'label', type: 'string' },
    'max-count': { prop: 'maxCount', type: 'number' },
    disabled: { prop: 'disabled', type: 'boolean' },
    colors: { prop: 'colors', type: 'list' },
    size: { prop: 'size', type: { enum: ['sm', 'md'] } },
    dir: { prop: 'dir', type: { enum: ['ltr', 'rtl'] } },
  },
  props: ['labels'],
  events: { onPing: { event: 'kth-ping', detail: (x: number) => ({ x }) } },
  mapProps: (props, l) => ({ ...props, locale: l.locale }),
};

interface Probe {
  props: Record<string, unknown>;
  ids: Set<unknown>;
  mounts: number;
  cleanups: number;
}

function defineProbe(tag: string): Probe {
  const probe: Probe = { props: {}, ids: new Set(), mounts: 0, cleanups: 0 };
  function Component(props: Record<string, unknown>) {
    probe.props = props;
    probe.ids.add(props.id);
    useEffect(() => {
      probe.mounts++;
      return () => {
        probe.cleanups++;
      };
    }, []);
    return <span data-testid="probe">{String(props.label ?? '')}</span>;
  }
  defineKthElement(tag, Component, spec);
  return probe;
}

describe('coerce', () => {
  it.each([
    ['string', 'a b', 'a b'],
    ['boolean', '', true],
    ['boolean', 'true', true],
    ['boolean', 'false', false],
    ['number', '12', 12],
    ['number', ' 3.5 ', 3.5],
    ['number', '', undefined],
    ['number', 'abc', undefined],
    ['list', 'a  b\tc', ['a', 'b', 'c']],
    ['list', '', []],
  ] as const)('%s %j -> %j', (type, raw, out) => {
    expect(coerce(type, raw)).toEqual(out);
  });

  it('enum accepts only listed values; absent means undefined', () => {
    expect(coerce({ enum: ['sm', 'md'] }, 'sm')).toBe('sm');
    expect(coerce({ enum: ['sm', 'md'] }, 'lg')).toBeUndefined();
    expect(coerce('string', null)).toBeUndefined();
    expect(coerce('boolean', null)).toBeUndefined();
  });
});

describe('defineKthElement', () => {
  it('renders, re-renders on attribute change, and coerces attributes', async () => {
    const tag = nextTag();
    const probe = defineProbe(tag);
    const el = document.createElement(tag);
    el.setAttribute('label', 'one');
    el.setAttribute('max-count', '4');
    el.setAttribute('disabled', '');
    el.setAttribute('colors', 'red blue');
    document.body.appendChild(el);
    await waitFor(() => expect(el.textContent).toBe('one'));
    expect(probe.props).toMatchObject({ maxCount: 4, disabled: true, colors: ['red', 'blue'], locale: 'en' });
    expect(typeof probe.props.id).toBe('string');

    el.setAttribute('label', 'two');
    await waitFor(() => expect(el.textContent).toBe('two'));
    el.removeAttribute('max-count');
    await waitFor(() => expect(probe.props.maxCount).toBeUndefined());
  });

  it('gives each element a distinct id', async () => {
    const tag = nextTag();
    const probe = defineProbe(tag);
    const a = document.createElement(tag);
    const b = document.createElement(tag);
    document.body.append(a, b);
    await waitFor(() => expect(probe.mounts).toBe(2));
    expect(probe.ids.size).toBe(2);
  });

  it('honours a property set before define (upgrade)', async () => {
    const tag = nextTag();
    const el = document.createElement(tag) as HTMLElement & { label?: string; labels?: unknown };
    el.label = 'early';
    el.labels = { a: 1 };
    document.body.appendChild(el);
    const probe = defineProbe(tag); // upgrades the existing element
    await waitFor(() => expect(el.textContent).toBe('early'));
    expect(probe.props.labels).toEqual({ a: 1 });
  });

  it('re-renders on a complex property and reads it back', async () => {
    const tag = nextTag();
    const probe = defineProbe(tag);
    const el = document.createElement(tag) as HTMLElement & { labels?: unknown };
    document.body.appendChild(el);
    await waitFor(() => expect(probe.mounts).toBe(1));
    el.labels = { x: 'y' };
    await waitFor(() => expect(probe.props.labels).toEqual({ x: 'y' }));
    expect(el.labels).toEqual({ x: 'y' });
  });

  it('dispatches a bubbling, composed CustomEvent from a callback', async () => {
    const tag = nextTag();
    const probe = defineProbe(tag);
    const el = document.createElement(tag);
    document.body.appendChild(el);
    await waitFor(() => expect(probe.mounts).toBe(1));
    const seen: CustomEvent[] = [];
    document.body.addEventListener('kth-ping', (e) => seen.push(e as CustomEvent));
    (probe.props.onPing as (x: number) => void)(7);
    expect(seen).toHaveLength(1);
    expect(seen[0].detail).toEqual({ x: 7 });
    expect(seen[0].bubbles).toBe(true);
    expect(seen[0].composed).toBe(true);
  });

  it('unmounts after removal', async () => {
    const tag = nextTag();
    const probe = defineProbe(tag);
    const el = document.createElement(tag);
    document.body.appendChild(el);
    await waitFor(() => expect(probe.mounts).toBe(1));
    el.remove();
    await tick();
    await waitFor(() => expect(probe.cleanups).toBe(1));
  });

  it('keeps state when an element is moved (remove + append in the same task)', async () => {
    const tag = nextTag();
    const probe = defineProbe(tag);
    const el = document.createElement(tag);
    document.body.appendChild(el);
    await waitFor(() => expect(probe.mounts).toBe(1));
    const holder = document.createElement('div');
    document.body.appendChild(holder);
    holder.appendChild(el); // disconnect + connect in one task
    await tick();
    await tick();
    expect(probe.cleanups).toBe(0);
    expect(probe.mounts).toBe(1);
  });

  it('re-mounts when re-inserted after a real removal', async () => {
    const tag = nextTag();
    const probe = defineProbe(tag);
    const el = document.createElement(tag);
    el.setAttribute('label', 'again');
    document.body.appendChild(el);
    await waitFor(() => expect(probe.mounts).toBe(1));
    el.remove();
    await tick();
    await waitFor(() => expect(probe.cleanups).toBe(1));
    document.body.appendChild(el);
    await waitFor(() => expect(probe.mounts).toBe(2));
    await waitFor(() => expect(el.textContent).toBe('again'));
  });

  it('re-renders connected elements when the kit locale changes, and only those', async () => {
    const tag = nextTag();
    const probe = defineProbe(tag);
    const el = document.createElement(tag);
    document.body.appendChild(el);
    await waitFor(() => expect(probe.props.locale).toBe('en'));
    setKitLocale({ locale: 'es', direction: 'ltr' });
    await waitFor(() => expect(probe.props.locale).toBe('es'));

    el.remove();
    await tick();
    await waitFor(() => expect(probe.cleanups).toBe(1));
    const renders = probe.props;
    setKitLocale({ locale: 'fr', direction: 'ltr' });
    await tick();
    expect(probe.props).toBe(renders); // detached element did not render again
  });

  it('discards author children on connect', async () => {
    const tag = nextTag();
    defineProbe(tag);
    const el = document.createElement(tag);
    el.innerHTML = '<b id="fallback">fallback</b>'; // test fixture only, not kit code
    document.body.appendChild(el);
    await waitFor(() => expect(el.querySelector('[data-testid=probe]')).not.toBeNull());
    expect(el.querySelector('#fallback')).toBeNull();
  });

  it('define is idempotent', () => {
    const tag = nextTag();
    defineProbe(tag);
    expect(() => defineProbe(tag)).not.toThrow();
  });

  it('does not shadow native properties (dir reflects to the attribute)', async () => {
    const tag = nextTag();
    const probe = defineProbe(tag);
    const el = document.createElement(tag);
    document.body.appendChild(el);
    await waitFor(() => expect(probe.mounts).toBe(1));
    el.dir = 'rtl';
    expect(el.getAttribute('dir')).toBe('rtl');
    await waitFor(() => expect(probe.props.dir).toBe('rtl'));
  });
});
