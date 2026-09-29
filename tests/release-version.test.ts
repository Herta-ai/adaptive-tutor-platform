import { expect, it } from 'vitest';
import { releaseVersion } from '../scripts/release/version.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it.each([
  ['0.1.1', '0.1.1', false],
  ['v0.1.1', '0.1.1', false],
  ['0.1.2-alpha.1', '0.1.2-alpha.1', true],
  ['v1.0.0-rc-test.0+build.123', '1.0.0-rc-test.0+build.123', true],
  ['1.0.0+build-with-hyphens', '1.0.0+build-with-hyphens', false],
])('normalizes %s and classifies the release channel', (input, version, prerelease) => {
  expect(releaseVersion(input)).toEqual({ version, prerelease });
});

it.each([
  '',
  '1.2',
  '01.2.3',
  '1.02.3',
  '1.2.03',
  '1.2.3-01',
  '1.2.3-rc.01',
  '1.2.3-',
  '1.2.3+',
  '1.2.3-rc..1',
  '1.2.3/path',
  '1.2.3\n',
  ' 1.2.3',
  'vv1.2.3',
])('rejects invalid release version %j', (input) => {
  expect(() => releaseVersion(input)).toThrow('Invalid release version');
});

it('exports the normalized version and channel for subsequent Actions steps and jobs', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-version-'));
  try {
    const envFile = join(root, 'env');
    const outputFile = join(root, 'output');
    const result = spawnSync(process.execPath, [resolve('scripts/release/version.mjs')], {
      env: {
        ...process.env,
        RELEASE_VERSION: 'v0.1.1',
        GITHUB_ENV: envFile,
        GITHUB_OUTPUT: outputFile,
      },
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(envFile, 'utf8')).toBe('RELEASE_VERSION=0.1.1\n');
    expect(readFileSync(outputFile, 'utf8')).toBe('version=0.1.1\nprerelease=false\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
