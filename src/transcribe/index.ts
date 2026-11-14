// The notation half of the pipeline: played notes in, written score out.
// (The listening half — audio to played notes — is pitchTrack + segment.)

import type { Key } from '../notation/theory';
import { applyEdits, type NoteEdits } from './edits';
import { estimateKey } from './key';
import { quantize } from './quantize';
import type { Score } from './score';
import { METERS, buildScore, chooseClef } from './score';
import type { NoteEvent } from './segment';
import type { ScribeSettings } from './settings';
import { estimateTempo, unitSecondsForBpm } from './tempo';

export interface Arrangement {
  score: Score;
  /** the rhythm grid the notes were placed on, in units; a length edit moves by this much */
  stepUnits: number;
  /** what was worked out from the playing, whether or not a setting overrides it */
  detected: {
    bpm: number;
    /** 0…1: how steady the pulse was; low values mean the tempo is a guess */
    tempoConfidence: number;
    key: Key;
  };
}

export interface ArrangeExtras {
  /** hand corrections to individual notes */
  edits?: NoteEdits;
  /** the tempo of the click the take was recorded to; stands in for the detected tempo */
  clickBpm?: number;
}

export function arrange(notes: NoteEvent[], settings: ScribeSettings, extras: ArrangeExtras = {}): Arrangement {
  const meter = METERS[settings.timeSignature];
  // swing and triplets divide a quarter-note beat; 6/8 is in threes already
  const feel = meter.beatUnits === 4 ? settings.feel : 'straight';
  const heard = estimateTempo(
    notes.map((n) => n.start),
    feel !== 'straight',
  );
  // a take played to a click has a known tempo, on whatever grid the settings ask for
  const tempo = extras.clickBpm
    ? { bpm: extras.clickBpm, unitSeconds: unitSecondsForBpm(extras.clickBpm), stepUnits: 1 as const, confidence: 1 }
    : heard;

  const bpm = settings.tempo === 'auto' ? tempo.bpm : settings.tempo;
  const unitSeconds = settings.tempo === 'auto' ? tempo.unitSeconds : unitSecondsForBpm(settings.tempo);
  // with a detected tempo, don't grid finer than the playing itself does
  // (and with triplets no finer than eighths: a sixteenth and a triplet eighth are too close to tell apart)
  const stepUnits = Math.max(
    settings.tempo === 'auto' ? Math.max(tempo.stepUnits, settings.finest) : settings.finest,
    feel === 'triplets' ? 2 : 1,
  );

  const leadIn = (settings.startBeat - 1) * meter.beatUnits;
  const placed = quantize(notes, unitSeconds, stepUnits, leadIn, meter.beatUnits, feel);
  const transposed = settings.transpose ? placed.map((n) => ({ ...n, midi: n.midi + settings.transpose })) : placed;
  const quantised = extras.edits ? applyEdits(transposed, extras.edits, stepUnits) : transposed;

  const detectedKey = estimateKey(quantised.map((n) => ({ midi: n.midi, weight: n.length })));
  const key = settings.key === 'auto' ? detectedKey : settings.key;
  const clef = settings.clef === 'auto' ? chooseClef(quantised.map((n) => n.midi)) : settings.clef;

  return {
    score: { ...buildScore(quantised, key, meter, clef, bpm), swing: feel === 'swing' },
    stepUnits,
    detected: { bpm: tempo.bpm, tempoConfidence: tempo.confidence, key: detectedKey },
  };
}
