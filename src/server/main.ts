import { createRequire } from 'node:module';
import type { NextServerOptions } from 'next/dist/server/next.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Store, dataRoot } from '../storage/database.js';
import { createApplication } from './http.js';
import { publishConnection } from './connection.js';

if (Number(process.versions.node.split('.')[0]) !== 24)
  throw new Error('本项目要求 Node.js 24 LTS，请先切换项目 Node 版本。');
const dev = process.argv.includes('--dev');
const root = dataRoot();
const store = new Store(root, true);
// Both src/server and dist/server resolve to this install's root, independent of launch cwd.
const projectRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const next = createRequire(import.meta.url)('next') as (
  options: NextServerOptions & { webpack: boolean },
) => {
  prepare: () => Promise<void>;
  close: () => Promise<void>;
  getRequestHandler: () => (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
const web = next({ dev, dir: projectRoot, hostname: '127.0.0.1', webpack: true });
try {
  await web.prepare();
} catch (e) {
  await web.close();
  store.close();
  throw e;
}
const app = createApplication(store, { dev, handlePage: web.getRequestHandler() });
let disposeConnection: () => void;
try {
  await app.listen();
  disposeConnection = publishConnection(root, app.origin, app.mcpToken);
} catch (e) {
  await app.close();
  await web.close();
  store.close();
  throw e;
}
const origin = app.origin;
console.log(`本地学习工作室：${origin}/#bootstrap=${app.mintBootstrap()}`);
console.log('仅供本机使用。在线功能使用你已登录的 agy 额度；首次探针请在设置页手动启动。');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  await web.close();
  disposeConnection();
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
