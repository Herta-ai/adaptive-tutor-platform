import type { Capability } from '../capabilities/registry.js';
import { musicConfig, musicSummary, buildUpAutomation } from './model.js';
import { z } from 'zod';

const defaults = musicConfig.parse({});
const schema = z.toJSONSchema(musicConfig);
const numericParameters = Object.fromEntries(
  Object.entries(schema.properties ?? {}).flatMap(([key, value]) => {
    const spec = value as { type?: string; minimum?: number; maximum?: number };
    return ['number', 'integer'].includes(spec.type ?? '') &&
      spec.minimum !== undefined &&
      spec.maximum !== undefined
      ? [
          [
            key,
            {
              min: spec.minimum,
              max: spec.maximum,
              value: defaults[key as keyof typeof defaults] as number,
              step: spec.type === 'integer' ? 1 : 0.01,
            },
          ],
        ]
      : [];
  }),
);

export const musicTitles = {
  keyboard: '音阶与键盘',
  harmony: '和弦与旋律',
  rhythm: '鼓与律动',
  synth: '声音设计',
  arrangement: '编曲与段落',
  mixing: '混音与侧链',
};
export const musicCapabilities: Capability[] = Object.entries(musicTitles).map(([key, title]) => ({
  id: `music.${key}`,
  version: 1,
  type: 'music_lab',
  subject: 'S23',
  title,
  mode: 'computed',
  parameters: numericParameters,
  description: '用音频时钟联动谱面与声音，调整参数、拆轨试听，再在 Ableton Live 12 中复现。',
  reference: '十二平均律，A4=440 Hz。谱面和声音共用事件序列；音色为采样及教学合成器。',
  compute: (p, step) => ({ values: musicSummary(musicConfig.parse(p), step) }),
}));
export function defaultMusicConfig(id: string) {
  return musicConfig.parse({
    preset: id === 'music.keyboard' ? 'scale' : id === 'music.harmony' ? 'chords' : 'bigroom',
    arrangement: id === 'music.arrangement',
    filterAutomation: id === 'music.arrangement' ? buildUpAutomation() : [],
    solo: id === 'music.rhythm' ? 'kick' : null,
  });
}
