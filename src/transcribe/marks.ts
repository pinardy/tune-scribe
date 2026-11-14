// Everything put on the sheet by hand: note corrections, and the chord
// symbols and lyrics attached to notes. This is the part of a tune that has
// an undo history and is stored and shared with it.

import type { NoteEdits } from './edits';
import { sanitizeEdits } from './edits';
import type { Score } from './score';

/** Text by the index of the played note it belongs to. */
export type NoteTexts = Record<number, string>;

export interface Marks {
  edits: NoteEdits;
  /** chord symbols as typed: "Am", "Bb7", "F#m7" */
  chords: NoteTexts;
  /** one syllable to a note; a trailing hyphen means the word carries on */
  lyrics: NoteTexts;
  /** repeat signs, by a note in the bar they stand at */
  repeats: Repeats;
}

/** Whether the bar a note is in opens a repeated passage, closes one, or both. */
export type Repeats = Record<number, { start?: true; end?: true }>;

export const NO_MARKS: Marks = { edits: {}, chords: {}, lyrics: {}, repeats: {} };

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
    chords: sanitizeTexts(s.chords, MAX_CHORD_LENGTH),
    lyrics: sanitizeTexts(s.lyrics, MAX_LYRIC_LENGTH),
    repeats: sanitizeRepeats(s.repeats),
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
