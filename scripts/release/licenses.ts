import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

// Preserve notices from the installed production dependency graph, including vendored
// licenses. This inventory is a conservative superset of tree-shaken bundle contents.
export function collectLicenses(root: string, destination: string) {
  const seen = new Set<string>();
  const inventory: Record<string, unknown>[] = [];
  function visit(packageFile: string) {
    packageFile = realpathSync(packageFile);
    if (seen.has(packageFile)) return;
    seen.add(packageFile);
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
    const directory = dirname(packageFile);
    const require = createRequire(packageFile);
    if (packageFile !== realpathSync(join(root, 'package.json'))) {
      const key = `${pkg.name.replaceAll('/', '__')}@${pkg.version}`;
      const notices: string[] = [];
      function copyNotices(path: string) {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
          if (entry.isSymbolicLink() || entry.name === 'node_modules') continue;
          const source = join(path, entry.name);
          if (entry.isDirectory()) copyNotices(source);
          else if (
            /^(?:licen[sc]e|copying|notice|copyright|readme)(?:[._-]|$)|\.LICENSE\.txt$/i.test(
              entry.name,
            )
          ) {
            const name = `npm/${key}/${relative(directory, source).replaceAll('\\', '/')}`;
            const target = join(destination, name);
            mkdirSync(dirname(target), { recursive: true });
            copyFileSync(source, target);
            notices.push(name);
          }
        }
      }
      copyNotices(directory);
      inventory.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? pkg.licenses ?? null,
        repository: pkg.repository ?? null,
        notices,
      });
    }
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).sort()) {
      // A package can share a Node built-in name (for example string_decoder).
      // Use neutral lookup paths so Node does not return null for that name.
      const dependency = require.resolve
        .paths('__license_package_lookup__')
        ?.map((path) => join(path, name, 'package.json'))
        .find((path) => existsSync(path) && statSync(path).isFile());
      if (dependency) visit(dependency);
      else if (!Object.hasOwn(pkg.optionalDependencies ?? {}, name))
        throw new Error(`缺少生产依赖许可来源：${pkg.name} → ${name}`);
    }
  }
  visit(join(root, 'package.json'));
  return inventory.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
