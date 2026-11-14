// Corrections made by hand to individual notes. They are kept apart from the
// heard notes and applied after the rhythm grid, so changing a setting
// re-notates the tune without losing them.

import { snapUnits } from './feel';
import type { QuantNote } from './quantize';

export interface NoteEdit {
  /** pitch moved by this many semitones */
  semitones?: number;
  /** written length changed by this many grid steps; later notes move with it */
  steps?: number;
  /** end moved by this many grid steps, into the rest or the note that follows; nothing else moves */
  stretch?: number;
  /** left out of the score; a rest takes its place */
  removed?: boolean;
  /** not a note of its own: the note before it is held through it */
  joined?: boolean;
  /** written as two notes of half the length; the second can be edited under `splitHalf(index)` */
  split?: boolean;
}

/** Edits by the index of the played note they apply to. */
export type NoteEdits = Record<number, NoteEdit>;

const SPLIT_OFFSET = 1_000_000;

/** The index the second half of a split note goes by, in edits and on the score. */
export function splitHalf(eventIndex: number): number {
  return eventIndex + SPLIT_OFFSET;
}

export function isSplitHalf(eventIndex: number): boolean {
  return eventIndex >= SPLIT_OFFSET;
}

/** The range a pitch can be nudged within: the piano, less its extremes. */
const MIN_MIDI = 28;
const MAX_MIDI = 103;

function isEmpty(edit: NoteEdit): boolean {
  return !edit.semitones && !edit.steps && !edit.stretch && !edit.removed && !edit.joined && !edit.split;
}

/**
 * Applies hand edits to the quantised notes.
 *
 * @param stepUnits  the grid step a length edit counts in, in units
 */
export function applyEdits(notes: QuantNote[], edits: NoteEdits, stepUnits: number): QuantNote[] {
  const out: QuantNote[] = [];
  const pitch = (midi: number, edit?: NoteEdit) =>
    Math.min(MAX_MIDI, Math.max(MIN_MIDI, midi + (edit?.semitones ?? 0)));
  // never shorter than a grid step, or than it already was (a triplet eighth is under a step)
  const resized = (length: number, steps?: number) =>
    steps ? Math.max(Math.min(stepUnits, length), length + steps * stepUnits) : length;

  // lengths that ripple: every later note starts that much later or earlier,
  // as it would if the rhythm had been heard that way
  let shift = 0;
  for (const note of notes) {
    const edit = edits[note.eventIndex];
    const length = resized(note.length, edit?.steps);
    const start = snapUnits(note.start + shift);
    shift += length - note.length;

    const before = out[out.length - 1];
    if (edit?.joined && before) {
      before.length = snapUnits(start + length - before.start);
      continue;
    }
    if (edit?.removed) continue;
    const whole = { ...note, start, length, midi: pitch(note.midi, edit) };
    out.push(whole);

    const half = Math.floor(length / 2 / stepUnits) * stepUnits;
    if (edit?.split && half >= stepUnits) {
      const second = edits[splitHalf(note.eventIndex)];
      const secondLength = resized(length - half, second?.steps);
      shift += secondLength - (length - half);
      whole.length = half;
      if (!second?.removed) {
        out.push({
          eventIndex: splitHalf(note.eventIndex),
          start: snapUnits(start + half),
          length: secondLength,
          midi: pitch(whole.midi, second),
        });
      }
    }
  }

  // ends moved on their own: into the silence after the note, or into the next note
  out.forEach((note, i) => {
    const stretch = edits[note.eventIndex]?.stretch;
    if (!stretch) return;
    const next = out[i + 1];
    let end = note.start + resized(note.length, stretch);
    if (next) {
      // the next note gives way, but keeps at least a step of itself
      end = Math.min(end, next.start + next.length - Math.min(stepUnits, next.length));
      if (end > next.start) {
        next.length = snapUnits(next.start + next.length - end);
        next.start = snapUnits(end);
      }
    }
    note.length = snapUnits(Math.max(end - note.start, Math.min(stepUnits, note.length)));
  });
  return out;
}

/** `edits` with one note's edit changed; an edit that no longer changes anything is dropped. */
export function withEdit(edits: NoteEdits, eventIndex: number, change: (edit: NoteEdit) => NoteEdit): NoteEdits {
  const next = { ...edits };
  const edit = change(edits[eventIndex] ?? {});
  if (isEmpty(edit)) delete next[eventIndex];
  else next[eventIndex] = edit;
  return next;
}

/** Validates edits loaded from storage or from a link. */
export function sanitizeEdits(stored: unknown): NoteEdits {
  const out: NoteEdits = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const edit: NoteEdit = {};
    for (const field of ['semitones', 'steps', 'stretch'] as const) {
      const n = v[field];
      if (typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= 256) edit[field] = n;
    }
    for (const field of ['removed', 'joined', 'split'] as const) {
      if (v[field] === true) edit[field] = true;
    }
    if (!isEmpty(edit)) out[index] = edit;
  }
  return out;
}
