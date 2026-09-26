import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataRoot } from '../storage/database.js';
import { toolSchemas } from './gateway.js';
const server = new McpServer({ name: 'adaptive-tutor', version: '0.1.0' });
for (const [name, schema] of Object.entries(toolSchemas))
  server.registerTool(
    name,
    {
      description: '受应用任务 scope 限定的课程工具；不允许任意文件访问或直接修改掌握状态。',
      inputSchema: schema,
    },
    async (args: unknown) => {
      try {
        const connection = JSON.parse(
          readFileSync(join(dataRoot(), 'runtime', 'connection.json'), 'utf8'),
        );
        const url = new URL(connection.origin);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/')
          throw new Error('APP_NOT_RUNNING');
        const response = await fetch(new URL('/internal/mcp', url), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${connection.mcpToken}`,
          },
          body: JSON.stringify({ name, args }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await response.json();
        return {
          isError: !response.ok,
          content: [{ type: 'text' as const, text: JSON.stringify(data) }],
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: { code: 'APP_NOT_RUNNING', message: '请先启动本地学习应用' },
              }),
            },
          ],
        };
      }
    },
  );
await server.connect(new StdioServerTransport());
