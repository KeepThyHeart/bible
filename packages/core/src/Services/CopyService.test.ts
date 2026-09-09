import { describe, it, expect } from 'vitest';
import { renderTemplate, TemplateSyntaxError, BUILTIN_TEMPLATES } from './CopyService';

// -- renderTemplate --------------------------------------------------

describe('CopyService.renderTemplate', () => {
  describe('variable interpolation', () => {
    it('replaces simple variables', () => {
      expect(renderTemplate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
    });

    it('replaces multiple variables', () => {
      expect(renderTemplate('{{a}} and {{b}}', { a: 'X', b: 'Y' })).toBe('X and Y');
    });

    it('resolves dotted paths', () => {
      expect(renderTemplate('{{user.name}}', { user: { name: 'Alice' } })).toBe('Alice');
    });

    it('renders empty string for undefined variables', () => {
      expect(renderTemplate('Hello {{missing}}!', {})).toBe('Hello !');
    });

    it('renders numbers as strings', () => {
      expect(renderTemplate('Count: {{n}}', { n: 42 })).toBe('Count: 42');
    });

    it('renders 0 as "0" (not empty)', () => {
      expect(renderTemplate('{{val}}', { val: 0 })).toBe('0');
    });

    it('handles whitespace in tag', () => {
      expect(renderTemplate('{{ name }}', { name: 'ok' })).toBe('ok');
    });

    it('renders boolean true as "true"', () => {
      expect(renderTemplate('Flag: {{flag}}', { flag: true })).toBe('Flag: true');
    });

    it('renders boolean false as "false"', () => {
      expect(renderTemplate('Flag: {{flag}}', { flag: false })).toBe('Flag: false');
    });

    it('handles missing dotted path in context', () => {
      expect(renderTemplate('{{user.name}}', {})).toBe('');
    });

    it('handles partial dotted path', () => {
      expect(renderTemplate('{{user.profile.name}}', { user: { profile: null } })).toBe('');
    });

    it('handles special characters in values', () => {
      expect(renderTemplate('{{text}}', { text: 'Hello & goodbye' })).toBe('Hello & goodbye');
    });

    it('handles multiple occurrences of same variable', () => {
      expect(renderTemplate('{{x}} + {{x}} = {{result}}', { x: 5, result: 10 })).toBe('5 + 5 = 10');
    });
  });

  describe('#each loops', () => {
    it('iterates over an array of objects', () => {
      const template = '{{#each items}}{{name}},{{/each}}';
      const result = renderTemplate(template, { items: [{ name: 'a' }, { name: 'b' }] });
      expect(result).toBe('a,b,');
    });

    it('exposes @index, @first, @last', () => {
      const template = '{{#each items}}{{@index}}{{#if @first}}F{{/if}}{{#if @last}}L{{/if}} {{/each}}';
      const result = renderTemplate(template, { items: [{ x: 1 }, { x: 2 }, { x: 3 }] });
      expect(result).toBe('0F 1 2L ');
    });

    it('renders nothing for empty arrays', () => {
      expect(renderTemplate('{{#each items}}x{{/each}}', { items: [] })).toBe('');
    });

    it('renders nothing for undefined array', () => {
      expect(renderTemplate('{{#each missing}}x{{/each}}', {})).toBe('');
    });

    it('handles primitive array items via "this"', () => {
      const template = '{{#each items}}{{this}},{{/each}}';
      expect(renderTemplate(template, { items: ['a', 'b', 'c'] })).toBe('a,b,c,');
    });

    it('can access parent context from within loop', () => {
      const template = '{{#each items}}{{version}}-{{name}},{{/each}}';
      const result = renderTemplate(template, {
        version: 'KJV',
        items: [{ name: 'a' }, { name: 'b' }],
      });
      expect(result).toBe('KJV-a,KJV-b,');
    });

    it('exposes @index correctly for single item', () => {
      const template = '{{#each items}}@{{@index}}{{/each}}';
      expect(renderTemplate(template, { items: [{ x: 1 }] })).toBe('@0');
    });

    it('marks first and last for single item', () => {
      const template = '{{#each items}}{{#if @first}}F{{/if}}{{#if @last}}L{{/if}}{{/each}}';
      expect(renderTemplate(template, { items: [{ x: 1 }] })).toBe('FL');
    });

    it('handles nested loops', () => {
      const template = '{{#each groups}}{{#each items}}{{x}} {{/each}}| {{/each}}';
      const result = renderTemplate(template, {
        groups: [
          { items: [{ x: 'a' }, { x: 'b' }] },
          { items: [{ x: 'c' }] },
        ],
      });
      expect(result).toBe('a b | c | ');
    });

    it('preserves parent context in nested loops', () => {
      const template = '{{#each groups}}{{name}}:{{#each items}}{{val}} {{/each}}| {{/each}}';
      const result = renderTemplate(template, {
        groups: [
          { name: 'G1', items: [{ val: '1' }, { val: '2' }] },
          { name: 'G2', items: [{ val: '3' }] },
        ],
      });
      expect(result).toBe('G1:1 2 | G2:3 | ');
    });

    it('handles non-array values (ignores loop)', () => {
      const template = '{{#each items}}x{{/each}}';
      expect(renderTemplate(template, { items: null })).toBe('');
      expect(renderTemplate(template, { items: 'string' })).toBe('');
      expect(renderTemplate(template, { items: { a: 1 } })).toBe('');
    });
  });

  describe('#if conditionals', () => {
    it('renders body when truthy', () => {
      expect(renderTemplate('{{#if show}}yes{{/if}}', { show: true })).toBe('yes');
    });

    it('skips body when falsy', () => {
      expect(renderTemplate('{{#if show}}yes{{/if}}', { show: false })).toBe('');
    });

    it('treats empty array as falsy', () => {
      expect(renderTemplate('{{#if items}}yes{{/if}}', { items: [] })).toBe('');
    });

    it('treats non-empty array as truthy', () => {
      expect(renderTemplate('{{#if items}}yes{{/if}}', { items: [1] })).toBe('yes');
    });

    it('treats empty string as falsy', () => {
      expect(renderTemplate('{{#if val}}yes{{/if}}', { val: '' })).toBe('');
    });

    it('treats null/undefined as falsy', () => {
      expect(renderTemplate('{{#if val}}yes{{/if}}', { val: null })).toBe('');
      expect(renderTemplate('{{#if val}}yes{{/if}}', {})).toBe('');
    });

    it('treats 0 as falsy', () => {
      expect(renderTemplate('{{#if val}}yes{{/if}}', { val: 0 })).toBe('');
    });

    it('treats non-zero numbers as truthy', () => {
      expect(renderTemplate('{{#if val}}yes{{/if}}', { val: 42 })).toBe('yes');
      expect(renderTemplate('{{#if val}}yes{{/if}}', { val: -1 })).toBe('yes');
    });

    it('supports else branch', () => {
      expect(renderTemplate('{{#if show}}yes{{else}}no{{/if}}', { show: true })).toBe('yes');
      expect(renderTemplate('{{#if show}}yes{{else}}no{{/if}}', { show: false })).toBe('no');
    });

    it('else branch is optional', () => {
      expect(renderTemplate('{{#if show}}yes{{/if}} done', { show: true })).toBe('yes done');
      expect(renderTemplate('{{#if show}}yes{{/if}} done', { show: false })).toBe(' done');
    });

    it('handles if inside each loop', () => {
      const template = '{{#each items}}{{#if bold}}*{{name}}*{{else}}{{name}}{{/if}} {{/each}}';
      const ctx = { items: [{ name: 'a', bold: true }, { name: 'b', bold: false }] };
      expect(renderTemplate(template, ctx)).toBe('*a* b ');
    });

    it('handles nested if conditionals', () => {
      const template = '{{#if a}}{{#if b}}both{{else}}just a{{/if}}{{else}}neither{{/if}}';
      expect(renderTemplate(template, { a: true, b: true })).toBe('both');
      expect(renderTemplate(template, { a: true, b: false })).toBe('just a');
      expect(renderTemplate(template, { a: false, b: true })).toBe('neither');
    });

    it('resolves dotted paths in condition', () => {
      const template = '{{#if user.active}}Active{{/if}}';
      expect(renderTemplate(template, { user: { active: true } })).toBe('Active');
      expect(renderTemplate(template, { user: { active: false } })).toBe('');
    });
  });

  describe('#unless conditionals', () => {
    it('renders body when falsy', () => {
      expect(renderTemplate('{{#unless show}}hidden{{/unless}}', { show: false })).toBe('hidden');
    });

    it('skips body when truthy', () => {
      expect(renderTemplate('{{#unless show}}hidden{{/unless}}', { show: true })).toBe('');
    });

    it('treats empty array as falsy', () => {
      expect(renderTemplate('{{#unless items}}empty{{/unless}}', { items: [] })).toBe('empty');
    });

    it('treats non-empty array as truthy', () => {
      expect(renderTemplate('{{#unless items}}empty{{/unless}}', { items: [1] })).toBe('');
    });

    it('treats empty string as falsy', () => {
      expect(renderTemplate('{{#unless val}}empty{{/unless}}', { val: '' })).toBe('empty');
    });

    it('treats null/undefined as falsy', () => {
      expect(renderTemplate('{{#unless val}}missing{{/unless}}', { val: null })).toBe('missing');
      expect(renderTemplate('{{#unless val}}missing{{/unless}}', {})).toBe('missing');
    });

    it('treats 0 as falsy', () => {
      expect(renderTemplate('{{#unless val}}zero{{/unless}}', { val: 0 })).toBe('zero');
    });

    it('treats non-zero numbers as truthy', () => {
      expect(renderTemplate('{{#unless val}}nonzero{{/unless}}', { val: 42 })).toBe('');
    });
  });

  describe('separator', () => {
    it('emits a newline separator', () => {
      const template = '{{#each items}}{{name}}{{separator "\\n"}}{{/each}}';
      const result = renderTemplate(template, { items: [{ name: 'a' }, { name: 'b' }] });
      expect(result).toBe('a\nb\n');
    });

    it('emits a tab separator', () => {
      const template = '{{#each items}}{{name}}{{separator "\\t"}}{{/each}}';
      const result = renderTemplate(template, { items: [{ name: 'x' }, { name: 'y' }] });
      expect(result).toBe('x\ty\t');
    });

    it('emits custom string separator', () => {
      const template = '{{#each items}}{{name}}{{separator " | "}}{{/each}}';
      const result = renderTemplate(template, { items: [{ name: 'a' }, { name: 'b' }] });
      expect(result).toBe('a | b | ');
    });

    it('defaults to newline if no string provided', () => {
      const template = '{{#each items}}{{name}}{{separator ""}}{{/each}}';
      const result = renderTemplate(template, { items: [{ name: 'a' }, { name: 'b' }] });
      // Empty separator string
      expect(result).toBe('ab');
    });

    it('handles escaped newline in separator', () => {
      const template = '{{#each items}}{{name}}{{separator "\\n"}}{{/each}}';
      const result = renderTemplate(template, { items: [{ name: 'a' }, { name: 'b' }] });
      expect(result).toBe('a\nb\n');
    });
  });

  describe('nested structures', () => {
    it('handles nested each loops', () => {
      const template = '{{#each groups}}{{#each verses}}{{text}} {{/each}}{{/each}}';
      const ctx = {
        groups: [
          { verses: [{ text: 'a' }, { text: 'b' }] },
          { verses: [{ text: 'c' }] },
        ],
      };
      expect(renderTemplate(template, ctx)).toBe('a b c ');
    });

    it('handles if inside each', () => {
      const template = '{{#each items}}{{#if bold}}*{{name}}*{{else}}{{name}}{{/if}} {{/each}}';
      const ctx = { items: [{ name: 'a', bold: true }, { name: 'b', bold: false }] };
      expect(renderTemplate(template, ctx)).toBe('*a* b ');
    });

    it('handles unless inside each', () => {
      const template = '{{#each items}}{{#unless hidden}}{{name}} {{/unless}}{{/each}}';
      const ctx = { items: [{ name: 'a', hidden: false }, { name: 'b', hidden: true }] };
      expect(renderTemplate(template, ctx)).toBe('a ');
    });

    it('handles each inside if', () => {
      const template = '{{#if show}}{{#each items}}{{name}} {{/each}}{{/if}}';
      const ctx = { show: true, items: [{ name: 'a' }, { name: 'b' }] };
      expect(renderTemplate(template, ctx)).toBe('a b ');
    });

    it('handles each inside if when condition is false', () => {
      const template = '{{#if show}}{{#each items}}{{name}} {{/each}}{{/if}}';
      const ctx = { show: false, items: [{ name: 'a' }, { name: 'b' }] };
      expect(renderTemplate(template, ctx)).toBe('');
    });

    it('handles if inside unless', () => {
      const template = '{{#unless hidden}}{{#if show}}visible{{/if}}{{/unless}}';
      expect(renderTemplate(template, { hidden: false, show: true })).toBe('visible');
      expect(renderTemplate(template, { hidden: false, show: false })).toBe('');
      expect(renderTemplate(template, { hidden: true, show: true })).toBe('');
    });

    it('deeply nested loops', () => {
      const template = '{{#each a}}{{#each b}}{{#each c}}{{x}} {{/each}}{{/each}}{{/each}}';
      const ctx = {
        a: [
          {
            b: [
              { c: [{ x: '1' }, { x: '2' }] },
              { c: [{ x: '3' }] },
            ],
          },
        ],
      };
      expect(renderTemplate(template, ctx)).toBe('1 2 3 ');
    });
  });

  describe('plain text passthrough', () => {
    it('returns plain text unchanged', () => {
      expect(renderTemplate('Hello world', {})).toBe('Hello world');
    });

    it('returns empty string for empty template', () => {
      expect(renderTemplate('', {})).toBe('');
    });

    it('preserves whitespace in plain text', () => {
      expect(renderTemplate('  hello  \n  world  ', {})).toBe('  hello  \n  world  ');
    });

    it('handles special characters in plain text', () => {
      expect(renderTemplate('a & b < c > d', {})).toBe('a & b < c > d');
    });

    it('preserves newlines in template', () => {
      expect(renderTemplate('line1\nline2\nline3', {})).toBe('line1\nline2\nline3');
    });
  });

  describe('Bible-specific usage patterns', () => {
    it('renders verse list with reference and version', () => {
      const template = '{{#each verses}}{{#unless @first}} {{/unless}}{{text}}{{/each}}  ({{reference}}, {{version}})';
      const ctx = {
        verses: [{ text: 'For God so loved' }, { text: 'the world' }],
        reference: 'John 3:16',
        version: 'KJV',
      };
      const result = renderTemplate(template, ctx);
      expect(result).toBe('For God so loved the world  (John 3:16, KJV)');
    });

    it('renders verse per line format', () => {
      const template = '{{reference}} ({{version}})\n{{#each verses}}\n({{verse}}) {{text}}\n{{/each}}';
      const ctx = {
        verses: [{ verse: 16, text: 'For God so loved the world' }],
        reference: 'John 3:16',
        version: 'KJV',
      };
      const result = renderTemplate(template, ctx);
      expect(result).toContain('John 3:16 (KJV)');
      expect(result).toContain('(16) For God so loved the world');
    });

    it('renders numbered inline format', () => {
      const template = '{{#each verses}}{{#unless @first}} {{/unless}}({{verse}}) {{text}}{{/each}}  ({{reference}}, {{version}})';
      const ctx = {
        verses: [{ verse: 16, text: 'For God so loved the world' }],
        reference: 'John 3:16',
        version: 'KJV',
      };
      const result = renderTemplate(template, ctx);
      expect(result).toBe('(16) For God so loved the world  (John 3:16, KJV)');
    });

    it('renders quote block format', () => {
      const template = '> {{#each verses}}{{#unless @first}} {{/unless}}{{text}}{{/each}}\n> \n> — {{reference}} ({{version}})';
      const ctx = {
        verses: [{ text: 'For God so loved the world' }],
        reference: 'John 3:16',
        version: 'KJV',
      };
      const result = renderTemplate(template, ctx);
      expect(result).toContain('> For God so loved the world');
      expect(result).toContain('— John 3:16 (KJV)');
    });

    it('handles commentary entries with references', () => {
      const template = '{{#each entries}}{{reference}}: {{text}}\n{{/each}}';
      const ctx = {
        entries: [
          { reference: 'John 3:16', text: 'This verse shows God\'s love' },
          { reference: 'John 3:17', text: 'God did not send his Son to condemn' },
        ],
      };
      const result = renderTemplate(template, ctx);
      expect(result).toContain('John 3:16: This verse shows God\'s love');
      expect(result).toContain('John 3:17: God did not send his Son to condemn');
    });
  });

  describe('edge cases and error handling', () => {
    it('handles unclosed tags gracefully', () => {
      // Unclosed tag is treated as plain text
      const result = renderTemplate('{{unclosed', {});
      expect(result).toBe('{{unclosed');
    });

    it('handles multiple unclosed tags', () => {
      const result = renderTemplate('{{a}}{{b', { a: 'x' });
      expect(result).toContain('x');
      expect(result).toContain('{{b');
    });

    it('handles empty context', () => {
      expect(renderTemplate('{{a}}', {})).toBe('');
      expect(renderTemplate('Hello {{a}}!', {})).toBe('Hello !');
    });

    it('handles null context values gracefully', () => {
      expect(renderTemplate('{{a}}', { a: null })).toBe('');
      expect(renderTemplate('{{a}}', { a: undefined })).toBe('');
    });

    it('handles deeply nested undefined paths', () => {
      expect(renderTemplate('{{a.b.c.d.e}}', { a: { b: { c: {} } } })).toBe('');
    });

    it('handles mixed types in context', () => {
      const ctx = {
        str: 'text',
        num: 42,
        bool: true,
        arr: [1, 2, 3],
        obj: { x: 'y' },
      };
      expect(renderTemplate('{{str}}-{{num}}-{{bool}}', ctx)).toBe('text-42-true');
    });

    it('handles objects with toString()', () => {
      const obj = {
        valueOf() {
          return 'value';
        },
      };
      // Object should render as string representation
      const result = renderTemplate('{{obj}}', { obj });
      expect(typeof result).toBe('string');
    });

    it('ignores invalid syntax in if condition', () => {
      // Invalid syntax in condition is treated as variable name
      const result = renderTemplate('{{#if a.b.c}}yes{{/if}}', { a: { b: { c: true } } });
      expect(result).toBe('yes');
    });

    it('handles very long templates', () => {
      let template = '';
      for (let i = 0; i < 100; i++) {
        template += '{{#if val}}x{{/if}}';
      }
      const result = renderTemplate(template, { val: true });
      expect(result.length).toBe(100);
    });

    it('handles very large context objects', () => {
      const ctx: Record<string, unknown> = {};
      for (let i = 0; i < 1000; i++) {
        ctx[`key${i}`] = `value${i}`;
      }
      const result = renderTemplate('{{key500}}', ctx);
      expect(result).toBe('value500');
    });

    it('handles arrays with null/undefined items', () => {
      const template = '{{#each items}}[{{this}}] {{/each}}';
      const result = renderTemplate(template, { items: [1, null, undefined, 2] });
      expect(result).toContain('[1]');
      expect(result).toContain('[2]');
    });

    it('handles separator outside of loop', () => {
      // Separator outside loop should still render
      const result = renderTemplate('{{separator "\\n"}}', {});
      expect(result).toBe('\n');
    });

    it('handles multiple separators in sequence', () => {
      const template = '{{#each items}}{{separator ";"}}{{/each}}';
      const result = renderTemplate(template, { items: [1, 2, 3] });
      expect(result).toBe(';;;');
    });

    it('handles whitespace-only template', () => {
      expect(renderTemplate('   ', {})).toBe('   ');
      expect(renderTemplate('\n\n\n', {})).toBe('\n\n\n');
    });

    it('handles template with only variables', () => {
      expect(renderTemplate('{{a}}{{b}}{{c}}', { a: 'x', b: 'y', c: 'z' })).toBe('xyz');
    });

    it('handles mixed closing tags gracefully', () => {
      // Mismatched tags - each should close if
      const result = renderTemplate('{{#each items}}{{#if show}}text{{/if}}{{/each}}', {
        items: [{ show: true }, { show: false }],
      });
      expect(result).toBe('text');
    });

    it('handles context value of 0', () => {
      expect(renderTemplate('{{num}}', { num: 0 })).toBe('0');
    });

    it('handles context value of false', () => {
      expect(renderTemplate('{{flag}}', { flag: false })).toBe('false');
    });

    it('handles context value of empty string', () => {
      expect(renderTemplate('X{{str}}Y', { str: '' })).toBe('XY');
    });

    it('handles array with single empty string', () => {
      const template = '{{#each items}}[{{this}}]{{/each}}';
      const result = renderTemplate(template, { items: [''] });
      expect(result).toBe('[]');
    });
  });

  describe('special variable names', () => {
    it('handles variable named "this"', () => {
      expect(renderTemplate('{{this}}', { this: 'value' })).toBe('value');
    });

    it('handles variable named with underscore', () => {
      expect(renderTemplate('{{_private}}', { _private: 'secret' })).toBe('secret');
    });

    it('handles variable named with dollar sign', () => {
      expect(renderTemplate('{{$ref}}', { $ref: 'value' })).toBe('value');
    });

    it('handles variable starting with number', () => {
      // Note: This depends on implementation - keys starting with numbers are valid in objects
      const ctx: Record<string, unknown> = {};
      ctx['2ndItem'] = 'value';
      expect(renderTemplate('{{2ndItem}}', ctx)).toBe('value');
    });
  });

  describe('whitespace handling', () => {
    it('preserves whitespace outside tags', () => {
      const result = renderTemplate('  {{a}}  {{b}}  ', { a: 'x', b: 'y' });
      expect(result).toBe('  x  y  ');
    });

    it('handles tabs and spaces consistently', () => {
      const result = renderTemplate('\t{{a}}\t\t{{b}} ', { a: 'x', b: 'y' });
      expect(result).toBe('\tx\t\ty ');
    });

    it('handles extra spaces in template tags', () => {
      expect(renderTemplate('{{  a  }}', { a: 'value' })).toBe('value');
      expect(renderTemplate('{{#if  show  }}yes{{/if}}', { show: true })).toBe('yes');
      expect(renderTemplate('{{#each  items  }}x{{/each}}', { items: [1] })).toBe('x');
    });
  });

  describe('comment-like patterns', () => {
    it('handles text that looks like variables but is plain text', () => {
      expect(renderTemplate('{a}', {})).toBe('{a}');
      expect(renderTemplate('{ {a} }', {})).toBe('{ {a} }');
    });

    it('handles single brace', () => {
      expect(renderTemplate('I have { apples', {})).toBe('I have { apples');
    });

    it('handles mismatched braces', () => {
      expect(renderTemplate('{{a}', {})).toBe('{{a}');
      expect(renderTemplate('{a}}', {})).toBe('{a}}');
    });
  });

  describe('real-world template examples', () => {
    it('renders simple Bible copy template', () => {
      const template = '{{reference}}\n{{#each verses}}\n{{verse}}. {{text}}\n{{/each}}\nVersion: {{version}}';
      const ctx = {
        reference: 'John 3:16-17',
        version: 'KJV',
        verses: [
          { verse: 16, text: 'For God so loved the world...' },
          { verse: 17, text: 'For God sent not his Son...' },
        ],
      };
      const result = renderTemplate(template, ctx);
      expect(result).toContain('John 3:16-17');
      expect(result).toContain('16. For God so loved the world...');
      expect(result).toContain('17. For God sent not his Son...');
      expect(result).toContain('Version: KJV');
    });

    it('renders complex study format with conditionals', () => {
      const template = `{{reference}} ({{version}})
{{#each verses}}
{{verse}}. {{text}}{{#if commentary}} — {{commentary}}{{/if}}
{{/each}}`;
      const ctx = {
        reference: 'John 3:16',
        version: 'KJV',
        verses: [
          { verse: 16, text: 'For God so loved...', commentary: 'God\'s love is unconditional' },
          { verse: 17, text: 'For God sent...', commentary: null },
        ],
      };
      const result = renderTemplate(template, ctx);
      expect(result).toContain('God\'s love is unconditional');
      expect(result).not.toContain(' — null');
    });

    it('renders paragraph-based format', () => {
      const template = `{{#each paragraphs}}{{#unless @first}}

{{/unless}}{{#each verses}}{{#unless @first}} {{/unless}}{{text}}{{/each}}{{/each}}`;
      const ctx = {
        paragraphs: [
          { verses: [{ text: 'For God so' }, { text: 'loved the world' }] },
          { verses: [{ text: 'that he gave' }, { text: 'his only Son' }] },
        ],
      };
      const result = renderTemplate(template, ctx);
      expect(result).toContain('For God so loved the world');
      expect(result).toContain('that he gave his only Son');
      expect(result).toContain('\n\n');
    });

    it('renders comparison format with multiple versions', () => {
      const template = '{{#each versions}}{{#unless @first}} | {{/unless}}{{version}}: {{#each verses}}{{text}} {{/each}}{{/each}}';
      const ctx = {
        versions: [
          { version: 'KJV', verses: [{ text: 'For God' }, { text: 'so loved' }] },
          { version: 'ESV', verses: [{ text: 'For God' }, { text: 'so loved' }] },
        ],
      };
      const result = renderTemplate(template, ctx);
      expect(result).toContain('KJV:');
      expect(result).toContain('ESV:');
      expect(result).toContain('|');
    });
  });
});

// -- {{#blockquote}} -------------------------------------------------

/**
 * The block-quote helper exists because the engine emits a plain string: there
 * is no structure to mark a region as a quotation with, so it has to be
 * written into the text. `> ` is the notation that survives everywhere the
 * copied text can land, and the helper's whole job is applying it to lines the
 * template author cannot count in advance.
 */
describe('CopyService.renderTemplate: {{#blockquote}}', () => {
  it('prefixes a single line', () => {
    expect(renderTemplate('{{#blockquote}}{{text}}{{/blockquote}}', { text: 'For God so loved' }))
      .toBe('> For God so loved');
  });

  it('prefixes every line of a multi-line region', () => {
    const template = '{{#blockquote}}{{#each verses}}{{verse}} {{text}}\n{{/each}}{{/blockquote}}';
    const ctx = { verses: [{ verse: 16, text: 'For God' }, { verse: 17, text: 'For God sent' }] };
    expect(renderTemplate(template, ctx)).toBe('> 16 For God\n> 17 For God sent\n');
  });

  // A trailing newline is the separator *after* the quote, not a last line of
  // it: quoting it would render as an extra blank quoted line.
  it('leaves trailing newlines outside the quote', () => {
    expect(renderTemplate('{{#blockquote}}one\n\n{{/blockquote}}after', {}))
      .toBe('> one\n\nafter');
  });

  it('writes a blank line inside the region as a bare ">"', () => {
    expect(renderTemplate('{{#blockquote}}one\n\ntwo{{/blockquote}}', {}))
      .toBe('> one\n>\n> two');
  });

  it('emits nothing at all for an empty region', () => {
    expect(renderTemplate('a{{#blockquote}}{{missing}}{{/blockquote}}b', {})).toBe('ab');
  });

  it('nests, producing CommonMark nested quotes', () => {
    const template = '{{#blockquote}}outer\n{{#blockquote}}inner{{/blockquote}}{{/blockquote}}';
    expect(renderTemplate(template, {})).toBe('> outer\n> > inner');
  });

  it('quotes the result of loops and conditionals, not their source', () => {
    const template =
      '{{#blockquote}}{{#each verses}}{{text}}\n{{/each}}{{#if note}}{{note}}{{/if}}{{/blockquote}}';
    const ctx = { verses: [{ text: 'a' }, { text: 'b' }], note: 'c' };
    expect(renderTemplate(template, ctx)).toBe('> a\n> b\n> c');
  });

  it('composes with #each so each item is quoted in turn', () => {
    const template = '{{#each verses}}{{#blockquote}}{{text}}{{/blockquote}}\n{{/each}}';
    const ctx = { verses: [{ text: 'a' }, { text: 'b' }] };
    expect(renderTemplate(template, ctx)).toBe('> a\n> b\n');
  });

  it('is what the built-in "Quote block" template is written with', () => {
    const builtin = BUILTIN_TEMPLATES.find(t => t.name === 'Quote block');
    expect(builtin?.template).toContain('{{#blockquote}}');
    const result = renderTemplate(builtin!.template, {
      verses: [{ text: 'For God so loved the world' }],
      reference: 'John 3:16',
      version: 'KJV',
    });
    expect(result).toBe('> For God so loved the world\n>\n> — John 3:16 (KJV)');
  });
});

/**
 * A mistyped helper must not be indistinguishable from a missing variable.
 * Rendering it as nothing takes its whole region's contents with it, and that
 * is the one class of template mistake the user cannot debug by looking at the
 * preview - so it throws instead.
 */
describe('CopyService.renderTemplate: unknown helpers', () => {
  it('throws on an unrecognised section helper', () => {
    expect(() => renderTemplate('{{#blockqoute}}x{{/blockqoute}}', {})).toThrow(TemplateSyntaxError);
  });

  it('names the offending tag and the helpers that do exist', () => {
    expect(() => renderTemplate('{{#quote}}x{{/quote}}', {})).toThrow(/#quote/);
    expect(() => renderTemplate('{{#quote}}x{{/quote}}', {})).toThrow(/#blockquote/);
  });

  it('throws on an unrecognised closing tag', () => {
    expect(() => renderTemplate('{{/nope}}', {})).toThrow(TemplateSyntaxError);
  });

  it('throws on a known helper written without its argument', () => {
    expect(() => renderTemplate('{{#each}}x{{/each}}', {})).toThrow(TemplateSyntaxError);
  });

  // Variables stay lenient: a name absent from one passage's context and
  // present in another's is ordinary, not a mistake.
  it('still renders an unknown plain variable as empty', () => {
    expect(renderTemplate('a{{nosuchthing}}b', {})).toBe('ab');
  });
});
