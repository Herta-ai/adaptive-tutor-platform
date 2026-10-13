import type { MusicNote } from './model.js';
/** Quantize the display to sixteenths. Swing belongs to playback, not invented notation. */
export function notationVoice(notes: MusicNote[], bar: number) {
  const cells = Array.from({ length: 16 }, (_, i) => {
    const tick = bar * 16 + i;
    return notes
      .filter((n) => Math.round(n.beat * 4) <= tick && Math.round((n.beat + n.duration) * 4) > tick)
      .map((n) => n.pitch)
      .sort((a, b) => a - b);
  });
  const result: { pitches: number[]; ticks: number; tie: boolean }[] = [];
  for (let i = 0; i < 16; ) {
    let end = i + 1;
    // A repeated attack must create a new note even when pitch is unchanged.
    while (
      end < 16 &&
      JSON.stringify(cells[end]) === JSON.stringify(cells[i]) &&
      !notes.some((n) => Math.round(n.beat * 4) === bar * 16 + end)
    )
      end++;
    let remaining = end - i,
      continuation = false;
    while (remaining) {
      const ticks = [16, 8, 4, 2, 1].find((n) => n <= remaining)!;
      result.push({
        pitches: [...new Set(cells[i])],
        ticks,
        tie: continuation && cells[i].length > 0,
      });
      remaining -= ticks;
      continuation = true;
    }
    i = end;
  }
  return result;
}
