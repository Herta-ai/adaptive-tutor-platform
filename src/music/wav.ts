/** Mono PCM16 WAV, shared by the browser download and reproducible sample preparation. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2),
    v = new DataView(bytes.buffer);
  const str = (at: number, s: string) =>
    [...s].forEach((x, i) => v.setUint8(at + i, x.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, bytes.length - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) =>
    v.setInt16(44 + 2 * i, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true),
  );
  return bytes;
}
