// Everything put on the sheet by hand: note corrections, and the chord
// symbols and lyrics attached to notes. This is the part of a tune that has
// an undo history and is stored and shared with it.

import type { AddedNotes, NoteEdits } from './edits';
import {
  MAX_MIDI,
  MIN_MIDI,
  addedId,
  isAdded,
  isSplitHalf,
  sanitizeAdded,
  sanitizeEdits,
  splitHalf,
  splitWhole,
  withEdit,
} from './edits';
import type { Score } from './score';

/** Text by the index of the played note it belongs to. */
export type NoteTexts = Record<number, string>;

export interface Marks {
  edits: NoteEdits;
  /** notes written in where only a rest was heard */
  added: AddedNotes;
  /** chord symbols as typed: "Am", "Bb7", "F#m7" */
  chords: NoteTexts;
  /** one syllable to a note; a trailing hyphen means the word carries on */
  lyrics: NoteTexts;
  /** repeat signs, by a note in the bar they stand at */
  repeats: Repeats;
}

/** Whether the bar a note is in opens a repeated passage, closes one, or both. */
export type Repeats = Record<number, { start?: true; end?: true }>;

export const NO_MARKS: Marks = { edits: {}, added: {}, chords: {}, lyrics: {}, repeats: {} };

export const MAX_CHORD_LENGTH = 16;
export const MAX_LYRIC_LENGTH = 32;

/** `texts` with one note's text changed; empty text removes the entry. */
export function withText(texts: NoteTexts, eventIndex: number, text: string): NoteTexts {
  const next = { ...texts };
  if (text) next[eventIndex] = text;
  else delete next[eventIndex];
  return next;
}

function sanitizeTexts(stored: unknown, maxLength: number): NoteTexts {
  const out: NoteTexts = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && typeof value === 'string' && value) out[index] = value.slice(0, maxLength);
  }
  return out;
}

/** `repeats` with one sign at a note's bar switched on or off. */
export function withRepeat(repeats: Repeats, eventIndex: number, sign: 'start' | 'end', on: boolean): Repeats {
  const next = { ...repeats };
  const at = { ...repeats[eventIndex] };
  if (on) at[sign] = true;
  else delete at[sign];
  if (at.start || at.end) next[eventIndex] = at;
  else delete next[eventIndex];
  return next;
}

function sanitizeRepeats(stored: unknown): Repeats {
  const out: Repeats = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const at: Repeats[number] = {};
    if (v.start === true) at.start = true;
    if (v.end === true) at.end = true;
    if (at.start || at.end) out[index] = at;
  }
  return out;
}

/** Validates marks loaded from storage or from a link. */
export function sanitizeMarks(stored: unknown): Marks {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof Marks, unknown>>;
  return {
    edits: sanitizeEdits(s.edits),
    added: sanitizeAdded(s.added),
    chords: sanitizeTexts(s.chords, MAX_CHORD_LENGTH),
    lyrics: sanitizeTexts(s.lyrics, MAX_LYRIC_LENGTH),
    repeats: sanitizeRepeats(s.repeats),
  };
}

/** `marks` with one note, heard or added, moved by `semitones`. */
export function withPitch(marks: Marks, eventIndex: number, semitones: number): Marks {
  if (!isAdded(eventIndex)) {
    return { ...marks, edits: withEdit(marks.edits, eventIndex, (e) => ({ ...e, semitones: (e.semitones ?? 0) + semitones })) };
  }
  const note = marks.added[addedId(eventIndex)];
  if (!note) return marks;
  const midi = Math.min(MAX_MIDI, Math.max(MIN_MIDI, note.midi + semitones));
  return { ...marks, added: { ...marks.added, [addedId(eventIndex)]: { ...note, midi } } };
}

/** `marks` with one note taken off the score: a heard note is marked removed, an added one is forgotten. */
export function withoutNote(marks: Marks, eventIndex: number): Marks {
  if (!isAdded(eventIndex)) {
    return { ...marks, edits: withEdit(marks.edits, eventIndex, (e) => ({ ...e, removed: true })) };
  }
  const added = { ...marks.added };
  delete added[addedId(eventIndex)];
  return {
    ...marks,
    added,
    chords: withText(marks.chords, eventIndex, ''),
    lyrics: withText(marks.lyrics, eventIndex, ''),
    repeats: withRepeat(withRepeat(marks.repeats, eventIndex, 'start', false), eventIndex, 'end', false),
  };
}

/**
 * The marks after the played notes have been renumbered (a take trimmed, or
 * its end recorded again). `to` gives a note's new index, or null if it is gone;
 * what was marked on a note that is gone goes with it.
 */
export function remapMarks(marks: Marks, to: (eventIndex: number) => number | null): Marks {
  const moved = (index: number): number | null => {
    if (isAdded(index)) return index;
    if (!isSplitHalf(index)) return to(index);
    const whole = to(splitWhole(index));
    return whole === null ? null : splitHalf(whole);
  };
  const rekey = <T,>(record: Record<number, T>): Record<number, T> => {
    const out: Record<number, T> = {};
    for (const [key, value] of Object.entries(record)) {
      const index = moved(Number(key));
      if (index !== null) out[index] = value;
    }
    return out;
  };
  const added: AddedNotes = {};
  for (const [id, note] of Object.entries(marks.added)) {
    const after = note.after < 0 ? -1 : to(note.after);
    if (after !== null) added[Number(id)] = { ...note, after };
  }
  return {
    edits: rekey(marks.edits),
    added,
    chords: rekey(marks.chords),
    lyrics: rekey(marks.lyrics),
    repeats: rekey(marks.repeats),
  };
}

/** A chord symbol as it is shown: "Bb7" → "B♭7", "F#m" → "F♯m". */
export function chordLabel(chord: string): string {
  return chord.replace(/([A-G])b/g, '$1♭').replace(/#/g, '♯');
}

/** Puts each chord and lyric on the first notehead of its note, and each repeat sign on that notehead's bar. */
export function annotate(score: Score, marks: Pick<Marks, 'chords' | 'lyrics' | 'repeats'>): void {
  const seen = new Set<number>();
  for (const measure of score.measures) {
    for (const item of measure.items) {
      if (item.kind !== 'note' || seen.has(item.eventIndex)) continue;
      seen.add(item.eventIndex);
      if (marks.chords[item.eventIndex]) item.chord = marks.chords[item.eventIndex];
      if (marks.lyrics[item.eventIndex]) item.lyric = marks.lyrics[item.eventIndex];
      const repeat = marks.repeats[item.eventIndex];
      if (repeat?.start) measure.repeatStart = true;
      if (repeat?.end) measure.repeatEnd = true;
    }
  }
}
