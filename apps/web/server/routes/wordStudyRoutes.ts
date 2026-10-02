import { Router } from 'express';
import type { IBibleRepository, WordStudyService as WordStudyServiceT, WordStudyOptions, WordStudySubject, WordOccurrenceQuery } from '@bible/core';
import type { DatabaseManager } from '../DatabaseManager.js';
import { StrongsNumberHelper, WordStudyService } from '../core.js';
import { validateModuleName, validateSearchQuery } from '../utils/validation.js';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { getSettingsKey, isModuleActive, type SiteSettings } from '../siteSettings.js';
import { registerRoute } from './routeRegistry.js';
import { logger } from '../utils/logger.js';

export const MAX_TERMS = 60;
export const MAX_TERM_LENGTH = 80;
export const MAX_OCCURRENCE_LIMIT = 500;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

function parseTermList(value: unknown, field: string, required: boolean): Parsed<string[]> {
  if (value === undefined || value === null) {
    return required ? fail(`${field} is required`) : { ok: true, value: [] };
  }
  if (!Array.isArray(value)) return fail(`${field} must be an array of strings`);
  if (value.length > MAX_TERMS) return fail(`${field} may hold at most ${MAX_TERMS} entries`);
  const out: string[] = [];
  for (const t of value) {
    if (typeof t !== 'string') return fail(`${field} must be an array of strings`);
    const trimmed = t.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_TERM_LENGTH) return fail(`each ${field} entry may be at most ${MAX_TERM_LENGTH} characters`);
    out.push(trimmed);
  }
  return { ok: true, value: out };
}

/** Strictly validate a request's `subject` into a {@link WordStudySubject}. */
export function parseSubject(raw: unknown): Parsed<WordStudySubject> {
  if (!raw || typeof raw !== 'object') return fail('subject is required');
  const s = raw as Record<string, unknown>;
  if (s.kind === 'strongs') {
    if (typeof s.strongs !== 'string') return fail('subject.strongs must be a Strong\'s number (e.g. G25, H157)');
    const display = StrongsNumberHelper.toDisplayFormat(s.strongs.trim());
    if (!display) return fail('Invalid Strong\'s number format (e.g., G2316, H1234)');
    return { ok: true, value: { kind: 'strongs', strongs: display } };
  }
  if (s.kind === 'group') {
    const g = s.group;
    if (!g || typeof g !== 'object') return fail('subject.group is required');
    const group = g as Record<string, unknown>;
    if (typeof group.label !== 'string' || !group.label.trim() || group.label.length > MAX_TERM_LENGTH) {
      return fail(`group.label is required (at most ${MAX_TERM_LENGTH} characters)`);
    }
    const id = group.id === undefined ? 'adhoc' : group.id;
    if (typeof id !== 'string' || id.length > 100) return fail('group.id must be a string of at most 100 characters');
    const terms = parseTermList(group.terms, 'group.terms', true);
    if (!terms.ok) return terms;
    if (terms.value.length === 0) return fail('group.terms must contain at least one term');
    const exclude = parseTermList(group.exclude, 'group.exclude', false);
    if (!exclude.ok) return exclude;
    if (group.stem !== undefined && typeof group.stem !== 'boolean') return fail('group.stem must be a boolean');
    return {
      ok: true,
      value: {
        kind: 'group',
        group: {
          id,
          label: group.label.trim(),
          terms: terms.value,
          ...(exclude.value.length ? { exclude: exclude.value } : {}),
          ...(group.stem !== undefined ? { stem: group.stem as boolean } : {}),
        },
      },
    };
  }
  return fail('subject.kind must be "strongs" or "group"');
}

function parseModule(value: unknown): Parsed<string | undefined> {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'string' || !validateModuleName(value)) return fail('Invalid module name');
  return { ok: true, value };
}

function parseRenderingMode(value: unknown): Parsed<'head' | 'phrase' | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (value === 'head' || value === 'phrase') return { ok: true, value };
  return fail('renderingMode must be "head" or "phrase"');
}

function parseInt0(value: unknown, field: string, min: number, max: number): Parsed<number | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fail(`${field} must be an integer between ${min} and ${max}`);
  }
  return { ok: true, value };
}

export function createWordStudyRoutes(db: DatabaseManager, siteSettings: SiteSettings | null = null): Router {
  const router = Router();
  let service: WordStudyServiceT | null = null;

  /** Installed, site-active Bible modules the server actually serves (full repos). */
  const servedBibles = (): Map<string, IBibleRepository> => {
    const out = new Map<string, IBibleRepository>();
    // Fail-safe like /api/modules: no settings means no modules visible.
    if (!siteSettings) return out;
    const key = getSettingsKey('bible');
    for (const m of db.getModuleMetadataRepo().getByType('bible')) {
      const abbr = m.abbreviation || m.getAbbreviation();
      if (!abbr || (key && !isModuleActive(siteSettings[key], abbr))) continue;
      const repo = db.getBibleRepo(abbr);
      if (repo) out.set(abbr, repo);
    }
    return out;
  };

  const getService = (): WordStudyServiceT => {
    if (!service) {
      service = new WordStudyService({
        bibles: servedBibles,
        greek: db.getDictionaryRepo('strongsgreek'),
        hebrew: db.getDictionaryRepo('strongshebrew'),
        family: db.getWordFamilyService(),
      });
    }
    return service;
  };

  router.get('/resolve', (req, res): void => {
    try {
      const q = validateSearchQuery(req.query.q);
      if (!q) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Query parameter q is required'); return; }
      res.json(getService().resolve(q));
    } catch (error) {
      logger.error('Word study resolve failed:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to resolve word');
    }
  });

  router.post('/overview', (req, res): void => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const subject = parseSubject(body.subject);
      if (!subject.ok) { sendError(res, 400, ErrorCodes.INVALID_PARAM, subject.message); return; }
      const opts = (body.options ?? {}) as Record<string, unknown>;
      if (typeof opts !== 'object' || Array.isArray(opts)) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'options must be an object'); return; }
      const module = parseModule(opts.module);
      if (!module.ok) { sendError(res, 400, ErrorCodes.INVALID_PARAM, module.message); return; }
      const mode = parseRenderingMode(opts.renderingMode);
      if (!mode.ok) { sendError(res, 400, ErrorCodes.INVALID_PARAM, mode.message); return; }
      const options: WordStudyOptions = {
        ...(module.value ? { module: module.value } : {}),
        ...(mode.value ? { renderingMode: mode.value } : {}),
      };
      res.json(getService().getOverview(subject.value, options));
    } catch (error) {
      logger.error('Word study overview failed:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to build word study');
    }
  });

  router.post('/occurrences', (req, res): void => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const subject = parseSubject(body.subject);
      if (!subject.ok) { sendError(res, 400, ErrorCodes.INVALID_PARAM, subject.message); return; }
      const q = body.query;
      if (!q || typeof q !== 'object' || Array.isArray(q)) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'query is required'); return; }
      const query = q as Record<string, unknown>;
      const module = parseModule(query.module);
      if (!module.ok || !module.value) { sendError(res, 400, ErrorCodes.INVALID_PARAM, 'query.module is required and must be a valid module name'); return; }
      if (!servedBibles().has(module.value)) { sendError(res, 404, ErrorCodes.NOT_FOUND, `Module not available: ${module.value}`); return; }
      const book = parseInt0(query.book, 'query.book', 1, 66);
      if (!book.ok) { sendError(res, 400, ErrorCodes.INVALID_PARAM, book.message); return; }
      const offset = parseInt0(query.offset, 'query.offset', 0, 10_000_000);
      if (!offset.ok) { sendError(res, 400, ErrorCodes.INVALID_PARAM, offset.message); return; }
      const limit = parseInt0(query.limit, 'query.limit', 1, MAX_OCCURRENCE_LIMIT);
      if (!limit.ok) { sendError(res, 400, ErrorCodes.INVALID_PARAM, limit.message); return; }
      const mode = parseRenderingMode(query.renderingMode);
      if (!mode.ok) { sendError(res, 400, ErrorCodes.INVALID_PARAM, mode.message); return; }
      if (query.form !== undefined && (typeof query.form !== 'string' || query.form.length > 200)) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'query.form must be a string of at most 200 characters'); return;
      }
      const wq: WordOccurrenceQuery = {
        module: module.value,
        ...(book.value !== undefined ? { book: book.value } : {}),
        ...(query.form !== undefined ? { form: query.form as string } : {}),
        ...(mode.value ? { renderingMode: mode.value } : {}),
        ...(offset.value !== undefined ? { offset: offset.value } : {}),
        ...(limit.value !== undefined ? { limit: limit.value } : {}),
      };
      res.json(getService().getOccurrences(subject.value, wq));
    } catch (error) {
      logger.error('Word study occurrences failed:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to list occurrences');
    }
  });

  return router;
}

registerRoute({
  path: '/api/word-study',
  createRoutes: (deps) => createWordStudyRoutes(deps.db, deps.siteSettings),
});
