import { DOMParser as PMDOMParser, Schema, type MarkSpec, type Node as PMNode, type NodeSpec } from 'prosemirror-model';
import { bulletList, listItem, orderedList } from 'prosemirror-schema-list';

/**
 * The Notes editor's document model. Deliberately small: whatever a
 * sermon outline needs and nothing a paste from Word can smuggle in.
 * Anything the schema does not name is dropped by ProseMirror's parser,
 * which is the whole "sanitize on paste" mechanism.
 */

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: {
    // `blockId`: a stable identity for the block (see blockIds.ts). Not rendered.
    attrs: { blockId: { default: null } },
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },
  heading: {
    attrs: { level: { default: 1 }, blockId: { default: null } },
    content: 'inline*',
    group: 'block',
    defining: true,
    // Word/Docs have six levels; the notes only keep two. h3+ become h2.
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      attrs: { level: Math.min(level, 2) },
    })),
    toDOM: (node) => [`h${node.attrs.level}`, 0],
  },
  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },
  bullet_list: { ...bulletList, content: 'list_item+', group: 'block' },
  ordered_list: { ...orderedList, content: 'list_item+', group: 'block' },
  list_item: { ...listItem, content: 'paragraph block*' },
  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },
  text: { group: 'inline' },
};

/** Google Docs wraps the whole clipboard in `<b style="font-weight:normal">`. */
function isBoldWeight(value: string): boolean {
  return value === 'bold' || value === 'bolder' || Number(value) >= 600;
}

const marks: Record<string, MarkSpec> = {
  bold: {
    parseDOM: [
      { tag: 'strong' },
      // `<b style="font-weight:normal">` is the Google Docs wrapper, not bold.
      { tag: 'b', getAttrs: (dom) => ((dom as HTMLElement).style.fontWeight === 'normal' ? false : null) },
      { style: 'font-weight', getAttrs: (value) => (isBoldWeight(value as string) ? null : false) },
    ],
    toDOM: () => ['strong', 0],
  },
  italic: {
    parseDOM: [
      { tag: 'em' },
      { tag: 'i', getAttrs: (dom) => ((dom as HTMLElement).style.fontStyle === 'normal' ? false : null) },
      { style: 'font-style=italic' },
    ],
    toDOM: () => ['em', 0],
  },
  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom) => {
          const href = (dom as HTMLElement).getAttribute('href') ?? '';
          // No javascript: / data: URLs from pasted HTML.
          if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return false;
          return { href, title: (dom as HTMLElement).getAttribute('title') };
        },
      },
    ],
    toDOM: (mark) => ['a', { href: mark.attrs.href, title: mark.attrs.title, rel: 'noopener noreferrer' }, 0],
  },
  /**
   * The user picked a specific item for this text (e.g. a different hymn).
   * `choice` is any JSON value the detection layer defines; it round-trips
   * through the document JSON and through the DOM (clipboard) as text.
   */
  pin: {
    attrs: { choice: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'span[data-pin]',
        getAttrs: (dom) => {
          try {
            return { choice: JSON.parse((dom as HTMLElement).getAttribute('data-pin') ?? 'null') };
          } catch {
            return false;
          }
        },
      },
    ],
    toDOM: (mark) => ['span', { 'data-pin': JSON.stringify(mark.attrs.choice ?? null) }, 0],
  },
  /** "Don't treat this text as an item." */
  unlink: {
    inclusive: false,
    parseDOM: [{ tag: 'span[data-unlink]' }],
    toDOM: () => ['span', { 'data-unlink': '' }, 0],
  },
};

export const notesSchema = new Schema({ nodes, marks });

export type ProseMirrorJSON = Record<string, unknown>;

/** An empty document (one empty paragraph). */
export function emptyDocJSON(): ProseMirrorJSON {
  return notesSchema.topNodeType.createAndFill()!.toJSON();
}

/** Restore a saved document; anything invalid becomes an empty document. */
export function docFromJSON(json: ProseMirrorJSON | null | undefined): PMNode {
  if (!json) return notesSchema.topNodeType.createAndFill()!;
  try {
    const node = notesSchema.nodeFromJSON(json);
    node.check();
    return node;
  } catch {
    return notesSchema.topNodeType.createAndFill()!;
  }
}

/**
 * Parse pasted/clipboard HTML through the schema (drops everything the
 * schema does not know: styles, classes, scripts, tables, fonts...).
 * The editor itself relies on ProseMirror's own paste path, which uses the
 * same schema; this helper exists for tests and non-paste imports.
 */
export function parseHtml(html: string): PMNode {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  return PMDOMParser.fromSchema(notesSchema).parse(dom.body);
}
