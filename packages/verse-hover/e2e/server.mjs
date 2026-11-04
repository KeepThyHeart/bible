// Tiny static server for the Playwright tests and the demo: /dist, /demo, /data (generated static Bible data).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const dataDir = process.env.VH_DATA || resolve(root, 'e2e/.data');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gz': 'application/gzip', '.php': 'text/plain' };
const mounts = { '/dist/': resolve(root, 'dist'), '/demo/': resolve(root, 'demo'), '/data/': dataDir };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  for (const [prefix, dir] of Object.entries(mounts)) {
    if (!url.pathname.startsWith(prefix)) continue;
    const file = normalize(join(dir, decodeURIComponent(url.pathname.slice(prefix.length))));
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) break;
    // A deliberate delay on slow.json lets tests see the loading state.
    const delay = url.searchParams.get('delay') ? Number(url.searchParams.get('delay')) : 0;
    setTimeout(() => {
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
      res.end(readFileSync(file));
    }, delay);
    return;
  }
  res.writeHead(404).end('not found');
}).listen(port, () => console.log('verse-hover test server on', port));
