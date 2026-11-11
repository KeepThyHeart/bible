/**
 * The pronunciation overlay for a run, read from disk in the layout of bible-scripts'
 * `pronunciation/` folder (which `fetch:piper` installs into `<data>/audio/pronunciation/`):
 *
 *   <dir>/<locale>/lexicon.json   <dir>/<language>/<MODULE>.json   <dir>/<locale>/<MODULE>.json (optional)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parsePronunciationLexicon,
  parsePronunciationModule,
  parsePronunciationSenses,
  pronunciationFiles,
  type PronunciationOverlay,
} from './core';
import type { EngineDefinition } from './engines/types';

export interface LoadedPronunciation {
  overlay: PronunciationOverlay | null;
  /** One line for the log. */
  summary: string;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`${path} is not valid JSON: ${(e as Error).message}`); }
}

/** A module's file, tried as given and upper-cased (`kjv` finds `KJV.json`). */
function readModuleJson(dir: string, rel: string, moduleAbbr: string): { path: string; raw: unknown } {
  const path = join(dir, rel);
  const upper = `${rel.slice(0, -`${moduleAbbr}.json`.length)}${moduleAbbr.toUpperCase()}.json`;
  const raw = readJson(path) ?? readJson(join(dir, upper));
  return { path, raw };
}

export function loadPronunciation(dir: string, locale: string, moduleAbbr: string): LoadedPronunciation {
  const files = pronunciationFiles(moduleAbbr, locale);
  const language = locale.split('-')[0];
  const lexPath = join(dir, files.lexicon);
  const lexRaw = readJson(lexPath);
  const sen = readModuleJson(dir, files.senses, moduleAbbr);
  const mod = readModuleJson(dir, files.module, moduleAbbr);
  const lexicon = lexRaw === undefined ? null : parsePronunciationLexicon(lexRaw);
  const senses = sen.raw === undefined ? null : parsePronunciationSenses(sen.raw);
  const module = mod.raw === undefined ? null : parsePronunciationModule(mod.raw);
  const sameModule = (m: { module: string }) => m.module.toLowerCase() === moduleAbbr.toLowerCase();
  if (lexRaw !== undefined && (!lexicon || lexicon.locale !== locale)) throw new Error(`${lexPath} is not an ${locale} pronunciation lexicon.`);
  if (sen.raw !== undefined && (!senses || senses.language !== language || !sameModule(senses))) {
    throw new Error(`${sen.path} is not the ${language} pronunciation senses file for ${moduleAbbr}.`);
  }
  if (mod.raw !== undefined && (!module || module.locale !== locale || !sameModule(module))) {
    throw new Error(`${mod.path} is not the ${locale} pronunciation file for ${moduleAbbr}.`);
  }
  const parts = [
    lexicon ? `${lexicon.entries.size} words` : null,
    senses && lexicon ? `${senses.verses.size} ${senses.module} verses with homographs` : null,
    module ? `${module.verses.size} ${module.module} verses with overrides` : null,
  ].filter(Boolean);
  return {
    overlay: lexicon || module ? { lexicon, senses, module } : null,
    summary: parts.length > 0 ? `Pronunciation (${locale}): ${parts.join(', ')}.` : `Pronunciation: no ${locale} overlay in ${dir}.`,
  };
}

/** The voice's language (`en-US`): from the engine's voice list, else a Piper-style id (`en_US-amy-low`). */
export function voiceLanguage(def: EngineDefinition, voiceId: string): string | undefined {
  const known = def.voices.find(v => v.id === voiceId)?.language;
  if (known) return known;
  const m = /^([a-z]{2,3})_([A-Za-z]{2})-/.exec(voiceId);
  return m ? `${m[1]}-${m[2].toUpperCase()}` : undefined;
}
