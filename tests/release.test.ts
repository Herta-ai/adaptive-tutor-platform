import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archivePath, createZip, extractZip, filesIn, sha256 } from '../scripts/release/files.js';
import { mcpRegistrationCommand, psLiteral } from '../src/server/installation.js';
const roots: string[] = [];
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
