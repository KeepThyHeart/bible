/**
 * Prepare step of the web manifest: reuse the e2e fixture data (snapshot of main.db plus the
 * checked-in site config). Run by tsx with apps/web as cwd. The last stdout line is the JSON
 * the driver reads as ${prepare.dataDir} and ${prepare.modulesDir}.
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Dynamic and by variable: prepareData.ts uses extensionless imports that this package's
// NodeNext typecheck would reject, and tsx resolves them fine at run time.
const file = path.resolve(import.meta.dirname, '../../../apps/web/e2e/prepareData.ts');
const { prepareE2eData } = (await import(pathToFileURL(file).href)) as {
  prepareE2eData: () => { dataDir: string; modulesDir: string };
};
const { dataDir, modulesDir } = prepareE2eData();
console.log(JSON.stringify({ dataDir, modulesDir }));
