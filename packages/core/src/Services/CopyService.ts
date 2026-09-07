/**
 * Minimal Handlebars-like template engine for copy templates.
 *
 * Supported syntax:
 *   {{variable}}              - Variable interpolation
 *   {{#each items}}...{{/each}} - Loop over array (exposes item properties + @index, @first, @last)
 *   {{#if variable}}...{{/if}}  - Conditional (truthy check)
 *   {{#if variable}}...{{else}}...{{/if}} - Conditional with else
 *   {{#unless variable}}...{{/unless}} - Negated conditional
 *   {{#blockquote}}...{{/blockquote}} - Prefix every line of the region with "> "
 *   {{separator "\n"}}        - Emit literal string (useful between items in #each)
 *
 * No code execution - purely declarative.
 *
 * **An unrecognised `{{#helper}}` is an error, not silence.** Anything the
 * tokenizer did not recognise used to fall through to the variable branch, so
 * `{{#blockqoute}}` resolved to a missing variable and rendered as nothing at
 * all - the template simply lost a chunk of itself with no indication why.
 * Section tags are now checked against {@link SECTION_HELPERS} and a typo
 * throws {@link TemplateSyntaxError}, which the copy dialog surfaces as
 * `[Template error: ...]` in its live preview. Plain `{{variable}}` keeps its
 * lenient "unknown name renders empty" behaviour: a variable may legitimately
 * be absent from one passage's context and present in another's.
 */

interface TemplateContext {
  [key: string]: unknown;
}

/**
 * A template the engine refuses to render - today, only an unknown section
 * helper. Thrown rather than swallowed so the mistake is visible; callers that
 * render user-authored templates live (see `renderCopyTemplate` in the desktop
 * package) catch it and show the message instead of blanking the preview.
 */
export class TemplateSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateSyntaxError';
  }
}

/**
 * Every block helper the engine knows, by the name that follows `#` and `/`.
 *
 * The list is the whole contract: a tag whose name is not here is a typo, and
 * treating it as one is the point (see the file header).
 */
const SECTION_HELPERS = ['each', 'if', 'unless', 'blockquote'] as const;

/** Resolve a dotted path like "v.text" against a context stack */
function resolve(path: string, contexts: TemplateContext[]): unknown {
  const trimmed = path.trim();

  // Special @-variables (loop metadata)
  if (trimmed.startsWith('@')) {
    for (let i = contexts.length - 1; i >= 0; i--) {
      if (trimmed in contexts[i]) return contexts[i][trimmed];
    }
    return undefined;
  }

  const parts = trimmed.split('.');
  // Walk context stack from innermost to outermost
  for (let i = contexts.length - 1; i >= 0; i--) {
    const first = parts[0];
    if (first in contexts[i]) {
      let val: unknown = contexts[i][first];
      for (let p = 1; p < parts.length; p++) {
        if (val == null || typeof val !== 'object') return undefined;
        val = (val as Record<string, unknown>)[parts[p]];
      }
      return val;
    }
  }
  return undefined;
}

function isTruthy(val: unknown): boolean {
  if (Array.isArray(val)) return val.length > 0;
  return !!val;
}

/** Unescape template string literals like \n, \t */
function unescapeStr(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
}

interface Token {
  type:
    | 'text'
    | 'var'
    | 'each_open'
    | 'each_close'
    | 'if_open'
    | 'if_close'
    | 'else'
    | 'unless_open'
    | 'unless_close'
    | 'blockquote_open'
    | 'blockquote_close'
    | 'separator';
  value: string;
}

/** The helper name in `{{#name ...}}` or `{{/name}}`, or null if the tag is neither. */
function sectionName(inner: string): string | null {
  const match = inner.match(/^[#/]\s*([A-Za-z_][\w-]*)/);
  return match ? match[1] : null;
}

function assertKnownHelper(inner: string): string {
  const name = sectionName(inner);
  if (!name || !(SECTION_HELPERS as readonly string[]).includes(name)) {
    throw new TemplateSyntaxError(
      `Unknown template helper {{${inner}}}. Known helpers: ${SECTION_HELPERS.map(h => `#${h}`).join(', ')}.`,
    );
  }
  return name;
}

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  const regex = /\{\{(.*?)\}\}/gs;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: template.slice(lastIndex, match.index) });
    }

    const inner = match[1].trim();

    if (inner.startsWith('#each ')) {
      tokens.push({ type: 'each_open', value: inner.slice(6).trim() });
    } else if (inner === '/each') {
      tokens.push({ type: 'each_close', value: '' });
    } else if (inner.startsWith('#if ')) {
      tokens.push({ type: 'if_open', value: inner.slice(4).trim() });
    } else if (inner === '/if') {
      tokens.push({ type: 'if_close', value: '' });
    } else if (inner === 'else') {
      tokens.push({ type: 'else', value: '' });
    } else if (inner.startsWith('#unless ')) {
      tokens.push({ type: 'unless_open', value: inner.slice(8).trim() });
    } else if (inner === '/unless') {
      tokens.push({ type: 'unless_close', value: '' });
    } else if (inner === '#blockquote') {
      tokens.push({ type: 'blockquote_open', value: '' });
    } else if (inner === '/blockquote') {
      tokens.push({ type: 'blockquote_close', value: '' });
    } else if (inner.startsWith('separator ')) {
      const strMatch = inner.match(/^separator\s+"((?:[^"\\]|\\.)*)"/);
      tokens.push({ type: 'separator', value: strMatch ? unescapeStr(strMatch[1]) : '\n' });
    } else if (inner.startsWith('#') || inner.startsWith('/')) {
      // A section tag that reached here is either an unknown helper or a known
      // one written wrongly (`{{#each}}` with no argument, `{{#blockquote x}}`).
      // Either way it is a mistake in the template, and rendering it as an
      // empty variable is how the previous one went unnoticed.
      assertKnownHelper(inner);
      throw new TemplateSyntaxError(`Malformed template helper {{${inner}}}.`);
    } else {
      tokens.push({ type: 'var', value: inner });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < template.length) {
    tokens.push({ type: 'text', value: template.slice(lastIndex) });
  }

  return tokens;
}

interface ASTNode {
  type: 'text' | 'var' | 'each' | 'if' | 'unless' | 'blockquote' | 'separator';
  value: string;
  children?: ASTNode[];
  elseChildren?: ASTNode[];
}

/**
 * Mark a rendered region as a Markdown block quote by prefixing every line
 * with `> `.
 *
 * The engine emits a plain string, so "this is a quotation" has to be carried
 * in the text itself; `> ` is the one notation that survives into Markdown,
 * into a rich-text paste, and into a plain-text note where it still reads as a
 * quotation. A user who wants something else writes it by hand - the helper
 * exists so that they do not have to hand-prefix *every* line of a passage
 * whose length they do not know in advance.
 *
 * Two details that would otherwise bite:
 *
 *  - **Trailing newlines stay outside the quote.** `{{#blockquote}}...\n
 *    {{/blockquote}}` would otherwise emit a final `> ` on the empty line
 *    after the passage, which renders as an extra blank quoted line.
 *  - **A blank line inside the region becomes a bare `>`**, not `"> "`. Both
 *    are valid CommonMark; the bare one avoids leaving trailing whitespace on
 *    every paragraph break.
 *
 * Nesting composes: an inner region emits `> x`, which the outer one prefixes
 * again to `> > x` - CommonMark's nested block quote.
 */
function toBlockQuote(content: string): string {
  if (content === '') return '';
  const trailing = /\n+$/.exec(content)?.[0] ?? '';
  const body = trailing ? content.slice(0, -trailing.length) : content;
  const quoted = body
    .split('\n')
    .map(line => (line === '' ? '>' : `> ${line}`))
    .join('\n');
  return quoted + trailing;
}

function buildAST(tokens: Token[]): ASTNode[] {
  let i = 0;

  function parseUntil(closers: string[]): ASTNode[] {
    const result: ASTNode[] = [];
    while (i < tokens.length) {
      const tok = tokens[i];

      if (closers.includes(tok.type)) {
        return result;
      }

      if (tok.type === 'text' || tok.type === 'var' || tok.type === 'separator') {
        result.push({ type: tok.type, value: tok.value });
        i++;
      } else if (tok.type === 'each_open') {
        const varName = tok.value;
        i++;
        const children = parseUntil(['each_close']);
        i++; // skip close
        result.push({ type: 'each', value: varName, children });
      } else if (tok.type === 'if_open') {
        const varName = tok.value;
        i++;
        const children = parseUntil(['if_close', 'else']);
        let elseChildren: ASTNode[] | undefined;
        if (i < tokens.length && tokens[i].type === 'else') {
          i++; // skip else
          elseChildren = parseUntil(['if_close']);
        }
        i++; // skip close
        result.push({ type: 'if', value: varName, children, elseChildren });
      } else if (tok.type === 'unless_open') {
        const varName = tok.value;
        i++;
        const children = parseUntil(['unless_close']);
        i++; // skip close
        result.push({ type: 'unless', value: varName, children });
      } else if (tok.type === 'blockquote_open') {
        i++;
        const children = parseUntil(['blockquote_close']);
        i++; // skip close
        result.push({ type: 'blockquote', value: '', children });
      } else {
        i++;
      }
    }
    return result;
  }

  return parseUntil([]);
}

function renderAST(nodes: ASTNode[], contexts: TemplateContext[]): string {
  let out = '';

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value;
        break;

      case 'var': {
        const val = resolve(node.value, contexts);
        out += val != null ? String(val) : '';
        break;
      }

      case 'separator':
        out += node.value;
        break;

      case 'each': {
        const arr = resolve(node.value, contexts);
        if (Array.isArray(arr) && node.children) {
          for (let idx = 0; idx < arr.length; idx++) {
            const item = arr[idx];
            const itemCtx: TemplateContext = typeof item === 'object' && item !== null
              ? { ...(item as TemplateContext) }
              : { this: item };
            itemCtx['@index'] = idx;
            itemCtx['@first'] = idx === 0;
            itemCtx['@last'] = idx === arr.length - 1;
            out += renderAST(node.children, [...contexts, itemCtx]);
          }
        }
        break;
      }

      case 'if': {
        const val = resolve(node.value, contexts);
        if (isTruthy(val)) {
          if (node.children) out += renderAST(node.children, contexts);
        } else {
          if (node.elseChildren) out += renderAST(node.elseChildren, contexts);
        }
        break;
      }

      case 'unless': {
        const val = resolve(node.value, contexts);
        if (!isTruthy(val)) {
          if (node.children) out += renderAST(node.children, contexts);
        }
        break;
      }

      case 'blockquote':
        // Rendered whole and *then* prefixed: the region's line structure is
        // only known once its loops and conditionals have run.
        out += toBlockQuote(node.children ? renderAST(node.children, contexts) : '');
        break;
    }
  }

  return out;
}

/** Render a template string with the given context */
export function renderTemplate(template: string, context: TemplateContext): string {
  const tokens = tokenize(template);
  const ast = buildAST(tokens);
  return renderAST(ast, [context]);
}

// -- Saved template types and built-in templates ---------------------

export interface SavedTemplate {
  name: string;
  template: string;
}

export const BUILTIN_TEMPLATES: SavedTemplate[] = [
  {
    name: 'Standard',
    template: '{{#each verses}}{{#unless @first}} {{/unless}}{{text}}{{/each}}  ({{reference}}, {{version}})',
  },
  {
    name: 'Verse per line',
    template: `{{reference}} ({{version}})
{{#each verses}}
({{verse}}) {{text}}
{{/each}}`,
  },
  {
    name: 'Paragraph',
    template: `{{#each paragraphs}}{{#unless @first}}

{{/unless}}{{#each verses}}{{#unless @first}} {{/unless}}{{text}}{{/each}}{{/each}}
({{reference}}, {{version}})`,
  },
  {
    name: 'Numbered inline',
    template: '{{#each verses}}{{#unless @first}} {{/unless}}({{verse}}) {{text}}{{/each}}  ({{reference}}, {{version}})',
  },
  // Written with {{#blockquote}} rather than hand-typed `> ` markers so the
  // helper has a worked example in the template picker: load it, and the way
  // to mark a region as a quotation is right there in the editor.
  {
    name: 'Quote block',
    template: `{{#blockquote}}{{#each verses}}{{#unless @first}} {{/unless}}{{text}}{{/each}}

— {{reference}} ({{version}}){{/blockquote}}`,
  },
  {
    name: 'Study notes',
    template: `**{{reference}}** ({{version}})

{{#each verses}}{{verse}}. {{text}}
{{/each}}`,
  },
];

/** Serialize templates to JSON for export */
export function exportTemplates(templates: SavedTemplate[]): string {
  return JSON.stringify(templates, null, 2);
}

/** Parse and validate imported template JSON. Returns null if invalid. */
export function importTemplates(json: string): SavedTemplate[] | null {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    for (const item of parsed) {
      if (typeof item.name !== 'string' || typeof item.template !== 'string') return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
