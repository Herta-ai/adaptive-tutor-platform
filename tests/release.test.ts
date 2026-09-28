import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archivePath, createZip, extractZip, filesIn, sha256 } from '../scripts/release/files.js';
import { mcpRegistrationCommand, psLiteral } from '../src/server/installation.js';
import { collectLicenses } from '../scripts/release/licenses.js';
const roots: string[] = [];
it('collects dependency notices without code, including packages named like Node built-ins', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-licenses-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      dependencies: { string_decoder: '1.0.0' },
      optionalDependencies: { missing: '1.0.0' },
    }),
  );
  const dependency = join(root, 'node_modules/string_decoder');
  mkdirSync(join(dependency, 'vendor'), { recursive: true });
  writeFileSync(
    join(dependency, 'package.json'),
    JSON.stringify({
      name: 'string_decoder',
      version: '1.0.0',
      license: 'MIT',
      exports: './index.js',
    }),
  );
  writeFileSync(join(dependency, 'index.js'), 'module.exports = {};');
  writeFileSync(join(dependency, 'LICENSE'), 'license text');
  writeFileSync(join(dependency, 'vendor/NOTICE.txt'), 'vendored notice');
  const notices = join(root, 'notices');
  const inventory = collectLicenses(root, notices);
  expect(inventory).toHaveLength(1);
  expect(inventory[0].name).toBe('string_decoder');
  expect(filesIn(notices)).toEqual([
    'npm/string_decoder@1.0.0/LICENSE',
    'npm/string_decoder@1.0.0/vendor/NOTICE.txt',
  ]);
  expect(readFileSync(join(notices, 'npm/string_decoder@1.0.0/LICENSE'), 'utf8')).toBe(
    'license text',
  );
});
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it('MCP command safely quotes PowerShell paths with spaces and apostrophes', () => {
  expect(psLiteral("C:/中文 用户/O'Brien/$tools/agy.exe")).toBe(
    "'C:/中文 用户/O''Brien/$tools/agy.exe'",
  );
  expect(mcpRegistrationCommand("C:/O'Brien/agy.exe")).toContain("& 'C:/O''Brien/agy.exe' mcp add");
  expect(mcpRegistrationCommand()).toContain('stdio.js');
});
it.each([
  '../outside',
  '/absolute',
  'C:/outside',
  'a\\b',
  'a/../../b',
  'a/CON.txt',
  'a/name.',
  'a/file:stream',
])('rejects unsafe Windows ZIP path %s', (name) => {
  expect(() => archivePath(tmpdir(), name)).toThrow();
});
it('streams a portable ZIP with Chinese/space paths and verifies restored bytes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'release-test-'));
  roots.push(root);
  const source = join(root, 'source');
  mkdirSync(join(source, '中文 文件'), { recursive: true });
  writeFileSync(join(source, '中文 文件/runtime.wasm'), Buffer.from([0, 255, 8, 42]));
  const zip = join(root, 'release.zip');
  await createZip(source, zip, 'portable');
  await extractZip(zip, join(root, 'unpacked'));
  const restored = join(root, 'unpacked/portable/中文 文件/runtime.wasm');
  expect(readFileSync(restored)).toEqual(Buffer.from([0, 255, 8, 42]));
  expect(await sha256(restored)).toBe(await sha256(join(source, '中文 文件/runtime.wasm')));
  expect(filesIn(source)).toEqual(['中文 文件/runtime.wasm']);
});
