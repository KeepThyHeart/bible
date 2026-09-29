import {
  CONNECTIVE_CATEGORIES, MARK_COLOR_KEYS, MARK_LINES, MARK_SYMBOLS,
  type KeywordMark, type KeywordSet, type MatchRule, type KeywordValidationError,
} from './types';

const MAX_MARKS = 200;
const MAX_FORMS = 100;
const MAX_TEXT = 200;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateRule(r: unknown, path: string, errs: KeywordValidationError[]): MatchRule | undefined {
  if (!isObj(r)) { errs.push({ path, message: 'rule must be an object' }); return undefined; }
  switch (r.kind) {
    case 'word': {
      if (!Array.isArray(r.forms) || r.forms.length === 0 || r.forms.length > MAX_FORMS
        || !r.forms.every((f) => typeof f === 'string' && f.trim().length > 0 && f.length <= MAX_TEXT)) {
        errs.push({ path: `${path}.forms`, message: 'forms must be 1-100 non-empty strings' }); return undefined;
      }
      return { kind: 'word', forms: r.forms.map((f: string) => f.trim()), ...(r.matchCase === true ? { matchCase: true } : {}) };
    }
    case 'phrase': {
      if (typeof r.text !== 'string' || r.text.trim().length === 0 || r.text.length > MAX_TEXT) {
        errs.push({ path: `${path}.text`, message: 'phrase text must be a non-empty string' }); return undefined;
      }
      return { kind: 'phrase', text: r.text.trim(), ...(r.matchCase === true ? { matchCase: true } : {}) };
    }
    case 'strongs': {
      if (!Array.isArray(r.numbers) || r.numbers.length === 0 || r.numbers.length > MAX_FORMS
        || !r.numbers.every((n) => typeof n === 'string' && /^[GHgh]\d{1,5}[a-zA-Z]?$/.test(n.trim()))) {
        errs.push({ path: `${path}.numbers`, message: 'numbers must look like G4102 or H430' }); return undefined;
      }
      return { kind: 'strongs', numbers: r.numbers.map((n: string) => n.trim().toUpperCase()) };
    }
    case 'connective': {
      if (!(CONNECTIVE_CATEGORIES as readonly unknown[]).includes(r.category)) {
        errs.push({ path: `${path}.category`, message: 'unknown connective category' }); return undefined;
      }
      return { kind: 'connective', category: r.category as never };
    }
    default:
      errs.push({ path: `${path}.kind`, message: 'unknown rule kind' });
      return undefined;
  }
}

function validateMark(m: unknown, path: string, errs: KeywordValidationError[]): KeywordMark | undefined {
  if (!isObj(m)) { errs.push({ path, message: 'mark must be an object' }); return undefined; }
  const before = errs.length;
  if (typeof m.id !== 'string' || !m.id) errs.push({ path: `${path}.id`, message: 'id required' });
  if (typeof m.label !== 'string' || !m.label.trim() || m.label.length > MAX_TEXT) errs.push({ path: `${path}.label`, message: 'label required' });
  const rule = validateRule(m.rule, `${path}.rule`, errs);
  const st = m.style;
  if (!isObj(st)) errs.push({ path: `${path}.style`, message: 'style required' });
  else {
    if (!(MARK_COLOR_KEYS as readonly unknown[]).includes(st.color)) errs.push({ path: `${path}.style.color`, message: 'unknown colour key' });
    if (!(MARK_LINES as readonly unknown[]).includes(st.line)) errs.push({ path: `${path}.style.line`, message: 'unknown line style' });
    if (st.symbol !== undefined && !(MARK_SYMBOLS as readonly unknown[]).includes(st.symbol)) errs.push({ path: `${path}.style.symbol`, message: 'unknown symbol' });
  }
  if (errs.length > before || !rule || !isObj(st)) return undefined;
  return {
    id: m.id as string, label: (m.label as string).trim(), rule,
    style: {
      color: st.color as never, line: st.line as never,
      ...(st.fill === 'subtle' ? { fill: 'subtle' as const } : {}),
      ...(st.bold === true ? { bold: true } : {}),
      ...(st.symbol !== undefined ? { symbol: st.symbol as never } : {}),
    },
    enabled: m.enabled !== false,
    ...(typeof m.note === 'string' && m.note ? { note: m.note.slice(0, 1000) } : {}),
  };
}

/** Validate untrusted JSON (imported file, stored row). Returns a clean set or the errors. */
export function validateKeywordSet(json: unknown): KeywordSet | KeywordValidationError[] {
  const errs: KeywordValidationError[] = [];
  if (!isObj(json)) return [{ path: '', message: 'set must be an object' }];
  if (json.schema !== 1) errs.push({ path: 'schema', message: 'unsupported schema version' });
  if (typeof json.id !== 'string' || !json.id) errs.push({ path: 'id', message: 'id required' });
  if (typeof json.name !== 'string' || !json.name.trim() || json.name.length > MAX_TEXT) errs.push({ path: 'name', message: 'name required' });
  if (json.language !== undefined && (typeof json.language !== 'string' || !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/.test(json.language))) {
    errs.push({ path: 'language', message: 'language must be a BCP 47 tag' });
  }
  let scope: KeywordSet['scope'] = { kind: 'everywhere' };
  const sc = json.scope;
  if (sc !== undefined) {
    if (!isObj(sc)) errs.push({ path: 'scope', message: 'scope must be an object' });
    else if (sc.kind === 'everywhere') scope = { kind: 'everywhere' };
    else if (sc.kind === 'books' && Array.isArray(sc.books) && sc.books.every((b) => Number.isInteger(b) && b >= 1 && b <= 66)) {
      scope = { kind: 'books', books: sc.books as number[] };
    } else if (sc.kind === 'passage' && Number.isInteger(sc.start) && Number.isInteger(sc.end) && (sc.start as number) <= (sc.end as number)) {
      scope = { kind: 'passage', start: sc.start as number, end: sc.end as number };
    } else errs.push({ path: 'scope', message: 'invalid scope' });
  }
  const marks: KeywordMark[] = [];
  if (!Array.isArray(json.marks) || json.marks.length > MAX_MARKS) errs.push({ path: 'marks', message: 'marks must be an array of up to 200' });
  else {
    const ids = new Set<string>();
    json.marks.forEach((m, i) => {
      const v = validateMark(m, `marks[${i}]`, errs);
      if (v) {
        if (ids.has(v.id)) errs.push({ path: `marks[${i}].id`, message: 'duplicate mark id' });
        ids.add(v.id); marks.push(v);
      }
    });
  }
  if (errs.length) return errs;
  return {
    schema: 1, id: json.id as string, name: (json.name as string).trim(),
    ...(typeof json.language === 'string' ? { language: json.language } : {}),
    scope, marks,
    ...(typeof json.builtIn === 'string' ? { builtIn: json.builtIn } : {}),
    updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : new Date(0).toISOString(),
  };
}

export function isValidationErrors(v: KeywordSet | KeywordValidationError[]): v is KeywordValidationError[] {
  return Array.isArray(v);
}

/** File format for export/import: a versioned wrapper around one set. */
export function exportKeywordSet(set: KeywordSet): string {
  const { builtIn: _b, ...rest } = set;
  return JSON.stringify({ format: 'keyword-set', ...rest }, null, 2);
}

export function importKeywordSet(text: string): KeywordSet | KeywordValidationError[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return [{ path: '', message: 'not valid JSON' }]; }
  if (isObj(parsed)) { const { format: _f, builtIn: _b, ...rest } = parsed as Record<string, unknown>; parsed = rest; }
  return validateKeywordSet(parsed);
}
