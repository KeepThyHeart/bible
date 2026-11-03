/**
 * Keeps modules the site has switched off (`active: false` in settings.json)
 * unreachable by name, not only absent from the lists.
 *
 * `GET /api/modules` and the multi-module routes already filter by visibility,
 * but any route taking a module name used to serve whatever was installed, so a
 * caller who guessed an abbreviation could read a hidden module in full. These
 * helpers answer such a request exactly as if the module were not installed.
 *
 * Without settings (`siteSettings` null — a router constructed directly, as the
 * route tests do), or without a section for this kind of module, every module
 * counts as visible: the same rule the commentary and dictionary lists apply.
 * Production has all three sections.
 */

import type { RequestParamHandler } from 'express';
import { isModuleActive, type SiteSettings } from '../siteSettings.js';
import { sendError, ErrorCodes } from './errorResponse.js';
import { validateModuleName } from './validation.js';

/** The settings.json sections that control visibility. */
export type ManagedModuleKind = 'bibles' | 'commentaries' | 'dictionaries';

/** Whether `name` (an abbreviation, any case) may be served for this kind of module. */
export function isNamedModuleVisible(
  siteSettings: SiteSettings | null | undefined,
  kind: ManagedModuleKind,
  name: string,
): boolean {
  return !siteSettings?.[kind] || isModuleActive(siteSettings[kind], name);
}

/**
 * A `router.param('module', ...)` handler: a hidden module answers 404
 * MODULE_NOT_FOUND before the route runs. A malformed name passes through, so
 * the route's own validation still answers 400 as before.
 */
export function moduleVisibilityParam(
  siteSettings: SiteSettings | null | undefined,
  kind: ManagedModuleKind,
): RequestParamHandler {
  return (_req, res, next, value) => {
    if (typeof value !== 'string' || !validateModuleName(value) || isNamedModuleVisible(siteSettings, kind, value)) {
      next();
      return;
    }
    sendError(res, 404, ErrorCodes.MODULE_NOT_FOUND, `Module not found: ${value}`);
  };
}
