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
  /** written under its other name: G♭ for F♯ */
  respell?: boolean;
}

/** Edits by the index of the played note they apply to. */
export type NoteEdits = Record<number, NoteEdit>;

/**
 * A note written in by hand where only a rest was heard. It is placed from a
 * played note rather than from the start of the tune, so that it stays where
 * it was put when notes before it change length.
 */
export interface AddedNote {
  /** index of the played note it is placed from; -1 for the start of bar 1 */
  after: number;
  /** units from that note's start to this one's */
  offset: number;
  /** written length in units */
  length: number;
  /** sounding pitch */
  midi: number;
  respell?: boolean;
}

/** Added notes by the id each was given when it was added. */
export type AddedNotes = Record<number, AddedNote>;

const SPLIT_OFFSET = 1_000_000;
const ADDED_OFFSET = 2_000_000;

/** The index an added note goes by on the score. */
export function addedIndex(id: number): number {
  return id + ADDED_OFFSET;
}

export function isAdded(eventIndex: number): boolean {
  return eventIndex >= ADDED_OFFSET;
}

export function addedId(eventIndex: number): number {
  return eventIndex - ADDED_OFFSET;
}

/** The index the second half of a split note goes by, in edits and on the score. */
export function splitHalf(eventIndex: number): number {
  return eventIndex + SPLIT_OFFSET;
}

export function isSplitHalf(eventIndex: number): boolean {
  return eventIndex >= SPLIT_OFFSET && eventIndex < ADDED_OFFSET;
}

/** The played note a split half is the second half of. */
export function splitWhole(eventIndex: number): number {
  return eventIndex - SPLIT_OFFSET;
}

/** The range a pitch can be nudged within: the piano, less its extremes. */
export const MIN_MIDI = 28;
export const MAX_MIDI = 103;

function isEmpty(edit: NoteEdit): boolean {
  return (
    !edit.semitones && !edit.steps && !edit.stretch && !edit.removed && !edit.joined && !edit.split && !edit.respell
  );
}

/**
 * Applies hand edits to the quantised notes.
 *
 * @param stepUnits  the grid step a length edit counts in, in units
 */
export function applyEdits(notes: QuantNote[], edits: NoteEdits, stepUnits: number, added: AddedNotes = {}): QuantNote[] {
  const out: QuantNote[] = [];
  /** where each played note starts, on the score or not: what added notes are placed from */
  const startOf = new Map<number, number>();
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
    startOf.set(note.eventIndex, start);

    const before = out[out.length - 1];
    if (edit?.joined && before) {
      before.length = snapUnits(start + length - before.start);
      continue;
    }
    if (edit?.removed) continue;
    const whole = { ...note, start, length, midi: pitch(note.midi, edit), ...(edit?.respell && { respell: true }) };
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
          ...(second?.respell && { respell: true }),
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

  // notes written in by hand, each in whatever room there is where it was put
  for (const note of out) if (startOf.has(note.eventIndex)) startOf.set(note.eventIndex, note.start);
  const extra = Object.entries(added)
    .map(([id, a]) => ({ id: Number(id), a, start: snapUnits((a.after < 0 ? 0 : (startOf.get(a.after) ?? NaN)) + a.offset) }))
    .filter((e) => !Number.isNaN(e.start))
    .sort((x, y) => x.start - y.start || x.id - y.id);
  for (const { id, a, start: wanted } of extra) {
    let at = out.findIndex((n) => n.start > wanted - 1e-6);
    if (at < 0) at = out.length;
    const before = out[at - 1];
    const next = out[at];
    const start = before ? Math.max(wanted, snapUnits(before.start + before.length)) : wanted;
    const end = next ? Math.min(wanted + a.length, next.start) : wanted + a.length;
    if (end - start < 1 - 1e-6) continue;
    out.splice(at, 0, {
      eventIndex: addedIndex(id),
      start,
      length: snapUnits(end - start),
      midi: pitch(a.midi),
      ...(a.respell && { respell: true }),
    });
  }
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
    for (const field of ['removed', 'joined', 'split', 'respell'] as const) {
      if (v[field] === true) edit[field] = true;
    }
    if (!isEmpty(edit)) out[index] = edit;
  }
  return out;
}

export function sanitizeAdded(stored: unknown): AddedNotes {
  const out: AddedNotes = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0 || id > 100_000 || !value || typeof value !== 'object') continue;
    const { after, offset, length, midi, respell } = value as Record<string, unknown>;
    if (
      typeof after !== 'number' || !Number.isInteger(after) || after < -1 || after >= SPLIT_OFFSET ||
      typeof offset !== 'number' || !(offset >= 0 && offset <= 100_000) ||
      typeof length !== 'number' || !(length >= 1 && length <= 256) ||
      typeof midi !== 'number' || !Number.isInteger(midi) || midi < MIN_MIDI || midi > MAX_MIDI
    ) {
      continue;
    }
    out[id] = { after, offset: snapUnits(offset), length: snapUnits(length), midi, ...(respell === true && { respell: true }) };
  }
  return out;
}
