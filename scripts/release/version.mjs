import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// SemVer 2.0: numeric identifiers cannot have leading zeroes; build metadata
// does not make a stable release a prerelease.
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function releaseVersion(input) {
  const version = input.replace(/^v/, '');
  const match = semver.exec(version);
  if (!match || match[0] !== version) throw new Error(`Invalid release version: ${input}`);
  return { version, prerelease: !!match[4] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const release = releaseVersion(process.env.RELEASE_VERSION ?? '');
  appendFileSync(process.env.GITHUB_ENV, `RELEASE_VERSION=${release.version}\n`);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${release.version}\nprerelease=${release.prerelease}\n`,
  );
}
