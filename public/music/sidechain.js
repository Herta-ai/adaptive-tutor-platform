// Original teaching DSP: peak detector with attack/release smoothing, separate key input.
class TutorSidechain extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'depth', defaultValue: 0.5, minValue: 0, maxValue: 1 }]; }
  constructor() { super(); this.envelope = 0; }
  process(inputs, outputs, parameters) {
    const main = inputs[0], key = inputs[1], out = outputs[0];
    if (!out.length) return true;
    for (let i = 0; i < out[0].length; i++) {
      let peak = 0;
      for (const ch of key) peak = Math.max(peak, Math.abs(ch[i] || 0));
      const coefficient = Math.exp(-1 / (sampleRate * (peak > this.envelope ? 0.004 : 0.16)));
      this.envelope = peak + coefficient * (this.envelope - peak);
      const depth = parameters.depth.length === 1 ? parameters.depth[0] : parameters.depth[i];
      const gain = Math.pow(10, -Math.min(24, Math.max(0, 20 * Math.log10(this.envelope + 1e-8) + 36)) * depth / 20);
      for (let c = 0; c < out.length; c++) out[c][i] = (main[c % Math.max(1, main.length)]?.[i] || 0) * gain;
    }
    return true;
  }
}
registerProcessor('tutor-sidechain', TutorSidechain);
