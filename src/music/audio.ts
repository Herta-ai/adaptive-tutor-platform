import {
  instruments,
  midiFrequency,
  musicLength,
  sequence,
  automatedCutoff,
  type MusicConfig,
  type MusicNote,
} from './model.js';
import { encodeWav } from './wav.js';

type Sample = { id: string; file: string; root: number; sha256: string };
type Voice = { end: (at?: number, immediate?: boolean) => void };
let active: MusicAudio | undefined;
function scheduleFilter(filter: BiquadFilterNode, c: MusicConfig, beat: number, at: number) {
  filter.frequency.cancelScheduledValues(at);
  filter.frequency.setValueAtTime(automatedCutoff(c, beat), at);
  for (const point of c.filterAutomation.filter((p) => p.beat > beat))
    filter.frequency.linearRampToValueAtTime(point.value, at + ((point.beat - beat) * 60) / c.bpm);
}
export class MusicAudio {
  context: AudioContext;
  analyser: AnalyserNode;
  dryAnalyser: AnalyserNode;
  compressor: DynamicsCompressorNode;
  private input: GainNode;
  private melodic: GainNode;
  private kick: GainNode;
  private sidechain?: AudioWorkletNode;
  private eq: BiquadFilterNode;
  private pan: StereoPannerNode;
  private master: GainNode;
  private match: GainNode;
  private delay: DelayNode;
  private feedback: GainNode;
  private delayWet: GainNode;
  private reverbWet: GainNode;
  private convolver: ConvolverNode;
  private buffers = new Map<string, AudioBuffer>();
  private manifest: Sample[] = [];
  private voices = new Set<Voice>();
  private tracks = new Map<string, { gain: GainNode; pan: StereoPannerNode }>();
  private filters = new Set<{
    filter: BiquadFilterNode;
    lfo: OscillatorNode;
    depth: GainNode;
    monitor: AnalyserNode;
  }>();
  private timer?: ReturnType<typeof setInterval>;
  private epoch = 0;
  private startBeat = 0;
  private readyPromise?: Promise<void>;
  private ended = false;
  config: MusicConfig;
  playing = false;
  onStop?: () => void;

  constructor(config: MusicConfig) {
    this.config = config;
    this.context = new AudioContext({ latencyHint: 'interactive' });
    const ctx = this.context;
    this.input = ctx.createGain();
    this.melodic = ctx.createGain();
    this.kick = ctx.createGain();
    this.eq = ctx.createBiquadFilter();
    this.eq.type = 'peaking';
    this.eq.Q.value = 0.8;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.knee.value = 0;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.15;
    this.pan = ctx.createStereoPanner();
    this.master = ctx.createGain();
    this.match = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.dryAnalyser = ctx.createAnalyser();
    this.dryAnalyser.fftSize = 2048;
    this.delay = ctx.createDelay(3);
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.3;
    this.delayWet = ctx.createGain();
    this.reverbWet = ctx.createGain();
    this.convolver = ctx.createConvolver();
    const impulse = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    // Fixed PRNG: the same room response in every lesson.
    let seed = 20261013;
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        data[i] = (seed / 2147483648 - 1) * Math.exp((-i / ctx.sampleRate) * 4);
      }
    }
    this.convolver.buffer = impulse;
    this.kick.connect(this.input);
    for (const instrument of instruments) {
      const gain = ctx.createGain(),
        pan = ctx.createStereoPanner();
      gain.connect(pan);
      pan.connect(this.dryAnalyser);
      pan.connect(
        instrument === 'kick'
          ? this.kick
          : ['snare', 'hat'].includes(instrument)
            ? this.input
            : this.melodic,
      );
      this.tracks.set(instrument, { gain, pan });
    }
    this.input.connect(this.eq);
    this.eq.connect(this.compressor);
    this.compressor.connect(this.pan);
    this.pan.connect(this.match);
    this.pan.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.delayWet);
    this.delayWet.connect(this.match);
    this.pan.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbWet.connect(this.match);
    this.match.connect(this.analyser);
    this.analyser.connect(this.master);
    this.master.connect(ctx.destination);
    this.apply(config);
  }
  async prepare() {
    await this.context.resume();
    if (!this.readyPromise) this.readyPromise = this.load();
    await this.readyPromise;
    if (this.ended) throw Error('音乐组件已关闭');
  }
  private async load() {
    await this.context.audioWorklet.addModule('/music/sidechain.js');
    this.sidechain = new AudioWorkletNode(this.context, 'tutor-sidechain', {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.melodic.connect(this.sidechain, 0, 0);
    this.kick.connect(this.sidechain, 0, 1);
    this.sidechain.connect(this.input);
    const response = await fetch('/music/manifest.json');
    if (!response.ok) throw Error('采样清单缺失，请重新安装完整便携包');
    const manifest = await response.json();
    if (manifest.version !== 'vcsl-1') throw Error('采样版本不匹配');
    this.manifest = manifest.samples;
    this.apply(this.config);
    await this.ensureSamples(sequence(this.config).map((n) => n.instrument));
  }
  async ensureSamples(instruments: string[]) {
    const required = this.manifest.filter((s) =>
      instruments.some((i) => (i === 'piano' ? s.id.startsWith('piano-') : s.id === i)),
    );
    await Promise.all(
      required.map(async (sample) => {
        if (this.buffers.has(sample.id)) return;
        const r = await fetch(`/music/${sample.file}`);
        if (!r.ok) throw Error(`采样不可用：${sample.id}`);
        const data = await r.arrayBuffer(),
          digest = await crypto.subtle.digest('SHA-256', data);
        const hash = [...new Uint8Array(digest)]
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('');
        if (hash !== sample.sha256) throw Error(`采样校验失败：${sample.id}`);
        this.buffers.set(sample.id, await this.context.decodeAudioData(data));
      }),
    );
  }
  activate() {
    if (active !== this) {
      active?.stop();
      active = this;
    }
    this.master.gain.setTargetAtTime(
      10 ** (this.config.gainDb / 20),
      this.context.currentTime,
      0.005,
    );
  }
  apply(c: MusicConfig) {
    this.config = c;
    const t = this.context.currentTime;
    this.eq.frequency.setTargetAtTime(c.eqFrequency, t, 0.02);
    this.eq.gain.setTargetAtTime(c.bypass ? 0 : c.eqGain, t, 0.02);
    this.compressor.threshold.setTargetAtTime(c.threshold, t, 0.02);
    this.compressor.ratio.setTargetAtTime(c.bypass ? 1 : c.ratio, t, 0.02);
    this.sidechain?.parameters.get('depth')?.setTargetAtTime(c.bypass ? 0 : c.sidechain, t, 0.02);
    this.pan.pan.setTargetAtTime(c.pan, t, 0.02);
    this.master.gain.setTargetAtTime(10 ** (c.gainDb / 20), t, 0.02);
    this.delay.delayTime.setTargetAtTime((60 / c.bpm) * 0.75, t, 0.02);
    this.delayWet.gain.setTargetAtTime(c.bypass ? 0 : c.delay, t, 0.02);
    this.reverbWet.gain.setTargetAtTime(c.bypass ? 0 : c.reverb, t, 0.02);
    for (const [instrument, nodes] of this.tracks) {
      nodes.gain.gain.setTargetAtTime(
        10 ** (c.trackGains[instrument as MusicNote['instrument']] / 20),
        t,
        0.02,
      );
      nodes.pan.pan.setTargetAtTime(c.trackPans[instrument as MusicNote['instrument']], t, 0.02);
    }
    for (const nodes of this.filters) {
      nodes.filter.frequency.cancelAndHoldAtTime(t);
      nodes.filter.frequency.setTargetAtTime(c.cutoff, t, 0.02);
      if (c.filterAutomation.length)
        scheduleFilter(nodes.filter, c, this.playing ? this.position() : 0, t);
      nodes.filter.Q.setTargetAtTime(c.resonance, t, 0.02);
      nodes.lfo.frequency.setTargetAtTime(c.lfoRate, t, 0.02);
      nodes.depth.gain.setTargetAtTime(c.lfoDepth, t, 0.02);
    }
    if (!c.matchLoudness || c.bypass) this.match.gain.setTargetAtTime(1, t, 0.08);
  }
  meter() {
    const wave = new Float32Array(this.analyser.fftSize),
      dry = new Float32Array(this.dryAnalyser.fftSize);
    const spectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatTimeDomainData(wave);
    this.dryAnalyser.getFloatTimeDomainData(dry);
    this.analyser.getFloatFrequencyData(spectrum);
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    const wetRms = rms(wave),
      dryRms = rms(dry);
    if (this.config.matchLoudness && !this.config.bypass && wetRms > 0.002 && dryRms > 0.002) {
      const gain = Math.min(4, Math.max(0.25, (this.match.gain.value * dryRms) / wetRms));
      this.match.gain.setTargetAtTime(gain, this.context.currentTime, 0.5);
    }
    const frequencies = Float32Array.from({ length: 64 }, (_, i) => 40 * (12000 / 40) ** (i / 63)),
      response = new Float32Array(64),
      phase = new Float32Array(64);
    this.eq.getFrequencyResponse(frequencies, response, phase);
    const modulation = new Float32Array(32);
    [...this.filters].at(-1)?.monitor.getFloatTimeDomainData(modulation);
    return {
      wave,
      spectrum,
      response,
      lfoValue: modulation.at(-1) ?? 0,
      reduction: this.compressor.reduction,
      peakDb: 20 * Math.log10(Math.max(1e-6, ...wave.map(Math.abs))) + this.config.gainDb,
    };
  }
  note(note: MusicNote, at = this.context.currentTime, held = false): Voice {
    this.activate();
    const ctx = this.context,
      c = this.config,
      seconds = (note.duration * 60) / c.bpm;
    const envelope = ctx.createGain(),
      sources: AudioScheduledSourceNode[] = [],
      nodes: AudioNode[] = [envelope];
    const velocity = note.velocity / 127;
    const drum = ['kick', 'snare', 'hat'].includes(note.instrument);
    envelope.connect(this.tracks.get(note.instrument)!.gain);
    const endAt = at + (drum ? 2 : seconds),
      release = drum ? 0.04 : c.release;
    let disposed = false;
    let synthNodes:
      | { filter: BiquadFilterNode; lfo: OscillatorNode; depth: GainNode; monitor: AnalyserNode }
      | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      nodes.forEach((n) => n.disconnect());
      if (synthNodes) this.filters.delete(synthNodes);
      this.voices.delete(voice);
    };
    const voice: Voice = {
      end: (time = ctx.currentTime, immediate = false) => {
        if (disposed) return;
        envelope.gain.cancelAndHoldAtTime(time);
        envelope.gain.setTargetAtTime(0, time, Math.max(0.005, release / 4));
        for (const s of sources) {
          try {
            s.stop(immediate ? time : time + release + 0.05);
          } catch {}
        }
        if (immediate) dispose();
      },
    };
    this.voices.add(voice);
    const sample = this.manifest
      .filter((s) =>
        note.instrument === 'piano' ? s.id.startsWith('piano-') : s.id === note.instrument,
      )
      .sort((a, b) => Math.abs(a.root - note.pitch) - Math.abs(b.root - note.pitch))[0];
    if (sample) {
      const buffer = this.buffers.get(sample.id);
      if (!buffer) {
        dispose();
        throw Error('音色尚未加载，请先启用声音');
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = drum ? 1 : 2 ** ((note.pitch - sample.root) / 12);
      source.connect(envelope);
      sources.push(source);
      nodes.push(source);
      envelope.gain.setValueAtTime(velocity * (drum ? 0.85 : 0.5), at);
    } else {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = c.cutoff;
      scheduleFilter(filter, c, note.beat, at);
      filter.Q.value = c.resonance;
      filter.connect(envelope);
      nodes.push(filter);
      const lfo = ctx.createOscillator(),
        depth = ctx.createGain();
      lfo.frequency.value = c.lfoRate;
      depth.gain.value = c.lfoDepth;
      lfo.connect(depth);
      depth.connect(filter.frequency);
      sources.push(lfo);
      nodes.push(lfo, depth);
      const monitor = ctx.createAnalyser();
      monitor.fftSize = 32;
      lfo.connect(monitor);
      nodes.push(monitor);
      synthNodes = { filter, lfo, depth, monitor };
      this.filters.add(synthNodes);
      for (const detune of [-c.detune, 0, c.detune]) {
        const o = ctx.createOscillator();
        o.type = note.instrument === 'bass' && c.preset !== 'dnb' ? 'sine' : c.waveform;
        o.frequency.value = midiFrequency(note.pitch);
        o.detune.value = detune;
        o.connect(filter);
        sources.push(o);
        nodes.push(o);
      }
      const level = velocity * 0.12;
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(level, at + c.attack);
      envelope.gain.linearRampToValueAtTime(level * c.sustain, at + c.attack + c.decay);
    }
    if (!held) {
      envelope.gain.cancelAndHoldAtTime(Math.max(at + 0.01, endAt));
      envelope.gain.setTargetAtTime(0, Math.max(at + 0.01, endAt), release / 4);
    }
    sources.forEach((s) => {
      s.start(at);
      s.stop(held ? at + 30 : endAt + release + 0.05);
    });
    sources[0].onended = dispose;
    return voice;
  }
  click(at: number, strong = false) {
    const ctx = this.context,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.value = strong ? 1200 : 850;
    g.gain.setValueAtTime(0.1, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
    o.connect(g);
    g.connect(this.master);
    o.start(at);
    o.stop(at + 0.04);
    const voice = {
      end: () => {
        try {
          o.stop();
        } catch {}
      },
    };
    this.voices.add(voice);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
      this.voices.delete(voice);
    };
  }
  position() {
    const beat = this.startBeat + ((this.context.currentTime - this.epoch) * this.config.bpm) / 60;
    return this.config.loop
      ? Math.max(0, beat) % musicLength(this.config)
      : Math.min(musicLength(this.config), Math.max(0, beat));
  }
  play(fromBeat = 0, backing = true) {
    this.stop();
    this.activate();
    this.apply(this.config);
    this.playing = true;
    this.epoch = this.context.currentTime + 0.08;
    this.startBeat = fromBeat;
    const c = this.config,
      length = musicLength(c),
      notes = sequence(c).filter(
        (n) => !c.muted.includes(n.instrument) && (!c.solo || c.solo === n.instrument),
      );
    let cycle = 0,
      nextClick = Math.ceil(fromBeat),
      scheduled = new Set<string>();
    const tick = () => {
      const horizon = this.context.currentTime + 0.12;
      const currentBeat = this.startBeat + ((this.context.currentTime - this.epoch) * c.bpm) / 60;
      if (!c.loop && currentBeat >= length) {
        this.stop();
        return;
      }
      for (let lap = cycle; lap <= cycle + 1; lap++) {
        if (!c.loop && lap > 0) break;
        if (backing)
          for (const n of notes) {
            const absolute = lap * length + n.beat;
            const skipped = Math.max(0, fromBeat - absolute);
            if (skipped >= n.duration) continue;
            const when = this.epoch + ((Math.max(absolute, fromBeat) - fromBeat) * 60) / c.bpm,
              key = `${lap}:${n.id}`;
            if (when <= horizon && !scheduled.has(key) && when >= this.context.currentTime - 0.03) {
              this.note(
                skipped ? { ...n, beat: n.beat + skipped, duration: n.duration - skipped } : n,
                Math.max(when, this.context.currentTime),
              );
              scheduled.add(key);
            }
          }
      }
      while (c.metronome && this.epoch + ((nextClick - fromBeat) * 60) / c.bpm <= horizon) {
        this.click(
          Math.max(this.context.currentTime, this.epoch + ((nextClick - fromBeat) * 60) / c.bpm),
          nextClick % 4 === 0,
        );
        nextClick++;
      }
      const nextCycle = Math.floor(Math.max(0, currentBeat) / length);
      if (nextCycle > cycle) {
        cycle = nextCycle;
        scheduled = new Set([...scheduled].filter((k) => Number(k.split(':')[0]) >= cycle));
      }
    };
    tick();
    this.timer = setInterval(tick, 25);
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.playing = false;
    [...this.voices].forEach((v) => v.end(this.context.currentTime, true));
    // DynamicsCompressor has a lookahead buffer; its old output must not feed
    // the fresh reverb/delay after a rapid restart. Reset the entire stateful bus.
    this.input.disconnect(this.eq);
    this.eq.disconnect();
    this.compressor.disconnect();
    this.eq = this.context.createBiquadFilter();
    this.eq.type = 'peaking';
    this.eq.Q.value = 0.8;
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.knee.value = 0;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.15;
    this.input.connect(this.eq);
    this.eq.connect(this.compressor);
    this.compressor.connect(this.pan);
    // Clear delay/convolution tails when changing lessons or losing focus.
    this.pan.disconnect(this.delay);
    this.delay.disconnect();
    this.feedback.disconnect();
    this.delay = this.context.createDelay(3);
    this.delay.delayTime.value = (60 / this.config.bpm) * 0.75;
    this.pan.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.delayWet);
    const impulse = this.convolver.buffer;
    this.pan.disconnect(this.convolver);
    this.convolver.disconnect();
    this.convolver = this.context.createConvolver();
    this.convolver.buffer = impulse;
    this.pan.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.apply(this.config);
    this.match.gain.cancelScheduledValues(this.context.currentTime);
    this.match.gain.setValueAtTime(1, this.context.currentTime);
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setValueAtTime(0, this.context.currentTime);
    this.onStop?.();
  }
  async close() {
    this.stop();
    this.ended = true;
    if (active === this) active = undefined;
    await this.context.close();
  }
  /** Original dry material, with the same samples, oscillators, filter and envelope.
   * Track/bus mixing is omitted so students can rebuild it in Live. */
  async exportDry(): Promise<Uint8Array> {
    const c = this.config,
      rate = 44100,
      length = ((musicLength(c) * 60) / c.bpm + 3) * rate;
    const ctx = new OfflineAudioContext(1, Math.ceil(length), rate);
    for (const n of sequence(c).filter(
      (n) => !c.muted.includes(n.instrument) && (!c.solo || c.solo === n.instrument),
    )) {
      const at = (n.beat * 60) / c.bpm,
        duration = (n.duration * 60) / c.bpm;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      const drum = ['kick', 'snare', 'hat'].includes(n.instrument),
        end = at + (drum ? 2 : duration),
        release = drum ? 0.04 : c.release;
      const sample = this.manifest
        .filter((s) =>
          n.instrument === 'piano' ? s.id.startsWith('piano-') : s.id === n.instrument,
        )
        .sort((a, b) => Math.abs(a.root - n.pitch) - Math.abs(b.root - n.pitch))[0];
      if (sample) {
        gain.gain.setValueAtTime((n.velocity / 127) * (drum ? 0.85 : 0.5), at);
        const s = ctx.createBufferSource();
        s.buffer = this.buffers.get(sample.id)!;
        s.playbackRate.value = n.instrument === 'piano' ? 2 ** ((n.pitch - sample.root) / 12) : 1;
        s.connect(gain);
        s.start(at);
        s.stop(end + release + 0.05);
      } else {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = c.cutoff;
        scheduleFilter(filter, c, n.beat, at);
        filter.Q.value = c.resonance;
        filter.connect(gain);
        const lfo = ctx.createOscillator(),
          depth = ctx.createGain();
        lfo.frequency.value = c.lfoRate;
        depth.gain.value = c.lfoDepth;
        lfo.connect(depth);
        depth.connect(filter.frequency);
        lfo.start(at);
        lfo.stop(end + release + 0.05);
        for (const detune of [-c.detune, 0, c.detune]) {
          const s = ctx.createOscillator();
          s.type = n.instrument === 'bass' && c.preset !== 'dnb' ? 'sine' : c.waveform;
          s.frequency.value = midiFrequency(n.pitch);
          s.detune.value = detune;
          s.connect(filter);
          s.start(at);
          s.stop(end + release + 0.05);
        }
        const level = (n.velocity / 127) * 0.12;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(level, at + c.attack);
        gain.gain.linearRampToValueAtTime(level * c.sustain, at + c.attack + c.decay);
      }
      gain.gain.cancelAndHoldAtTime(end);
      gain.gain.setTargetAtTime(0, end, release / 4);
    }
    const result = await ctx.startRendering();
    return encodeWav(result.getChannelData(0), rate);
  }
}
