import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticPages } from '../src/server/static-pages.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function serve() {
  const root = mkdtempSync(join(tmpdir(), 'tutor-static-'));
  const out = join(root, 'out');
  mkdirSync(join(out, '_next/static'), { recursive: true });
  writeFileSync(join(root, 'secret.txt'), 'private');
  writeFileSync(join(out, 'index.html'), '<html>studio</html>');
  writeFileSync(join(out, '404.html'), '<html>not found</html>');
  writeFileSync(join(out, '_next/static/chunk.js'), 'console.log("loaded")');
  writeFileSync(join(out, '_next/static/font.woff2'), Buffer.from([1, 2, 3]));
  const handler = staticPages(out);
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(root, { recursive: true, force: true });
  });
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

it('serves exported HTML, JS and fonts with correct MIME, caching and HEAD behavior', async () => {
  const origin = await serve();
  const page = await fetch(origin + '/?test=1');
  expect(page.status).toBe(200);
  expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(page.headers.get('cache-control')).toBe('no-cache');
  expect(await page.text()).toBe('<html>studio</html>');
  const js = await fetch(origin + '/_next/static/chunk.js');
  expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  expect(js.headers.get('cache-control')).toContain('immutable');
  expect(await js.text()).toContain('loaded');
  const font = await fetch(origin + '/_next/static/font.woff2', { method: 'HEAD' });
  expect(font.headers.get('content-type')).toBe('font/woff2');
  expect(font.headers.get('content-length')).toBe('3');
  expect(await font.text()).toBe('');
});

it('rejects writes, malformed paths and paths outside the export', async () => {
  const origin = await serve();
  const post = await fetch(origin, { method: 'POST' });
  expect(post.status).toBe(405);
  expect(post.headers.get('allow')).toBe('GET, HEAD');
  for (const path of [
    '/missing',
    '/..%2fsecret.txt',
    '/%2e%2e%5csecret.txt',
    '/C%3a/secret.txt',
    '/.env',
    '/node_modules/next/package.json',
  ]) {
    const response = await fetch(origin + path);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('<html>not found</html>');
  }
  expect((await fetch(origin + '/%ZZ')).status).toBe(400);
});
