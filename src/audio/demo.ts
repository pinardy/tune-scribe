// A synthesised tune for trying the app without a microphone or a file, and
// for the pipeline tests: the opening of Beethoven's "Ode to Joy" theme.

import { midiToHz } from '../notation/theory';

/** [MIDI pitch, length in sixteenths] — D major, 4/4 */
export const DEMO_MELODY: [number, number][] = [
  [66, 4], [66, 4], [67, 4], [69, 4],
  [69, 4], [67, 4], [66, 4], [64, 4],
  [62, 4], [62, 4], [64, 4], [66, 4],
  [66, 6], [64, 2], [64, 8],
  [66, 4], [66, 4], [67, 4], [69, 4],
  [69, 4], [67, 4], [66, 4], [64, 4],
  [62, 4], [62, 4], [64, 4], [66, 4],
  [64, 6], [62, 2], [62, 8],
];

export const DEMO_BPM = 120;
export const DEMO_TITLE = 'Ode to Joy (demo)';

/**
 * Renders the melody as a plucked-string-like tone: a few harmonics with a
 * sharp attack and a decay, so repeated notes are told apart by their attack
 * just as they would be on a real instrument.
 */
export function synthesiseDemo(sampleRate = 22050, bpm = DEMO_BPM): Float32Array {
  const unit = 60 / bpm / 4;
  const leadIn = 0.3;
  const total = DEMO_MELODY.reduce((sum, [, units]) => sum + units, 0) * unit + leadIn + 0.5;
  const out = new Float32Array(Math.ceil(total * sampleRate));
  const harmonics = [1, 0.45, 0.22, 0.1];

  let t = leadIn;
  for (const [midi, units] of DEMO_MELODY) {
    const hz = midiToHz(midi);
    const length = units * unit;
    const sounding = length * 0.92;
    const from = Math.floor(t * sampleRate);
    const count = Math.floor(sounding * sampleRate);
    for (let i = 0; i < count; i++) {
      const s = i / sampleRate;
      const attack = Math.min(1, s / 0.008);
      const release = Math.min(1, (sounding - s) / 0.03);
      const envelope = attack * release * (0.35 + 0.65 * Math.exp(-s * 3.5));
      let sample = 0;
      for (let h = 0; h < harmonics.length; h++) sample += harmonics[h] * Math.sin(2 * Math.PI * hz * (h + 1) * s);
      out[from + i] += 0.3 * envelope * sample;
    }
    t += length;
  }
  return out;
}
