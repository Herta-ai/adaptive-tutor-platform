import { createReadStream, readdirSync, lstatSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

export function staticPages(directory: string) {
  // Only serve files discovered in the export; request paths never become filesystem paths.
  const files = new Map<string, string>();
  function walk(path: string, prefix = '') {
    for (const name of readdirSync(path)) {
      const file = join(path, name),
        url = `${prefix}/${name}`;
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`静态页面不得包含文件链接：${file}`);
      if (stat.isDirectory()) walk(file, url);
      else if (stat.isFile()) files.set(url, file);
    }
  }
  walk(directory);
  if (!files.has('/index.html')) throw new Error('缺少静态页面，请先运行 pnpm build');
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const file = files.get(path === '/' ? '/index.html' : path);
    const target = file ?? files.get('/404.html');
    if (!target) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(file ? 200 : 404, {
      'content-type': types[extname(target)] ?? 'application/octet-stream',
      'content-length': statSync(target).size,
      'cache-control':
        file && path.startsWith('/_next/static/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(target), res);
  };
}
