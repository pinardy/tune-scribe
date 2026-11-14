// Snaps played notes onto a rhythm grid.

import type { NoteEvent } from './segment';

export interface QuantNote {
  /** index into the NoteEvent list this came from */
  eventIndex: number;
  midi: number;
  /** position from the start of bar 1, in sixteenth-note units */
  start: number;
  /** written length in units */
  length: number;
}

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
 */
export function quantize(
  notes: NoteEvent[],
  unitSeconds: number,
  stepUnits: number,
  leadInUnits = 0,
  beatUnits = 4,
): QuantNote[] {
  if (notes.length === 0) return [];
  const baseStep = unitSeconds * stepUnits;
  let step = baseStep;
  let position = leadInUnits;

  const starts: number[] = [];
  const stepAt: number[] = [];
  for (let i = 0; i < notes.length; i++) {
    if (i > 0) {
      const gap = notes[i].start - notes[i - 1].start;
      const steps = Math.max(1, Math.round(gap / step));
      position += steps * stepUnits;
      // short gaps are the reliable ones for following the tempo
      if (steps <= 4) {
        const observed = gap / steps;
        step = Math.min(baseStep * 1.25, Math.max(baseStep * 0.8, 0.75 * step + 0.25 * observed));
      }
    }
    starts.push(position);
    stepAt.push(step);
  }

  return notes.map((note, i) => {
    const sounding = Math.max(1, Math.round((note.end - note.start) / stepAt[i])) * stepUnits;
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
    return { eventIndex: i, midi: note.midi, start: starts[i], length };
  });
}
