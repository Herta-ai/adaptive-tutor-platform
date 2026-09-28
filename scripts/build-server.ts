import { build } from 'esbuild';
import { isBuiltin } from 'node:module';

// Keep entries at the same depth as src/server and src/mcp for import.meta.url assets.
const result = await build({
  entryPoints: ['src/server/main.ts', 'src/mcp/stdio.ts'],
  outbase: 'src',
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'linked',
  metafile: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
for (const output of Object.values(result.metafile.outputs)) {
  for (const imported of output.imports) {
    if (imported.external && !isBuiltin(imported.path))
      throw new Error(`服务端 bundle 仍依赖外部模块：${imported.path}`);
  }
}
console.log('生产服务与 MCP 已打包；运行只依赖 Node 内置模块。');
