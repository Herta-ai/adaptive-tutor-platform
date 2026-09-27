import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { archivePath, filesIn, sha256, createZip, extractZip } from './release/files.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const node = JSON.parse(readFileSync(join(root, 'packaging/node-runtime.json'), 'utf8'));
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const version = option('--version') ?? `${pkg.version}-alpha.1`;
if (!/^\d+\.\d+\.\d+-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*$/.test(version))
  throw new Error('当前仅发布开发预览，请使用类似 0.1.0-alpha.1 的版本');
if (
  process.platform !== 'win32' ||
  process.arch !== 'x64' ||
  process.versions.node !== node.version
)
  throw new Error(`请在 Windows x64 的 Node ${node.version} 下打包`);
const pnpm = process.env.npm_execpath ?? option('--pnpm');
if (!pnpm || !existsSync(pnpm))
  throw new Error('请使用 pnpm package:win，或提供 --pnpm <pnpm CLI绝对路径>');
function run(args: string[], cwd = root) {
  const env: Record<string, string | undefined> = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  delete env.NODE_ENV;
  const result = spawnSync(process.execPath, [pnpm!, ...args], {
    cwd,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
    // Next's ambient types incorrectly require NODE_ENV even when it is intentionally unset.
    env: env as NodeJS.ProcessEnv,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} 失败`);
}
const check = spawnSync(process.execPath, [pnpm, '--version'], {
  encoding: 'utf8',
  windowsHide: true,
});
if (check.status !== 0 || check.stdout.trim() !== pkg.packageManager.split('@').at(-1))
  throw new Error('pnpm 版本与 packageManager 不一致');
if (!process.argv.includes('--skip-build')) {
  run(['run', 'build']);
  run(['run', 'runtimes:prepare']);
}
for (const file of [
  'dist/server/main.js',
  'dist/mcp/stdio.js',
  '.next/BUILD_ID',
  '.runtime-build/manifest.json',
])
  if (!existsSync(join(root, file))) throw new Error(`缺少构建产物 ${file}`);
const runtimeManifest = JSON.parse(
  readFileSync(join(root, '.runtime-build/manifest.json'), 'utf8'),
);
if (!Object.keys(runtimeManifest).some((name) => /^numpy-.*\.whl$/.test(name)))
  throw new Error('便携包必须包含 NumPy；运行 pnpm runtimes:prepare');

const output = join(root, 'releases');
mkdirSync(output, { recursive: true });
const name = `adaptive-tutor-platform-v${version}-win-x64`;
const zipPath = join(output, name + '.zip');
if (existsSync(zipPath)) throw new Error(`发行包已存在，请使用新版本或先移走旧包：${zipPath}`);
const workspace = join(root, '.release-work');
mkdirSync(workspace, { recursive: true });
const work = mkdtempSync(join(workspace, 'package-'));
const bundle = join(work, name),
  app = join(bundle, 'app');
mkdirSync(app, { recursive: true });

// A fresh lockfile-driven hoisted install gives regular directories, not pnpm junctions.
// Never prune the developer checkout, and never execute dependency install scripts.
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
  copyFileSync(join(root, file), join(app, file));
run(
  ['--config.node-linker=hoisted', 'install', '--prod', '--frozen-lockfile', '--ignore-scripts'],
  app,
);
const forbidden = /^(?:node-gyp|node-pre-gyp|@mapbox\/node-pre-gyp|better-sqlite3)$/;
const dependencies = filesIn(join(app, 'node_modules'));
const inventory: any[] = [];
for (const file of dependencies.filter((name) => name.endsWith('/package.json'))) {
  const path = join(app, 'node_modules', file);
  let p: any;
  try {
    p = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    continue;
  }
  if (!p.name) continue;
  if (
    forbidden.test(p.name) ||
    p.gypfile === true ||
    /node-gyp/.test(JSON.stringify(p.scripts ?? {}))
  )
    throw new Error(`生产依赖不得要求 node-gyp：${p.name}`);
  inventory.push({
    name: p.name,
    version: p.version ?? null,
    license: p.license ?? p.licenses ?? null,
    repository: p.repository ?? null,
    packageFile: `app/node_modules/${file}`,
  });
}

cpSync(join(root, 'dist'), join(app, 'dist'), { recursive: true });
cpSync(join(root, '.next'), join(app, '.next'), {
  recursive: true,
  filter: (path) =>
    !['cache', 'dev', 'diagnostics', 'types', 'trace', 'trace-build'].some(
      (name) => path === join(root, '.next', name),
    ),
});
mkdirSync(join(app, '.runtime-build'));
for (const [name, info] of Object.entries<any>(runtimeManifest)) {
  const source = archivePath(join(root, '.runtime-build'), name);
  const destination = archivePath(join(app, '.runtime-build'), name);
  if (statSync(source).size !== info.size || (await sha256(source)) !== info.sha256)
    throw new Error(`运行库内容与清单不符：${name}`);
  copyFileSync(source, destination);
}
copyFileSync(join(root, '.runtime-build/manifest.json'), join(app, '.runtime-build/manifest.json'));
if (existsSync(join(root, 'public')))
  cpSync(join(root, 'public'), join(app, 'public'), { recursive: true });
// Keep production config aligned with the source config, removing only TypeScript syntax.
const config = readFileSync(join(root, 'next.config.ts'), 'utf8')
  .replace(/^import type .*;\r?\n/m, '')
  .replace('const config: NextConfig', 'const config')
  .replace(
    'export default config;',
    'config.outputFileTracingRoot = import.meta.dirname;\nexport default config;',
  );
writeFileSync(join(app, 'next.config.mjs'), config);
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version,
      private: true,
      type: 'module',
      license: 'MIT',
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ) + '\n',
);
cpSync(join(root, 'packaging/portable'), bundle, { recursive: true });
// cmd.exe reads these ASCII commands independent of the machine's code page.
writeFileSync(
  join(bundle, 'start.cmd'),
  readFileSync(join(bundle, 'start.cmd'), 'utf8').replace(/\r?\n/g, '\r\n'),
);
copyFileSync(join(root, 'LICENSE'), join(bundle, 'LICENSE'));

const cache = join(workspace, 'downloads');
mkdirSync(cache, { recursive: true });
const nodeZip = join(cache, `node-v${node.version}-win-x64.zip`);
if (!existsSync(nodeZip)) {
  console.log(`下载官方 Node ${node.version}（固定 SHA-256）`);
  const response = await fetch(node.url, {
    signal: AbortSignal.timeout(180000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Node 下载失败 ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > 100 * 1024 ** 2 ||
    createHash('sha256').update(bytes).digest('hex') !== node.sha256
  )
    throw new Error('Node 下载校验失败');
  writeFileSync(nodeZip, bytes);
}
if ((await sha256(nodeZip)) !== node.sha256) throw new Error('缓存的 Node ZIP 校验失败');
const nodeStage = join(work, 'node');
await extractZip(nodeZip, nodeStage, (name) => /\/node\.exe$|\/LICENSE$/.test(name));
mkdirSync(join(bundle, 'runtime'));
for (const file of ['node.exe', 'LICENSE'])
  copyFileSync(
    join(nodeStage, `node-v${node.version}-win-x64`, file),
    join(bundle, 'runtime', file),
  );

const notices = join(bundle, 'THIRD-PARTY-NOTICES');
cpSync(join(root, 'packaging/licenses'), notices, { recursive: true });
const sources = JSON.parse(readFileSync(join(notices, 'sources.json'), 'utf8'));
for (const source of sources) {
  const licensePath = join(notices, source.file);
  const text = readFileSync(licensePath, 'utf8');
  if (text.includes('\r\n')) {
    writeFileSync(licensePath, text.replace(/\r\n/g, '\n'), 'utf8');
  }
  if ((await sha256(licensePath)) !== source.sha256)
    throw new Error(`许可文件 hash 不匹配：${source.file}`);
}
// The wheel includes NumPy and bundled native-library license notices.
const numpy = Object.keys(runtimeManifest).find((name) => /^numpy-.*\.whl$/.test(name))!;
await extractZip(join(app, '.runtime-build', numpy), join(notices, 'numpy'), (name) =>
  /licen[sc]e|copying|notice/i.test(name),
);
writeFileSync(
  join(notices, 'dependencies.json'),
  JSON.stringify(
    inventory.sort((a, b) => a.name.localeCompare(b.name)),
    null,
    2,
  ) + '\n',
);
copyFileSync(
  join(root, 'packaging/THIRD-PARTY-NOTICES.md'),
  join(bundle, 'THIRD-PARTY-NOTICES.md'),
);

const git = (args: string[]) =>
  spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).stdout?.trim() ?? '';
const manifest: any = {
  schemaVersion: 1,
  name: pkg.name,
  version,
  preview: true,
  platform: 'win32',
  arch: 'x64',
  node: node.version,
  pnpm: pkg.packageManager,
  sourceCommit: git(['rev-parse', 'HEAD']),
  sourceDirty: !!git(['status', '--porcelain']),
  builtAt: new Date().toISOString(),
  files: {},
};
for (const file of filesIn(bundle))
  manifest.files[file] = {
    size: statSync(join(bundle, file)).size,
    sha256: await sha256(join(bundle, file)),
  };
writeFileSync(join(bundle, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`压缩 ${Object.keys(manifest.files).length} 个普通文件；不包含开发缓存或用户数据`);
await createZip(bundle, zipPath, name);
writeFileSync(zipPath + '.sha256', `${await sha256(zipPath)}  ${name}.zip\n`);
copyFileSync(join(bundle, 'release-manifest.json'), join(output, name + '.manifest.json'));
console.log(
  `便携包已生成：${zipPath}\n请运行 pnpm verify:portable --zip "${zipPath}" 验证最终产物。`,
);
