/**
 * The one place the tool imports `@bible/core` from. The tool is CommonJS like core,
 * so these are plain re-exports; keeping them here makes the dependency surface visible.
 */

export {
  BibleRepository,
  getBookNumber,
  getBookName,
  type ISql,
  type SqlParameter,
  type SqlRow,
  type SqlResult,
} from '@bible/core';
export { Usfm } from '@bible/core';

export {
  AUDIO_INDEX_SCHEMA,
  CHAPTER_MANIFEST_SCHEMA,
  TextPreparer,
  parseVoiceConfig,
  phonemesToIds,
  piperPhonemizerArgs,
  parsePhonemizerLines,
  piperScales,
  piperSilenceSamples,
  validateAudioIndex,
  validateChapterManifest,
  type AudioCredit,
  type AudioBuildInfo,
  type AudioError,
  type AudioNarrator,
  type AudioProvenance,
  type AudioVoice,
  type ChapterManifest,
  type ITextPreparer,
  type ITtsEngine,
  type LoadProgress,
  type ManifestFile,
  type ManifestVerse,
  type PiperVoiceConfig,
  type SynthesisRequest,
  type SynthesisResult,
  type TranslationAudioIndex,
  type TtsEngineCapabilities,
  type VerseText,
} from '@bible/core/browser';
