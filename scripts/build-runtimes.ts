import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url),
  output = join(process.cwd(), '.runtime-build');
mkdirSync(output, { recursive: true });
await build({
  entryPoints: ['src/code-sandbox/worker.ts'],
  outfile: join(output, 'worker.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  external: ['node:*', 'fs', 'path', 'crypto', 'ws', 'child_process'],
  logLevel: 'warning',
});
const quickRequire = createRequire(require.resolve('quickjs-emscripten'));
const files: Record<string, string> = {
  'quickjs.wasm': quickRequire.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'),
  'sql.wasm': require.resolve('sql.js/dist/sql-wasm.wasm'),
};
for (const name of ['pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'])
  files[name] = require.resolve('pyodide/' + name);
for (const [name, path] of Object.entries(files)) copyFileSync(path, join(output, name));
const numpy = JSON.parse(readFileSync(require.resolve('pyodide/pyodide-lock.json'), 'utf8'))
  .packages.numpy;
if (process.argv.includes('--numpy') && !existsSync(join(output, numpy.file_name))) {
  const url = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/' + numpy.file_name;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error('NumPy 下载失败：' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > 20 * 1024 * 1024 ||
    createHash('sha256').update(bytes).digest('hex') !== numpy.sha256
  )
    throw Error('NumPy 包 hash 或大小无效');
  writeFileSync(join(output, numpy.file_name), bytes);
}
if (existsSync(join(output, numpy.file_name))) {
  const bytes = readFileSync(join(output, numpy.file_name));
  if (createHash('sha256').update(bytes).digest('hex') !== numpy.sha256)
    throw Error('缓存的 NumPy 包 hash 无效');
  files[numpy.file_name] = join(output, numpy.file_name);
}
const manifest = Object.fromEntries(
  ['worker.js', ...Object.keys(files)].map((name) => {
    const data = readFileSync(join(output, name));
    return [name, { size: data.length, sha256: createHash('sha256').update(data).digest('hex') }];
  }),
);
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('固定版本 WASM 运行库已构建；没有下载或编译原生 Node 模块。');
