// Corrections made by hand to individual notes. They are kept apart from the
// heard notes and applied after the rhythm grid, so changing a setting
// re-notates the tune without losing them.

import type { QuantNote } from './quantize';

export interface NoteEdit {
  /** pitch moved by this many semitones */
  semitones?: number;
  /** written length changed by this many grid steps; later notes move with it */
  steps?: number;
  /** left out of the score; a rest takes its place */
  removed?: boolean;
}

/** Edits by the index of the played note they apply to. */
export type NoteEdits = Record<number, NoteEdit>;

/** The range a pitch can be nudged within: the piano, less its extremes. */
const MIN_MIDI = 28;
const MAX_MIDI = 103;

/**
 * Applies hand edits to the quantised notes. A length change ripples: every
 * later note starts that much later or earlier, as it would if the rhythm
 * had been heard that way.
 *
 * @param stepUnits  the grid step a length edit counts in, in units
 */
export function applyEdits(notes: QuantNote[], edits: NoteEdits, stepUnits: number): QuantNote[] {
  const out: QuantNote[] = [];
  let shift = 0;
  for (const note of notes) {
    const edit = edits[note.eventIndex];
    const length = Math.max(stepUnits, note.length + (edit?.steps ?? 0) * stepUnits);
    const start = note.start + shift;
    shift += length - note.length;
    if (edit?.removed) continue;
    const midi = Math.min(MAX_MIDI, Math.max(MIN_MIDI, note.midi + (edit?.semitones ?? 0)));
    out.push({ ...note, start, length, midi });
  }
  return out;
}

/** `edits` with one note's edit changed; an edit that no longer changes anything is dropped. */
export function withEdit(edits: NoteEdits, eventIndex: number, change: (edit: NoteEdit) => NoteEdit): NoteEdits {
  const next = { ...edits };
  const edit = change(edits[eventIndex] ?? {});
  if (!edit.semitones && !edit.steps && !edit.removed) delete next[eventIndex];
  else next[eventIndex] = edit;
  return next;
}

/** Validates edits loaded from storage. */
export function sanitizeEdits(stored: unknown): NoteEdits {
  const out: NoteEdits = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const edit: NoteEdit = {};
    if (typeof v.semitones === 'number' && Number.isInteger(v.semitones)) edit.semitones = v.semitones;
    if (typeof v.steps === 'number' && Number.isInteger(v.steps)) edit.steps = v.steps;
    if (v.removed === true) edit.removed = true;
    if (edit.semitones || edit.steps || edit.removed) out[index] = edit;
  }
  return out;
}
