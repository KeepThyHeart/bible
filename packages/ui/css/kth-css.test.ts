// K3: structural tests for the KTH CSS framework (0062). Staleness of the generated files is also
// enforced by `npm run check:kth-css` (in test:scripts); the checks here explain *why* something is wrong.
import { createRequire } from 'module';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const CSS_DIR = __dirname;
const require_ = createRequire(import.meta.url);
const gen = require_(join(ROOT, 'scripts/generate-kth-css.js')) as {
  KTH_MAP: Record<string, { web: string | null; desktop: string | null }>;
  DARK_DEFAULTS: Record<string, string>;
  CONTRACT_CONSTANTS: string[];
  WEB_RUNTIME_VARS: string[];
  render: (palette: unknown) => Record<string, string>;
  validate: (palette: unknown, contractCss: string, themesCss: string) => string[];
};

const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const palette = JSON.parse(read(join(ROOT, 'admin/brand/theme-palettes.json')));
const contractCss = read(join(CSS_DIR, 'kth-contract.css'));
const themesCss = read(join(ROOT, 'apps/desktop/src/ui/styles/themes.css'));
const controlsCss = read(join(ROOT, 'apps/desktop/src/ui/styles/controls.css'));

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : [],
  );
}

/** Flat rule list. Ignores @-rules with blocks (none are used in these files). */
function parseRules(css: string): Array<{ selector: string; decls: Record<string, string> }> {
  const rules: Array<{ selector: string; decls: Record<string, string> }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  const clean = stripComments(css).replace(/@import[^;]*;/g, '');
  while ((m = re.exec(clean))) {
    const decls: Record<string, string> = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
    }
    rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), decls });
  }
  return rules;
}

/** Split a selector list on top-level commas. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

describe('KTH CSS tokens', () => {
  const declared = new Set([...contractCss.matchAll(/(--kth-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

  it('every var(--kth-*) used anywhere in css/ is declared in the contract', () => {
    const undeclared: string[] = [];
    for (const file of cssFiles(CSS_DIR)) {
      for (const m of stripComments(read(file)).matchAll(/var\(\s*(--kth-[a-z0-9-]+)/g)) {
        if (!declared.has(m[1])) undeclared.push(`${file.replace(CSS_DIR, '')}: ${m[1]}`);
      }
    }
    expect(undeclared).toEqual([]);
  });

  it('KTH_MAP keys plus CONTRACT_CONSTANTS equal the contract set', () => {
    expect([...Object.keys(gen.KTH_MAP), ...gen.CONTRACT_CONSTANTS].sort()).toEqual([...declared].sort());
  });

  it('the generator accepts the current inputs', () => {
    expect(gen.validate(palette, contractCss, themesCss)).toEqual([]);
  });

  it('each generated map declares or explicitly omits every mapped token', () => {
    for (const app of ['desktop', 'web'] as const) {
      const css = read(join(CSS_DIR, 'generated', `map-${app}.css`));
      const omittedLine = css.match(/Not mapped here; contract default applies: ([^*]*)\*\//)?.[1] ?? '';
      const omitted = new Set(omittedLine.split(',').map((s) => s.trim()).filter(Boolean));
      for (const [token, entry] of Object.entries(gen.KTH_MAP)) {
        const isDeclared = new RegExp(`^\\s*${token}:`, 'm').test(css);
        if (entry[app]) expect(isDeclared, `${app} declares ${token}`).toBe(true);
        else expect(omitted.has(token), `${app} omits ${token}`).toBe(true);
      }
    }
  });

  it('desktop targets exist in themes.css and web targets are palette tokens', () => {
    const themeVars = new Set([...themesCss.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
    const webTokens = new Set<string>(gen.WEB_RUNTIME_VARS);
    for (const t of Object.values<{ colors: Record<string, unknown> }>(palette.themes)) {
      for (const k of Object.keys(t.colors)) webTokens.add(`--${k}`);
    }
    for (const [token, entry] of Object.entries(gen.KTH_MAP)) {
      for (const ref of [...(entry.desktop ?? '').matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)]) {
        expect(themeVars.has(ref[1]), `${token}: ${ref[1]} in themes.css`).toBe(true);
      }
      for (const ref of [...(entry.web ?? '').matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)]) {
        expect(webTokens.has(ref[1]), `${token}: ${ref[1]} is a web token`).toBe(true);
      }
    }
  });

  it('generated files match the generator output', () => {
    for (const [file, content] of Object.entries(gen.render(palette))) {
      expect(read(file), file).toBe(content);
    }
  });

  it('scheme dark defaults target only mapped-null or constant tokens (nothing an app maps)', () => {
    for (const token of Object.keys(gen.DARK_DEFAULTS)) {
      const entry = gen.KTH_MAP[token];
      if (!entry) continue; // constant (e.g. --kth-color-scheme)
      // A token mapped in an app is overridden there by :root; the dark default only serves unmapped apps.
      expect(entry.web === null || entry.desktop === null, `${token} is unmapped in at least one app`).toBe(true);
    }
  });
});

const NAMED_COLORS = (
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
  'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
  'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
  'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
  'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
  'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
  'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
  'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
  'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
  'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
  'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
  'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
  'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
  'whitesmoke yellow yellowgreen'
).split(' ');

describe('kth-classes.css rules', () => {
  const rules = parseRules(read(join(CSS_DIR, 'kth-classes.css')));

  it('parses a non-trivial number of rules', () => {
    expect(rules.length).toBeGreaterThan(40);
  });

  it('contains no colour literals (only var(--kth-*), transparent, currentColor, inherit)', () => {
    const offenders: string[] = [];
    for (const { selector, decls } of rules) {
      for (const [prop, value] of Object.entries(decls)) {
        // Blank out var() names first so e.g. `--kth-border` is not read as a colour name.
        const v = value.replace(/var\(\s*--[a-zA-Z0-9_-]+/g, 'var(');
        if (/#[0-9a-fA-F]{3,8}\b/.test(v)) offenders.push(`${selector} { ${prop}: ${value} } (hex)`);
        if (/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i.test(v)) offenders.push(`${selector} { ${prop}: ${value} } (function)`);
        for (const word of v.toLowerCase().match(/[a-z]+/g) ?? []) {
          if (NAMED_COLORS.includes(word)) offenders.push(`${selector} { ${prop}: ${value} } (named: ${word})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every selector has exactly one class, and it is a kth- class', () => {
    const offenders: string[] = [];
    for (const { selector } of rules) {
      for (const sel of splitSelectors(selector)) {
        const classes = sel.replace(/\[[^\]]*\]/g, '').match(/\.[A-Za-z_-][\w-]*/g) ?? [];
        if (classes.length !== 1 || !classes[0].startsWith('.kth-')) offenders.push(sel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses logical properties only (no physical width/height/margin-left/... )', () => {
    const physical = /^(width|height|min-width|min-height|max-width|max-height|margin-(left|right|top|bottom)|padding-(left|right|top|bottom)|border-(left|right|top|bottom)(-\w+)?|left|right|top|bottom)$/;
    const offenders: string[] = [];
    for (const { selector, decls } of rules) {
      for (const prop of Object.keys(decls)) if (physical.test(prop)) offenders.push(`${selector} { ${prop} }`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('.kth-toolbar* parity with desktop controls.css (.control-toolbar*)', () => {
  // controls.css stays frozen on --theme-* for extension panels; kth-toolbar must not drift from it.
  const desktopToKth = new Map<string, string>();
  for (const [token, entry] of Object.entries(gen.KTH_MAP)) {
    const m = entry.desktop?.match(/^var\((--theme-[a-z-]+)\)$/);
    if (m) desktopToKth.set(m[1], token);
  }
  const logical: Record<string, string> = {
    'min-width': 'min-inline-size',
    width: 'inline-size',
    height: 'block-size',
    'border-bottom': 'border-block-end',
  };
  const normalizeControl = (decls: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [prop, value] of Object.entries(decls)) {
      out[logical[prop] ?? prop] = value.replace(/var\((--theme-[a-z-]+)\)/g, (_, name: string) => {
        const kth = desktopToKth.get(name);
        if (!kth) throw new Error(`${name} has no --kth-* counterpart in KTH_MAP`);
        return `var(${kth})`;
      });
    }
    return out;
  };
  const normalizeKth = (decls: Record<string, string>) => {
    const out: Record<string, string> = {};
    // The divider knob is the one intentional difference; fold its default back to the literal.
    for (const [prop, value] of Object.entries(decls)) out[prop] = value.replace('var(--_kth-divider-width, 1px)', '1px');
    return out;
  };
  const toKthSelector = (sel: string) =>
    sel
      .replace(/^\.control-toolbar-button/, '.kth-toolbar__button')
      .replace(/^\.control-toolbar__group/, '.kth-toolbar__group')
      .replace(/^\.control-toolbar(?![\w-])/, '.kth-toolbar')
      .replace(/^\.control-icon$/, '.kth-toolbar__icon')
      .replace(/:hover:not\(:disabled\)$/, ':where(:hover:not(:disabled))')
      .replace(/:disabled$/, ':where(:disabled)');

  const controlRules = parseRules(controlsCss).filter((r) => /^\.control-(toolbar|icon)/.test(r.selector));
  const kthRules = new Map(parseRules(read(join(CSS_DIR, 'kth-classes.css'))).map((r) => [r.selector, r.decls]));

  it('finds the control-toolbar rules', () => {
    expect(controlRules.length).toBeGreaterThanOrEqual(8);
  });

  for (const rule of controlRules) {
    // The two-class `--divider-strong.--divider-end` compounds are replaced by the private knob (tested below).
    if ((rule.selector.match(/\.control-/g) ?? []).length > 1) continue;
    it(`${rule.selector} matches its .kth-* counterpart`, () => {
      const target = toKthSelector(rule.selector);
      const kthDecls = kthRules.get(target);
      expect(kthDecls, `no rule ${target}`).toBeDefined();
      expect(normalizeKth(kthDecls!)).toEqual(normalizeControl(rule.decls));
    });
  }

  it('models the strong divider through the --_kth-divider-width knob', () => {
    expect(kthRules.get('.kth-toolbar__button--divider-strong')).toEqual({ '--_kth-divider-width': '2px' });
    const strong = controlRules.filter((r) => r.selector.includes('--divider-strong'));
    expect(strong.every((r) => Object.values(r.decls).every((v) => v === '2px'))).toBe(true);
  });
});
