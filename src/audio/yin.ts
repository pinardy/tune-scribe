// YIN pitch detection (de Cheveigné & Kawahara, 2002).
//
// purrfect-pitch detects pitch with a plain autocorrelation and takes the
// highest peak, which is fine for a tuner where the same note is held and
// the readout is smoothed. For transcription every frame becomes part of a
// note, so octave slips matter more: YIN's cumulative-mean normalisation and
// "first dip under a threshold" rule pick the true period rather than a
// multiple of it, and its lag range is bounded so a whole track can be
// analysed in seconds.

export interface YinOptions {
  /** lowest pitch to look for; sets the longest lag searched */
  minHz?: number;
  /** highest pitch to look for; sets the shortest lag searched */
  maxHz?: number;
  /** length of the comparison window, in seconds */
  windowSeconds?: number;
  /** a dip below this counts as the period (lower = stricter) */
  threshold?: number;
  /** frames whose best dip is still above this are treated as unpitched */
  maxAperiodicity?: number;
}

export interface YinResult {
  /** detected frequency, or -1 when the frame has no clear pitch */
  hz: number;
  /** 0 (noise) … 1 (perfectly periodic) */
  clarity: number;
}

const NO_PITCH: YinResult = { hz: -1, clarity: 0 };

export class Yin {
  readonly sampleRate: number;
  /** samples needed per frame: comparison window + longest lag */
  readonly frameSize: number;
  readonly window: number;
  private readonly tauMin: number;
  private readonly tauMax: number;
  private readonly threshold: number;
  private readonly maxAperiodicity: number;
  private readonly cmnd: Float32Array;

  constructor(sampleRate: number, options: YinOptions = {}) {
    const { minHz = 60, maxHz = 2000, windowSeconds = 0.025, threshold = 0.15, maxAperiodicity = 0.35 } = options;
    this.sampleRate = sampleRate;
    this.tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
    this.tauMax = Math.ceil(sampleRate / minHz);
    this.window = Math.max(64, Math.round(sampleRate * windowSeconds));
    this.frameSize = this.window + this.tauMax + 1;
    this.threshold = threshold;
    this.maxAperiodicity = maxAperiodicity;
    this.cmnd = new Float32Array(this.tauMax + 2);
  }

  /** Analyses `frameSize` samples of `buf` starting at `offset`. */
  detect(buf: Float32Array, offset = 0): YinResult {
    const { window: W, tauMin, tauMax, cmnd } = this;
    if (offset + this.frameSize > buf.length) return NO_PITCH;

    // difference function d(tau) and its cumulative-mean normalisation
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let sum = 0;
      const shifted = offset + tau;
      for (let j = 0; j < W; j++) {
        const delta = buf[offset + j] - buf[shifted + j];
        sum += delta * delta;
      }
      running += sum;
      cmnd[tau] = running > 0 ? (sum * tau) / running : 1;
    }

    // first dip under the threshold, followed down to its local minimum
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < this.threshold) {
        while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau === -1) {
      // nothing clearly periodic: fall back to the deepest dip, if it is deep enough
      let best = tauMin;
      for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
      if (cmnd[best] > this.maxAperiodicity) return NO_PITCH;
      tau = best;
    }

    // parabolic interpolation around the minimum for sub-sample precision
    let period = tau;
    if (tau > 1 && tau < tauMax + 1) {
      const a = cmnd[tau - 1];
      const b = cmnd[tau];
      const c = cmnd[tau + 1];
      const denom = a + c - 2 * b;
      if (denom > 0) period = tau + (a - c) / (2 * denom);
    }
    return { hz: this.sampleRate / period, clarity: Math.max(0, 1 - cmnd[tau]) };
  }
}
