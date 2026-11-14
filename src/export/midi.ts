// Standard MIDI File export (format 0, one track) of the written score.

import { signatureCount } from '../notation/theory';
import { swungUnits } from '../transcribe/feel';
import type { Score } from '../transcribe/score';
import { performance } from '../transcribe/score';

const TICKS_PER_QUARTER = 480;
const TICKS_PER_UNIT = TICKS_PER_QUARTER / 4;
const VELOCITY = 84;

/** MIDI variable-length quantity */
function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

export function toMidi(score: Score, title: string): Uint8Array {
  const track: number[] = [];
  const meta = (type: number, data: number[]) => track.push(0x00, 0xff, type, ...vlq(data.length), ...data);

  // track name; non-ASCII characters would need an encoding MIDI does not define
  meta(0x03, ascii(title.replace(/[^\x20-\x7e]/g, '?').slice(0, 120)));
  const microsPerQuarter = Math.round(60_000_000 / score.bpm);
  meta(0x51, [(microsPerQuarter >>> 16) & 0xff, (microsPerQuarter >>> 8) & 0xff, microsPerQuarter & 0xff]);
  meta(0x58, [score.meter.beats, Math.log2(score.meter.beatValue), 24, 8]);
  meta(0x59, [signatureCount(score.key) & 0xff, score.key.mode === 'minor' ? 1 : 0]);

  // a swung score is performed swung; MIDI has no way to say "swing the eighths"
  const timeOf = (units: number) => (score.swing ? swungUnits(units) : units);
  let cursor = 0; // ticks
  for (const note of performance(score)) {
    const start = Math.round(timeOf(note.startUnits) * TICKS_PER_UNIT);
    const length = Math.round(timeOf(note.startUnits + note.lengthUnits) * TICKS_PER_UNIT) - start;
    track.push(...vlq(start - cursor), 0x90, note.midi & 0x7f, VELOCITY);
    // release a hair early so repeated notes re-articulate
    track.push(...vlq(length - 10), 0x80, note.midi & 0x7f, 0);
    cursor = start + length - 10;
  }
  track.push(0x00, 0xff, 0x2f, 0x00); // end of track

  return new Uint8Array([
    ...ascii('MThd'),
    ...uint32(6),
    0x00, 0x00, // format 0
    0x00, 0x01, // one track
    (TICKS_PER_QUARTER >> 8) & 0xff, TICKS_PER_QUARTER & 0xff,
    ...ascii('MTrk'),
    ...uint32(track.length),
    ...track,
  ]);
}
