// Turns a mono recording into a pitch contour: one pitch (or "nothing") and
// one loudness value every 10 ms. Pure number crunching with no DOM access,
// so it runs in the analysis worker and under vitest alike.

import { Yin } from './yin';

export interface PitchTrack {
  /** seconds between consecutive frames */
  hopSeconds: number;
  /** time of the centre of frame 0 */
  offsetSeconds: number;
  /** length of the analysed audio */
  duration: number;
  /** fractional MIDI pitch per frame at A4 = 440 Hz; NaN where no pitch was found */
  midi: Float32Array;
  /** RMS level per frame */
  rms: Float32Array;
}

export interface TrackOptions {
  hopSeconds?: number;
  /** called with 0…1 as the analysis advances */
  onProgress?: (fraction: number) => void;
}

/** Below this level a frame is silence and is not searched for a pitch. */
const SILENCE_RMS = 0.002;
/** Analysis runs at 16–32 kHz: plenty for pitches up to 2 kHz, and 4× cheaper than 48 kHz. */
const MAX_ANALYSIS_RATE = 32000;

// 15-tap windowed-sinc low-pass at a quarter of the sample rate, for halving it
const HALF_BAND = (() => {
  const taps = 15;
  const mid = (taps - 1) / 2;
  const h = new Float32Array(taps);
  let sum = 0;
  for (let n = 0; n < taps; n++) {
    const x = n - mid;
    const sinc = x === 0 ? 1 : Math.sin((Math.PI * x) / 2) / ((Math.PI * x) / 2);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (taps - 1));
    h[n] = sinc * hamming;
    sum += h[n];
  }
  for (let n = 0; n < taps; n++) h[n] /= sum;
  return h;
})();

/** Halves the sample rate (low-pass, then keep every other sample). */
export function decimateBy2(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length >> 1);
  const taps = HALF_BAND.length;
  const mid = (taps - 1) / 2;
  for (let i = 0; i < out.length; i++) {
    let acc = 0;
    const center = i * 2;
    for (let k = 0; k < taps; k++) {
      const idx = center + k - mid;
      if (idx >= 0 && idx < x.length) acc += x[idx] * HALF_BAND[k];
    }
    out[i] = acc;
  }
  return out;
}

/** Brings audio down to the analysis rate and removes DC offset and rumble. */
export function prepareForAnalysis(pcm: Float32Array, sampleRate: number): { pcm: Float32Array; sampleRate: number } {
  let x = pcm;
  let rate = sampleRate;
  while (rate > MAX_ANALYSIS_RATE) {
    x = decimateBy2(x);
    rate /= 2;
  }
  // one-pole DC blocker (~35 Hz corner): YIN compares raw waveforms, so a
  // slow drift under the signal would smear every dip
  const out = new Float32Array(x.length);
  const r = Math.exp((-2 * Math.PI * 35) / rate);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] - prevIn + r * prevOut;
    prevIn = x[i];
    prevOut = y;
    out[i] = y;
  }
  return { pcm: out, sampleRate: rate };
}

/** Runs the pitch detector across audio already at the analysis rate. */
export function trackPitch(pcm: Float32Array, sampleRate: number, options: TrackOptions = {}): PitchTrack {
  const hopSeconds = options.hopSeconds ?? 0.01;
  const yin = new Yin(sampleRate);
  const hop = Math.max(1, Math.round(sampleRate * hopSeconds));
  const frames = Math.max(0, Math.floor((pcm.length - yin.frameSize) / hop) + 1);
  const midi = new Float32Array(frames).fill(NaN);
  const rms = new Float32Array(frames);
  const W = yin.window;

  for (let f = 0; f < frames; f++) {
    const offset = f * hop;
    let energy = 0;
    for (let j = 0; j < W; j++) energy += pcm[offset + j] * pcm[offset + j];
    const level = Math.sqrt(energy / W);
    rms[f] = level;
    if (level >= SILENCE_RMS) {
      const { hz } = yin.detect(pcm, offset);
      if (hz > 0) midi[f] = 69 + 12 * Math.log2(hz / 440);
    }
    if (options.onProgress && f % 200 === 0) options.onProgress(f / frames);
  }
  options.onProgress?.(1);

  return {
    hopSeconds: hop / sampleRate,
    offsetSeconds: W / 2 / sampleRate,
    duration: pcm.length / sampleRate,
    midi,
    rms,
  };
}
