// The written score: bars of notes and rests with real note values.
// Everything is measured in sixteenth-note units.

import type { Key, SpelledNote } from '../notation/theory';
import { isWholeUnits, snapUnits } from './feel';
import { spellInKey } from './key';
import type { QuantNote } from './quantize';

export type TimeSignature = '4/4' | '3/4' | '2/4' | '6/8';
export type Clef = 'treble' | 'bass';
/** VexFlow duration names */
export type DurationName = 'w' | 'h' | 'q' | '8' | '16';

export interface Meter {
  name: TimeSignature;
  beats: number;
  beatValue: number;
  /** bar length in units */
  barUnits: number;
  /** length of one felt beat in units: a quarter, or a dotted quarter in 6/8 */
  beatUnits: number;
}

export const METERS: Record<TimeSignature, Meter> = {
  '4/4': { name: '4/4', beats: 4, beatValue: 4, barUnits: 16, beatUnits: 4 },
  '3/4': { name: '3/4', beats: 3, beatValue: 4, barUnits: 12, beatUnits: 4 },
  '2/4': { name: '2/4', beats: 2, beatValue: 4, barUnits: 8, beatUnits: 4 },
  '6/8': { name: '6/8', beats: 6, beatValue: 8, barUnits: 12, beatUnits: 6 },
};

export interface ScoreItem {
  kind: 'note' | 'rest';
  /** length in units; two thirds of the written value for a tuplet */
  units: number;
  duration: DurationName;
  dotted: boolean;
  /** one of a triplet: three eighths (or a quarter and an eighth) in the time of one beat */
  tuplet?: boolean;
  /** a rest that fills its whole bar, drawn as a centred whole rest */
  wholeBar?: boolean;
  /** notes only */
  pitch?: SpelledNote;
  /** this notehead is tied to the next one (same sounding note, split by a beat or bar line) */
  tieToNext?: boolean;
  /** index of the played note this came from; -1 for rests */
  eventIndex: number;
  /** chord symbol above the note, as typed */
  chord?: string;
  /** syllable under the note */
  lyric?: string;
}

export interface Measure {
  items: ScoreItem[];
}

export interface Score {
  key: Key;
  meter: Meter;
  clef: Clef;
  bpm: number;
  /** the eighths are written evenly and played long-short */
  swing?: boolean;
  measures: Measure[];
}

const VALUES: Record<number, { duration: DurationName; dotted: boolean }> = {
  16: { duration: 'w', dotted: false },
  12: { duration: 'h', dotted: true },
  8: { duration: 'h', dotted: false },
  6: { duration: 'q', dotted: true },
  4: { duration: 'q', dotted: false },
  3: { duration: '8', dotted: true },
  2: { duration: '8', dotted: false },
  1: { duration: '16', dotted: false },
};

/**
 * Breaks a span inside one bar into note values a reader expects to see.
 * The rule of thumb engravers follow: show where the beats are. A value may
 * start off the beat only if it finishes that beat (or is the familiar
 * eighth–quarter–eighth syncopation); longer spans are completed to the next
 * beat first and continue from there, tied together.
 *
 * @param position  offset from the bar line, in units
 * @param length    span length in units; must not run past the bar
 */
export function splitSpan(position: number, length: number, meter: Meter, isRest: boolean): number[] {
  const out: number[] = [];
  const { barUnits, beatUnits } = meter;
  let p = position;
  let r = length;

  // largest value from `allowed` that fits in `limit`
  const take = (allowed: number[], limit: number) => allowed.find((v) => v <= limit)!;

  while (r > 0) {
    const inBeat = p % beatUnits;
    let d: number;
    if (inBeat === 0) {
      // on a beat: the largest plain or dotted value that fits
      const allowed: number[] = [];
      if (p === 0 && barUnits === 16) allowed.push(16);
      if (beatUnits === 4) {
        if (!isRest && p + 12 <= barUnits) allowed.push(12);
        // a half rest only on the strong half of the bar
        if (!isRest || p % 8 === 0) allowed.push(8);
        if (!isRest) allowed.push(6);
        allowed.push(4);
        if (!isRest) allowed.push(3);
      } else {
        if (p === 0) allowed.push(12);
        allowed.push(6, 4);
        if (!isRest) allowed.push(3);
      }
      allowed.push(2, 1);
      d = take(allowed, r);
    } else {
      const toBeat = beatUnits - inBeat;
      if (beatUnits === 4 && !isRest && inBeat === 2 && r === 4) {
        d = 4; // eighth–quarter–eighth
      } else {
        const limit = Math.min(r, toBeat);
        const allowed: number[] = [];
        if (beatUnits === 6 && inBeat % 2 === 0) allowed.push(4);
        if (!isRest && (beatUnits === 4 ? inBeat === 1 : inBeat % 2 === 0)) allowed.push(3);
        if (inBeat % 2 === 0 || (beatUnits === 4 && inBeat === 1 && !isRest)) allowed.push(2);
        allowed.push(1);
        d = take(allowed, limit);
      }
    }
    out.push(d);
    p += d;
    r -= d;
  }
  return out;
}

/** Lays quantised notes out into bars, adding rests and splitting values at beats and bar lines. */
export function buildScore(notes: QuantNote[], key: Key, meter: Meter, clef: Clef, bpm: number): Score {
  const measures: Measure[] = [];
  const barUnits = meter.barUnits;

  const measureAt = (unit: number): Measure => {
    const index = Math.floor(unit / barUnits);
    while (measures.length <= index) measures.push({ items: [] });
    return measures[index];
  };

  // beats that have to be written as a triplet: something starts or stops on a third of them
  const tripletBeats = new Set<number>();
  if (meter.beatUnits === 4) {
    for (const note of notes) {
      for (const edge of [note.start, note.start + note.length]) {
        if (!isWholeUnits(edge)) tripletBeats.add(Math.floor(edge / 4));
      }
    }
  }
  const THIRD = 4 / 3;

  const emit = (from: number, to: number, note: QuantNote | null, nextMidi?: number) => {
    const pitch = note ? spellInKey(note.midi, key, nextMidi) : undefined;
    const push = (measure: Measure, units: number, value: { duration: DurationName; dotted: boolean }, last: boolean, tuplet = false) => {
      measure.items.push(
        note
          ? { kind: 'note', units, ...value, ...(tuplet && { tuplet }), pitch, tieToNext: !last, eventIndex: note.eventIndex }
          : { kind: 'rest', units, ...value, ...(tuplet && { tuplet }), eventIndex: -1 },
      );
    };

    let cursor = from;
    while (cursor < to - 1e-6) {
      const measure = measureAt(cursor + 1e-6);
      const barStart = Math.floor(cursor / barUnits + 1e-6) * barUnits;
      const barEnd = barStart + barUnits;
      const beat = Math.floor(cursor / 4 + 1e-6);

      if (tripletBeats.has(beat)) {
        // inside a triplet beat: whole thirds of it, an eighth each, or a quarter for two
        const beatStart = beat * 4;
        const end = Math.min(to, beatStart + 4);
        const first = Math.min(3, Math.max(0, Math.round((cursor - beatStart) / THIRD)));
        const slots = Math.min(3, Math.round((end - beatStart) / THIRD)) - first;
        const last = end >= to - 1e-6;
        if (slots === 3) push(measure, 4, VALUES[4], last);
        else if (slots === 2) push(measure, 2 * THIRD, VALUES[4], last, true);
        else if (slots === 1) push(measure, THIRD, VALUES[2], last, true);
        cursor = snapUnits(end);
        continue;
      }

      // a straight run: up to the bar line or the next triplet beat
      let end = Math.min(to, barEnd);
      if (tripletBeats.size > 0) {
        for (let b = beat + 1; b * 4 < end; b++) {
          if (tripletBeats.has(b)) {
            end = b * 4;
            break;
          }
        }
      }
      end = Math.round(end);
      const start = Math.round(cursor);
      if (!note && start === barStart && end === barEnd) {
        measure.items.push({ kind: 'rest', units: barUnits, duration: 'w', dotted: false, wholeBar: true, eventIndex: -1 });
      } else {
        const parts = splitSpan(start - barStart, end - start, meter, !note);
        parts.forEach((units, i) => push(measure, units, VALUES[units], i === parts.length - 1 && end >= to - 1e-6));
      }
      cursor = end;
    }
  };

  let cursor = 0;
  notes.forEach((note, i) => {
    const start = snapUnits(Math.max(note.start, cursor)); // never overlap the previous note
    const end = snapUnits(start + Math.max(1, note.length - (start - note.start)));
    if (start > cursor) emit(cursor, start, null);
    emit(start, end, note, notes[i + 1]?.midi);
    cursor = end;
  });
  // rests to the end of the last bar
  const finalBar = Math.ceil(cursor / barUnits - 1e-6) * barUnits;
  if (cursor < finalBar) emit(cursor, finalBar, null);

  return { key, meter, clef, bpm, measures };
}

/** Bass clef when most of the tune sits below middle C. */
export function chooseClef(midis: number[]): Clef {
  if (midis.length === 0) return 'treble';
  const sorted = [...midis].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] < 57 ? 'bass' : 'treble';
}

/** One sounding note of the score, with ties folded back together. */
export interface PerformedNote {
  eventIndex: number;
  midi: number;
  /** from the first bar line, in units */
  startUnits: number;
  lengthUnits: number;
}

/** The score as a player would perform it: tied noteheads joined, rests as gaps. */
export function performance(score: Score): PerformedNote[] {
  const out: PerformedNote[] = [];
  let cursor = 0;
  let open: PerformedNote | null = null;
  for (const measure of score.measures) {
    for (const item of measure.items) {
      if (item.kind === 'note' && item.pitch) {
        if (open) {
          open.lengthUnits = snapUnits(open.lengthUnits + item.units);
        } else {
          open = { eventIndex: item.eventIndex, midi: item.pitch.midi, startUnits: cursor, lengthUnits: item.units };
        }
        if (!item.tieToNext) {
          out.push(open);
          open = null;
        }
      }
      cursor = snapUnits(cursor + item.units);
    }
  }
  if (open) out.push(open);
  return out;
}
