import type { MusicNote } from './model.js';
/** SMF 1: conductor + one named track per instrument for Live's separate MIDI tracks. */
export function midiFile(notes: MusicNote[], bpm: number): Uint8Array {
  const vlq = (n: number) => {
    const a = [n & 127];
    while ((n >>= 7)) a.unshift((n & 127) | 128);
    return a;
  };
  const tempo = Math.round(60000000 / bpm);
  const tracks = [
    [0, 255, 81, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255, 0, 255, 47, 0],
  ];
  for (const instrument of [...new Set(notes.map((n) => n.instrument))]) {
    const name = [...new TextEncoder().encode(instrument)];
    const bytes = [0, 255, 3, ...vlq(name.length), ...name];
    const ch = ['kick', 'snare', 'hat'].includes(instrument)
      ? 9
      : ({ piano: 0, bass: 1, lead: 2, pad: 3 }[instrument as 'piano'] ?? 0);
    const events = notes
      .filter((n) => n.instrument === instrument)
      .flatMap((n) => [
        { tick: Math.round(n.beat * 480), data: [0x90 | ch, n.pitch, n.velocity] },
        { tick: Math.round((n.beat + n.duration) * 480), data: [0x80 | ch, n.pitch, 0] },
      ])
      .sort((a, b) => a.tick - b.tick || a.data[0] - b.data[0]);
    let previous = 0;
    for (const e of events) {
      bytes.push(...vlq(e.tick - previous), ...e.data);
      previous = e.tick;
    }
    bytes.push(0, 255, 47, 0);
    tracks.push(bytes);
  }
  const result = new Uint8Array(14 + tracks.reduce((n, t) => n + 8 + t.length, 0)),
    view = new DataView(result.buffer);
  result.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, tracks.length, 1, 224]);
  let offset = 14;
  for (const track of tracks) {
    result.set([77, 84, 114, 107], offset);
    view.setUint32(offset + 4, track.length);
    result.set(track, offset + 8);
    offset += track.length + 8;
  }
  return result;
}
export function download(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
