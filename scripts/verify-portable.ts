import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { archivePath, extractZip, filesIn, sha256 } from './release/files.js';

const index = process.argv.indexOf('--zip');
if (process.platform !== 'win32' || index < 0 || !process.argv[index + 1])
  throw new Error('用法：pnpm verify:portable --zip <Windows便携ZIP路径>');
const zip = resolve(process.argv[index + 1]);
const expectedHash = readFileSync(zip + '.sha256', 'utf8').split(/\s+/)[0];
if ((await sha256(zip)) !== expectedHash) throw new Error('ZIP SHA-256 不匹配');
const work = mkdtempSync(join(tmpdir(), 'tutor-portable-'));
const unpacked = join(work, '中文 安装目录');
await extractZip(zip, unpacked);
const bundle = join(unpacked, basename(zip, '.zip'));
const manifest = JSON.parse(readFileSync(join(bundle, 'release-manifest.json'), 'utf8'));
for (const [name, info] of Object.entries<any>(manifest.files)) {
  const path = archivePath(bundle, name);
  if (statSync(path).size !== info.size || (await sha256(path)) !== info.sha256)
    throw new Error(`文件校验失败：${name}`);
}
const files = filesIn(bundle);
if (files.length !== Object.keys(manifest.files).length + 1)
  throw new Error('存在未登记的发行文件');
if (files.some((name) => /^app\/\.next\/(cache|dev)\//.test(name)))
  throw new Error('包内存在开发缓存');
if (files.some((name) => name.split('/').includes('node_modules') || name.startsWith('app/.next/')))
  throw new Error('便携包不得包含 node_modules 或 Next 服务端产物');
for (const name of ['app/out/index.html', 'app/dist/server/main.js', 'app/dist/mcp/stdio.js'])
  if (!files.includes(name)) throw new Error(`缺少独立构建产物：${name}`);
const home = join(work, '隔离 用户');
mkdirSync(home);
const dataRoot = join(home, '.herta-ai/adaptive-tutor-platform');
const system = join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
const env = {
  ...process.env,
  USERPROFILE: home,
  HOME: home,
  PATH: system,
  NODE_PATH: '',
  NODE_OPTIONS: '',
  ADAPTIVE_TUTOR_AGY_PATH: '',
  NEXT_TELEMETRY_DISABLED: '1',
};
const node = join(bundle, 'runtime/node.exe');
const launch = join(bundle, 'launch.mjs');
// Only the test process injects synthetic SIGINT; the distributed launcher is unchanged.
const hook = join(work, 'signal.mjs');
writeFileSync(
  hook,
  "process.on('message', m => { if (m === 'test-stop') process.emit('SIGINT'); });\n",
);
const children: ChildProcess[] = [];
function start(withSignalHook = false) {
  const child = spawn(
    node,
    [...(withSignalHook ? ['--import', pathToFileURL(hook).href] : []), launch, '--no-open'],
    {
      cwd: home,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  children.push(child);
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  const ready = new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('便携服务启动超时：' + output)), 60000);
    const data = (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/#bootstrap=[a-f0-9]+/);
      output = (output + text.replace(/bootstrap=[a-f0-9]+/g, 'bootstrap=[redacted]')).slice(-4000);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    child.stdout!.on('data', data);
    child.stderr!.on('data', data);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`便携服务退出 ${code}: ${output}`));
    });
  });
  return { child, ready, exited };
}
async function waitExit(promise: Promise<number | null>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('测试进程未退出')), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

const report: Record<string, unknown> = {
  version: manifest.version,
  zipSha256: expectedHash,
  startedAt: new Date().toISOString(),
  checks: [],
  size: {
    zipBytes: statSync(zip).size,
    unpackedBytes: files.reduce((sum, name) => sum + statSync(join(bundle, name)).size, 0),
    fileCount: files.length,
  },
  manualPending: [
    '干净 Windows 11 用户环境',
    '双击 start.cmd、手按 Ctrl+C 与浏览器自动打开',
    '真实 agy 登录/MCP 注册/额度联调',
  ],
};
const checks = report.checks as string[];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  checks.push('ZIP hash、全部文件 hash、无符号链接、node_modules 与 Next 服务端产物');
  const first = start();
  const url = await first.ready;
  if (!existsSync(join(dataRoot, 'runtime/writer.lock'))) throw new Error('测试未使用隔离用户目录');
  checks.push('中文空格路径、不同 cwd、包内 Node、PATH 无 Node/pnpm/agy');
  const mcp = new Client({ name: 'portable-verifier', version: '1.0.0' });
  try {
    await mcp.connect(
      new StdioClientTransport({
        command: node,
        args: [join(bundle, 'app/dist/mcp/stdio.js')],
        cwd: home,
        env: Object.fromEntries(
          Object.entries(env).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
        stderr: 'pipe',
      }),
    );
    const { tools } = await mcp.listTools();
    if (!tools.length) throw new Error('独立 MCP bundle 未返回工具');
    checks.push('无 node_modules 的 MCP stdio 握手与工具列表');
  } finally {
    await mcp.close();
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext();
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    const target = new URL(route.request().url());
    if (target.hostname === '127.0.0.1') return route.continue();
    blocked.push(target.origin);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.getByRole('button', { name: '打开几何示例 →' })).toBeVisible();
  await page.getByRole('button', { name: '环境设置', exact: true }).click();
  await expect(page.getByText(/not_installed/)).toBeVisible();
  const command = page.locator('code');
  await expect(command).toContainText(join(bundle, 'runtime/node.exe'));
  await expect(command).toContainText(join(bundle, 'app/dist/mcp/stdio.js'));
  checks.push('离线启动与当前安装目录 MCP 注册命令');
  await page.getByRole('button', { name: '实验室', exact: true }).click();
  const output = page.getByLabel('实验输出');
  for (const [language, answer] of [
    ['JavaScript', '[1,2,3,4,5]'],
    ['SQL', 'mean'],
    ['Python', '[1, 2, 3, 4, 5]'],
  ]) {
    await page.getByRole('button', { name: language, exact: true }).click();
    await page.getByRole('button', { name: '运行代码', exact: true }).click();
    await expect(output).toContainText(answer, { timeout: 40000 });
  }
  await page
    .getByLabel('实验源码')
    .fill('import numpy as np\nprint("NUMPY_OK", np.array([1, 2, 3]).sum())');
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(output).toContainText('NUMPY_OK 6', { timeout: 40000 });
  if (blocked.length) throw new Error('便携页面尝试外部联网：' + [...new Set(blocked)].join(','));
  checks.push('阻断非回环浏览器网络下 JS/SQL/Python/NumPy 实际计算');
  await context.close();
  await browser.close();
  browser = undefined;
  first.child.kill('SIGKILL');
  await waitExit(first.exited);
  if (!existsSync(join(dataRoot, 'runtime/writer.lock'))) throw new Error('未构造强杀遗留锁场景');
  const second = start(true);
  await second.ready;
  checks.push('真实进程强杀后重新启动并恢复单写锁');
  second.child.send('test-stop');
  if ((await waitExit(second.exited)) !== 0) throw new Error('正常退出返回非零');
  if (
    existsSync(join(dataRoot, 'runtime/writer.lock')) ||
    existsSync(join(dataRoot, 'runtime/connection.json'))
  )
    throw new Error('正常退出未清理运行时凭证/锁');
  checks.push('合成 SIGINT 正常退出与锁/connection 清理');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await browser?.close();
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  report.finishedAt = new Date().toISOString();
  writeFileSync(zip + '.verification.json', JSON.stringify(report, null, 2) + '\n');
  // Keep isolated extraction for diagnosis; never touch the actual user's data directory.
  console.log(`便携验收：${report.status}；报告 ${zip}.verification.json`);
}
