// A guess at the time signature and the beat the tune starts on, from where
// its long notes fall. Long notes tend to land on strong beats; the bar
// length and starting beat that put the most weight there are the likeliest.
// It is a suggestion to offer, not a setting to apply: an even run of
// quarter notes fits every metre equally well.

import { isWholeUnits } from './feel';
import type { QuantNote } from './quantize';
import type { TimeSignature } from './score';
import { METERS } from './score';
import { feltBeats } from './settings';

export interface MeterSuggestion {
  timeSignature: TimeSignature;
  /** 1-based */
  startBeat: number;
}

/** 2/4 is left out: nothing in the notes tells it from 4/4. */
const CANDIDATES: TimeSignature[] = ['4/4', '3/4', '6/8'];
/** how much better than the current reading a suggestion has to be */
const MARGIN = 0.07;
const MIN_NOTES = 8;

/** How strong a position in the bar is, 0…1. */
function strength(time: TimeSignature, position: number): number {
  if (!isWholeUnits(position)) return 0;
  const p = Math.round(position);
  if (p === 0) return 1;
  if (time === '6/8') return p === 6 ? 0.5 : p % 2 === 0 ? 0.15 : 0;
  if (time !== '3/4' && p === 8) return 0.5;
  return p % 4 === 0 ? 0.25 : p % 2 === 0 ? 0.08 : 0;
}

/** Mean strength over a bar's sixteenths: what notes scattered at random would score. */
const CHANCE: Record<TimeSignature, number> = { '4/4': 0, '3/4': 0, '2/4': 0, '6/8': 0 };
for (const time of Object.keys(CHANCE) as TimeSignature[]) {
  const bar = METERS[time].barUnits;
  for (let p = 0; p < bar; p++) CHANCE[time] += strength(time, p) / bar;
}

function fit(notes: QuantNote[], time: TimeSignature, startBeat: number): number {
  const meter = METERS[time];
  const lead = (startBeat - 1) * meter.beatUnits - notes[0].start;
  let total = 0;
  let weight = 0;
  for (const note of notes) {
    // a longer note is a heavier one, up to a half note
    const accent = 1 + Math.min(note.length, 8) / 4;
    const inBar = (((note.start + lead) % meter.barUnits) + meter.barUnits) % meter.barUnits;
    total += accent * strength(time, inBar);
    weight += accent;
  }
  return total / weight - CHANCE[time];
}

/**
 * @param current  the reading in force; a suggestion is only made when another fits clearly better
 */
export function suggestMeter(
  notes: QuantNote[],
  current: { timeSignature: TimeSignature; startBeat: number },
): MeterSuggestion | null {
  if (notes.length < MIN_NOTES) return null;
  const last = notes[notes.length - 1];
  if (last.start + last.length - notes[0].start < 32) return null; // under two bars of 4/4

  let best: MeterSuggestion | null = null;
  let bestFit = fit(notes, current.timeSignature, current.startBeat) + MARGIN;
  for (const timeSignature of CANDIDATES) {
    for (let startBeat = 1; startBeat <= feltBeats(timeSignature); startBeat++) {
      const score = fit(notes, timeSignature, startBeat);
      if (score > bestFit) {
        bestFit = score;
        best = { timeSignature, startBeat };
      }
    }
  }
  return best;
}
