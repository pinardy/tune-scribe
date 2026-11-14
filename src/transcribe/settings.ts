// Choices that change how the heard notes are written down. Changing any of
// them re-notates instantly; none requires listening to the audio again.

import type { Key } from '../notation/theory';
import { MAJOR_TONICS, MINOR_TONICS } from '../notation/theory';
import type { Feel } from './feel';
import type { Clef, TimeSignature } from './score';
import { METERS } from './score';

export interface ScribeSettings {
  /** quarter notes per minute, or 'auto' to work it out from the playing */
  tempo: 'auto' | number;
  timeSignature: TimeSignature;
  /** shortest note value written, in sixteenth-note units: 1 = 16th, 2 = 8th */
  finest: 1 | 2;
  /** how the beat divides: evenly, swung, or with triplets (ignored in 6/8) */
  feel: Feel;
  key: 'auto' | Key;
  clef: 'auto' | Clef;
  /** which beat of the first bar the tune starts on (1-based) */
  startBeat: number;
  /** semitones the tune is written above (+) or below (-) where it was heard */
  transpose: number;
}

export const DEFAULT_SETTINGS: ScribeSettings = {
  tempo: 'auto',
  timeSignature: '4/4',
  finest: 1,
  feel: 'straight',
  key: 'auto',
  clef: 'auto',
  startBeat: 1,
  transpose: 0,
};

export const MIN_BPM = 30;
export const MAX_BPM = 240;
/** an octave either way */
export const MAX_TRANSPOSE = 12;

/** How many felt beats a bar has (6/8 has two). */
export function feltBeats(time: TimeSignature): number {
  const meter = METERS[time];
  return meter.barUnits / meter.beatUnits;
}

/** Validates settings loaded from storage, field by field. */
export function sanitizeSettings(stored: unknown): ScribeSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof ScribeSettings, unknown>>;
  const out: ScribeSettings = { ...DEFAULT_SETTINGS };

  if (typeof s.tempo === 'number' && Number.isFinite(s.tempo)) {
    out.tempo = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(s.tempo)));
  }
  if (typeof s.timeSignature === 'string' && s.timeSignature in METERS) {
    out.timeSignature = s.timeSignature as TimeSignature;
  }
  if (s.finest === 1 || s.finest === 2) out.finest = s.finest;
  if (s.feel === 'swing' || s.feel === 'triplets') out.feel = s.feel;
  if (s.key && typeof s.key === 'object') {
    const k = s.key as Partial<Key>;
    const tonics = k.mode === 'major' ? MAJOR_TONICS : k.mode === 'minor' ? MINOR_TONICS : [];
    if (typeof k.tonic === 'string' && tonics.includes(k.tonic)) out.key = { tonic: k.tonic, mode: k.mode! };
  }
  if (s.clef === 'treble' || s.clef === 'bass') out.clef = s.clef;
  if (typeof s.startBeat === 'number' && Number.isInteger(s.startBeat)) {
    out.startBeat = Math.min(feltBeats(out.timeSignature), Math.max(1, s.startBeat));
  }
  if (typeof s.transpose === 'number' && Number.isInteger(s.transpose)) {
    out.transpose = Math.min(MAX_TRANSPOSE, Math.max(-MAX_TRANSPOSE, s.transpose));
  }
  return out;
}
