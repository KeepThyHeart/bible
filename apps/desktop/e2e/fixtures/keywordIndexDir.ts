import path from 'path';
import os from 'os';

/**
 * The keyword-search index directory every e2e Electron instance shares (`BIBLE_KEYWORD_INDEX_DIR`,
 * honoured only under NODE_ENV=test). `globalSetup.ts` fills it once; it survives between runs, and the
 * app rebuilds an index there only when its module changed.
 */
export const E2E_KEYWORD_INDEX_DIR = path.join(os.tmpdir(), 'bible-e2e-keyword-index');
