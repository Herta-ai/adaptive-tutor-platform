import { describe, it, expect } from 'vitest';
import { NativeStream } from '../src/runtime/antigravity.js';
describe('A02/A13 原生协议', () => {
  it('跨 UTF-8 chunk，DONE 不是终态，最终文本替换预览', () => {
    const delta: string[] = [];
    const stream = new NativeStream((t) => delta.push(t));
    const bytes = Buffer.from(
      '{"event":"init","conversation_id":"c","init":{"permission_mode":"normal"}}\n{"event":"step_update","step_update":{"step_type":"agent_response","step_index":1,"state":"DONE","text_delta":"中文"}}\n{"event":"result","result":{"conversation_id":"c","status":"SUCCESS","response":"最终"}}',
    );
    for (const byte of bytes) stream.push(Buffer.from([byte]));
    stream.end();
    expect(delta.join('')).toBe('中文');
    expect(stream.finish(0).response).toBe('最终');
  });
  it('无 result、非零退出及畸形 stdout 不得成功', () => {
    expect(() => new NativeStream().finish(0)).toThrow();
    const stream = new NativeStream();
    stream.push(Buffer.from('{"event":"result","result":{"status":"SUCCESS","response":"x"}}\n'));
    expect(() => stream.finish(1)).toThrow();
    expect(() => new NativeStream().push(Buffer.from('not json\n'))).toThrow();
  });
  it('非回答步骤不泄漏到聊天，过大记录被拒绝', () => {
    const delta: string[] = [];
    const s = new NativeStream((t) => delta.push(t));
    s.push(
      Buffer.from(
        '{"event":"step_update","step_update":{"step_type":"tool","text_delta":"private"}}\n',
      ),
    );
    expect(delta).toEqual([]);
    expect(() => s.push(Buffer.alloc(1024 * 1024 + 1, 65))).toThrow();
  });
});
