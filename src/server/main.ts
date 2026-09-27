import { createRequire } from 'node:module';
import type { NextServerOptions } from 'next/dist/server/next.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, dataRoot } from '../storage/database.js';
import { createApplication } from './http.js';
import { publishConnection } from './connection.js';
import { installShutdown } from './shutdown.js';
import { openBrowser } from './installation.js';

if (Number(process.versions.node.split('.')[0]) !== 24)
  throw new Error('本项目要求 Node.js 24 LTS，请先切换项目 Node 版本。');
const dev = process.argv.includes('--dev');
const root = dataRoot();
const store = new Store(root, true);
type Web = {
  prepare: () => Promise<void>;
  close: () => Promise<void>;
  getRequestHandler: () => (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
let web: Web | undefined;
let app: ReturnType<typeof createApplication> | undefined;
let disposeConnection: (() => void) | undefined;
const shutdown = installShutdown({
  closeAsync: async () => {
    try {
      await app?.close();
    } finally {
      await web?.close();
    }
  },
  closeSync: () => {
    try {
      disposeConnection?.();
    } finally {
      store.close();
    }
  },
});
try {
  // The custom launcher owns signal handling, including startup failures.
  process.env.NEXT_MANUAL_SIG_HANDLE = '1';
  const projectRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const next = createRequire(import.meta.url)('next') as (
    options: NextServerOptions & { webpack: boolean },
  ) => Web;
  web = next({ dev, dir: projectRoot, hostname: '127.0.0.1', webpack: true });
  await web.prepare();
  app = createApplication(store, { dev, handlePage: web.getRequestHandler() });
  await app.listen();
  disposeConnection = publishConnection(root, app.origin, app.mcpToken);
  const bootstrapUrl = `${app.origin}/#bootstrap=${app.mintBootstrap()}`;
  console.log(`本地学习工作室：${bootstrapUrl}`);
  console.log('仅供本机使用。在线功能使用你已登录的 agy 额度；首次探针请在设置页手动启动。');
  if (process.platform === 'win32' && process.argv.includes('--open')) openBrowser(bootstrapUrl);
} catch (error) {
  console.error(error);
  await shutdown.stop(1);
}
