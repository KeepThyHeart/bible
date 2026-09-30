/**
 * defineKthElement: wraps a React-API component (running on preact/compat in the kit bundle) as a custom element.
 *
 * Contract (kit major 1, additive only):
 * - Attributes are coerced by their declared type; an absent attribute means "component default".
 * - Every attribute also has a same-named camelCase JS property (last writer wins). Object-valued inputs are
 *   property-only. Properties do not reflect back to attributes.
 * - Callbacks become bubbling, composed `CustomEvent`s whose `detail` is plain, clonable data.
 * - Light DOM, no shadow root: KTH classes and host CSS apply directly. Author children are discarded on
 *   connect (render kth-* elements childless).
 * - Unmount runs on a microtask with an `isConnected` check, so moving an element keeps its state.
 * - `define` is idempotent (a panel may load the kit twice).
 *
 * Security: props reach the component only as data; nothing here builds HTML from strings.
 */
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { getKitLocale, subscribeKitLocale } from './kitLocale';
import type { KitLocale } from './kitLocale';

export type AttrType = 'string' | 'number' | 'boolean' | 'list' | { enum: readonly string[] };
export interface AttrSpec {
  prop: string;
  type: AttrType;
}
export interface EventSpec {
  event: `kth-${string}`;
  /** Maps the callback's arguments to the event `detail`. */
  detail: (...args: never[]) => unknown;
}
export interface KthElementSpec {
  /** key = attribute name (kebab-case). Each also gets a JS property named `prop`. */
  attrs: Readonly<Record<string, AttrSpec>>;
  /** Property-only inputs (objects, arrays, functions): never parsed from attributes. */
  props?: readonly string[];
  /** key = component callback prop (e.g. `onChange`) -> CustomEvent. */
  events: Readonly<Record<string, EventSpec>>;
  /** Last step before render: fill locale defaults from the kit store, fold attributes into objects, etc. */
  mapProps?: (props: Record<string, unknown>, locale: KitLocale) => Record<string, unknown>;
}

let seq = 0;

/** HTML-ish coercion. An absent attribute gives `undefined`, so the component default applies. */
export function coerce(type: AttrType, raw: string | null): unknown {
  if (raw === null) return undefined;
  if (type === 'string') return raw;
  if (type === 'boolean') return raw !== 'false'; // presence is true; "false" is tolerated for frameworks
  if (type === 'number') {
    const t = raw.trim();
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : undefined;
  }
  if (type === 'list') return raw.split(/\s+/).filter(Boolean);
  return type.enum.includes(raw) ? raw : undefined;
}

type Loose = Record<string, unknown>;

function upgradeProperty(el: HTMLElement, prop: string): void {
  // A property set on the element before the class was defined shadows the prototype accessor.
  if (Object.prototype.hasOwnProperty.call(el, prop)) {
    const v = (el as unknown as Loose)[prop];
    delete (el as unknown as Loose)[prop];
    (el as unknown as Loose)[prop] = v;
  }
}

export function defineKthElement(
  tag: string,
  Component: ComponentType<Record<string, unknown>>,
  spec: KthElementSpec,
): void {
  if (customElements.get(tag)) return;
  const attrNames = Object.keys(spec.attrs);
  const propNames = [...attrNames.map((a) => spec.attrs[a].prop), ...(spec.props ?? [])];

  class KthElement extends HTMLElement {
    static get observedAttributes(): string[] {
      return attrNames;
    }
    private _props: Loose = {};
    private _root: Root | null = null;
    private _queued = false;
    private _unsub: (() => void) | null = null;
    private readonly _id = `${tag}-${++seq}`;
    private readonly _callbacks: Record<string, (...a: unknown[]) => void> = {};

    constructor() {
      super();
      for (const [cb, ev] of Object.entries(spec.events)) {
        this._callbacks[cb] = (...args: unknown[]) => {
          this.dispatchEvent(
            new CustomEvent(ev.event, {
              detail: (ev.detail as (...a: unknown[]) => unknown)(...args),
              bubbles: true,
              composed: true,
            }),
          );
        };
      }
    }

    connectedCallback(): void {
      for (const p of propNames) upgradeProperty(this, p);
      for (const a of attrNames) {
        if (this.hasAttribute(a)) this._props[spec.attrs[a].prop] = coerce(spec.attrs[a].type, this.getAttribute(a));
      }
      if (!this._root) {
        this.replaceChildren(); // preact/React must start from an empty host
        this._root = createRoot(this);
      }
      this._unsub ??= subscribeKitLocale(() => this._schedule());
      this._render();
    }

    disconnectedCallback(): void {
      // A move is disconnect + connect in one task: only unmount when still detached afterwards.
      queueMicrotask(() => {
        if (this.isConnected) return;
        this._unsub?.();
        this._unsub = null;
        this._root?.unmount();
        this._root = null;
      });
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
      const s = spec.attrs[name];
      if (!s) return;
      this._props[s.prop] = coerce(s.type, value);
      this._schedule();
    }

    _set(prop: string, value: unknown): void {
      this._props[prop] = value;
      this._schedule();
    }

    _get(prop: string): unknown {
      return this._props[prop];
    }

    private _schedule(): void {
      if (this._queued) return;
      this._queued = true;
      queueMicrotask(() => {
        this._queued = false;
        this._render();
      });
    }

    private _render(): void {
      if (!this._root || !this.isConnected) return;
      let props: Loose = { id: this._id, ...this._props, ...this._callbacks };
      if (spec.mapProps) props = spec.mapProps(props, getKitLocale());
      this._root.render(createElement(Component, props));
    }
  }

  for (const p of propNames) {
    // Never shadow a native property (`dir` reflects to the attribute natively and reaches us that way).
    if (p in HTMLElement.prototype) continue;
    Object.defineProperty(KthElement.prototype, p, {
      configurable: true,
      enumerable: true,
      get(this: KthElement) {
        return this._get(p);
      },
      set(this: KthElement, v: unknown) {
        this._set(p, v);
      },
    });
  }
  customElements.define(tag, KthElement);
}
