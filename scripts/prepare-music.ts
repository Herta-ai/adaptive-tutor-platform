import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { encodeWav } from '../src/music/wav.js';
const revision = 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e';
const output = join(process.cwd(), 'public/music');
mkdirSync(output, { recursive: true });
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const old = existsSync(join(output, 'manifest.json'))
  ? JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'))
  : null;
const paths: [string, string, number][] = [
  ...[2, 3, 4, 5].map(
    (o) =>
      [
        `piano-${o}`,
        `Chordophones/Zithers/Grand Piano, Kawai/Sustains/GPiano_sus_C${o}_v3_rr1_Player.wav`,
        (o + 2) * 12,
      ] as [string, string, number],
  ),
  ['kick', 'Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v5_rr1_Sum.wav', 36],
  [
    'snare',
    'Membranophones/Struck Membranophones/Snare Drum, Modern 1/Snare2_HitSN_v3_rr1_Mid.wav',
    38,
  ],
  ['hat', 'Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v3_rr1_Mid.wav', 42],
];
const samples = [];
async function get(url: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (error) {
      if (attempt >= 3) throw error;
      console.log(`网络重试 ${attempt + 1}`);
    }
  }
}
for (const [id, path, guessedRoot] of paths) {
  const source = `https://raw.githubusercontent.com/sgossner/VCSL/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const mirror = `https://cdn.jsdelivr.net/gh/sgossner/VCSL@${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const raw = await get(mirror),
    sourceSha256 = sha(raw);
  const previous = old?.samples.find((x: any) => x.id === id);
  if (previous && previous.sourceSha256 !== sourceSha256) throw Error(`源采样校验失败: ${id}`);
  let channels = 0,
    rate = 0,
    bits = 0,
    data = Buffer.alloc(0);
  for (let offset = 12; offset + 8 <= raw.length; ) {
    const name = raw.toString('ascii', offset, offset + 4),
      size = raw.readUInt32LE(offset + 4),
      at = offset + 8;
    if (name === 'fmt ') {
      const format = raw.readUInt16LE(at);
      if (![1, 65534].includes(format)) throw Error('只接受 PCM 采样');
      channels = raw.readUInt16LE(at + 2);
      rate = raw.readUInt32LE(at + 4);
      bits = raw.readUInt16LE(at + 14);
    }
    if (name === 'data') data = raw.subarray(at, at + size);
    offset = at + size + (size % 2);
  }
  if (![16, 24].includes(bits) || !rate || !channels) throw Error('不支持的 WAV');
  const frameSize = (channels * bits) / 8,
    length = Math.min(Math.floor(data.length / frameSize), rate * (id.startsWith('piano') ? 4 : 2));
  const pcm = new Float32Array(length);
  for (let i = 0; i < length; i++)
    for (let ch = 0; ch < channels; ch++) {
      const at = i * frameSize + (ch * bits) / 8;
      pcm[i] +=
        (bits === 16 ? data.readInt16LE(at) / 32768 : data.readIntLE(at, 3) / 8388608) / channels;
    }
  // Confirm the octave from the recording rather than assuming filename conventions.
  let root = guessedRoot;
  if (id.startsWith('piano')) {
    const start = Math.floor(rate * 0.15),
      count = Math.min(4096, pcm.length - start - 2000);
    let best = -1,
      bestLag = 0;
    const hz = 440 * 2 ** ((guessedRoot - 69) / 12);
    for (let lag = Math.floor(rate / (hz * 1.02)); lag <= Math.ceil(rate / (hz * 0.98)); lag++) {
      let xy = 0,
        xx = 0,
        yy = 0;
      for (let i = 0; i < count; i++) {
        const a = pcm[start + i],
          b = pcm[start + i + lag];
        xy += a * b;
        xx += a * a;
        yy += b * b;
      }
      const corr = xy / Math.sqrt(xx * yy);
      if (corr > best) {
        best = corr;
        bestLag = lag;
      }
    }
    const detected = Math.round(69 + 12 * Math.log2(rate / bestLag / 440));
    if (detected % 12 !== 0 || best < 0.7)
      throw Error(`钢琴基频检查失败 ${id}: ${detected}, ${best}`);
    root = detected;
  }
  const peak = pcm.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  for (let i = 0; i < length; i++)
    pcm[i] *=
      (0.85 / Math.max(peak, 0.001)) *
      Math.min(1, i / (rate * 0.003), (length - 1 - i) / (rate * 0.05));
  const wav = encodeWav(pcm, rate),
    file = `${id}.wav`;
  writeFileSync(join(output, file), wav);
  samples.push({
    id,
    file,
    root,
    source,
    sourceSha256,
    sha256: sha(wav),
    bytes: wav.length,
    sampleRate: rate,
  });
  console.log(`${id}: MIDI ${root}, ${wav.length} bytes`);
}
const license = (
  await get(`https://raw.githubusercontent.com/sgossner/VCSL/${revision}/LICENSE`)
).toString('utf8');
if (!license.includes('CC0')) throw Error('未找到 CC0 许可');
writeFileSync(join(output, 'LICENSE.txt'), license);
writeFileSync(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      version: 'vcsl-1',
      revision,
      license: 'CC0-1.0',
      attribution: 'Versilian Studios — Versilian Community Sample Library',
      processing:
        'Mono PCM16, peak normalization, 4s piano / 2s drums, edge fades; source sample rate retained.',
      samples,
    },
    null,
    2,
  ) + '\n',
);
