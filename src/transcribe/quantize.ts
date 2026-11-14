// Snaps played notes onto a rhythm grid.

import { isWholeUnits, snapUnits, swungUnits, type Feel } from './feel';
import type { NoteEvent } from './segment';

export interface QuantNote {
  /** index into the NoteEvent list this came from */
  eventIndex: number;
  midi: number;
  /** position from the start of bar 1, in sixteenth-note units (whole, or thirds where a beat is a triplet) */
  start: number;
  /** written length in units */
  length: number;
}

/** A triplet eighth, in units. */
const THIRD = 4 / 3;

/**
 * Places each note by the gap from the previous onset rather than by its
 * absolute time, and lets the step length follow the player. Someone humming
 * for a minute speeds up and slows down; measuring gap by gap keeps one early
 * hesitation from pushing every later note off the grid.
 *
 * @param unitSeconds  seconds per sixteenth at the starting tempo
 * @param stepUnits    grid coarseness in units (1 = 16ths, 2 = 8ths, 4 = quarters)
 * @param leadInUnits  where the first note falls in bar 1
 * @param beatUnits    length of a beat in units; the last note is rounded up toward one
 * @param feel         swing stretches the grid to the long-short eighths; triplets adds
 *   the thirds of each beat to it. Both only where the beat is a quarter.
 */
export function quantize(
  notes: NoteEvent[],
  unitSeconds: number,
  stepUnits: number,
  leadInUnits = 0,
  beatUnits = 4,
  feel: Feel = 'straight',
): QuantNote[] {
  if (notes.length === 0) return [];
  const swing = feel === 'swing' && beatUnits === 4;
  const triplets = feel === 'triplets' && beatUnits === 4;
  /** when a grid position is played, in units of straight time */
  const timeOf = (units: number) => (swing ? swungUnits(units) : units);

  /** The grid position after `from` that a stretch of `seconds` most nearly reaches. */
  const reach = (from: number, seconds: number, unit: number): number => {
    const origin = timeOf(from);
    const horizon = seconds / unit + 2 * Math.max(stepUnits, 2);
    let best = from + stepUnits;
    let bestError = Infinity;
    const consider = (position: number) => {
      if (position <= from + 1e-6) return;
      const error = Math.abs(seconds - (timeOf(position) - origin) * unit);
      if (error < bestError - 1e-9) {
        bestError = error;
        best = position;
      }
    };
    for (let p = (Math.floor(from / stepUnits + 1e-6) + 1) * stepUnits; timeOf(p) - origin <= horizon; p += stepUnits) {
      consider(p);
    }
    if (triplets) {
      for (let beat = Math.floor(from / 4) * 4; beat - from <= horizon; beat += 4) {
        consider(beat + THIRD);
        consider(beat + 2 * THIRD);
      }
    }
    return snapUnits(best);
  };

  let unit = unitSeconds;
  let position = leadInUnits;

  const starts: number[] = [];
  const unitAt: number[] = [];
  for (let i = 0; i < notes.length; i++) {
    if (i > 0) {
      const gap = notes[i].start - notes[i - 1].start;
      const next = reach(position, gap, unit);
      // short gaps are the reliable ones for following the tempo
      if (next - position <= 4 * stepUnits + 1e-6) {
        const observed = gap / (timeOf(next) - timeOf(position));
        unit = Math.min(unitSeconds * 1.25, Math.max(unitSeconds * 0.8, 0.75 * unit + 0.25 * observed));
      }
      position = next;
    }
    starts.push(position);
    unitAt.push(unit);
  }

  const out = notes.map((note, i) => {
    const sounding = reach(starts[i], note.end - note.start, unitAt[i]) - starts[i];
    // the room this note has: up to the next onset, or for the last note up
    // to the beat it was heading for
    const slot =
      i + 1 < notes.length ? starts[i + 1] - starts[i] : Math.ceil((starts[i] + sounding) / beatUnits) * beatUnits - starts[i];
    let length = Math.min(sounding, slot);
    // Players let go of a note before the next one — a breath, a lifted
    // finger — and let go of long notes earlier still. That is articulation,
    // not a rest: a silence is only written when it is at least an eighth
    // (and a grid step) long and a fair share of the note's slot.
    const silence = slot - length;
    if (silence < Math.max(2, stepUnits) || silence < slot * 0.2) {
      length = slot;
    } else {
      // A rest does follow. Where exactly the note stopped is the least
      // reliable thing measured, so if it stopped near a beat, say it stopped
      // on the beat: a half note and a rest reads better than a dotted
      // quarter tied to a sixteenth.
      const end = starts[i] + length;
      const beat = Math.round(end / beatUnits) * beatUnits;
      if (beat > starts[i] && beat <= starts[i] + slot && Math.abs(beat - end) <= length * 0.25) {
        length = beat - starts[i];
      }
    }
    return { eventIndex: i, midi: note.midi, start: starts[i], length: snapUnits(length) };
  });
  if (triplets) settleTriplets(out);
  return out;
}

/**
 * A beat is either cut in three or it is not. Where any note starts or stops
 * on a third of a beat, every other start and stop inside that beat is moved
 * to the nearest third, so the beat can be written as one triplet.
 */
function settleTriplets(notes: QuantNote[]): void {
  const tripletBeats = new Set<number>();
  for (const note of notes) {
    for (const edge of [note.start, note.start + note.length]) {
      if (!isWholeUnits(edge)) tripletBeats.add(Math.floor(edge / 4));
    }
  }
  if (tripletBeats.size === 0) return;
  const settle = (edge: number): number => {
    const beat = Math.floor(edge / 4 + 1e-6);
    if (!tripletBeats.has(beat)) return edge;
    return snapUnits(beat * 4 + Math.round((edge - beat * 4) / THIRD) * THIRD);
  };
  let previousStart = -Infinity;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const end = settle(note.start + note.length);
    // two onsets that settle on the same third stay one after the other
    note.start = Math.max(settle(note.start), snapUnits(previousStart + THIRD));
    note.length = Math.max(THIRD, snapUnits(end - note.start));
    previousStart = note.start;
  }
  for (let i = 0; i + 1 < notes.length; i++) {
    const room = notes[i + 1].start - notes[i].start;
    if (notes[i].length > room) notes[i].length = snapUnits(room);
  }
}
