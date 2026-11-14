// A first guess at the harmony: one chord a bar, from the triads of the key,
// chosen by how much of the bar's melody each one holds. It is a starting
// point to correct, not an analysis; a melody alone leaves the harmony open.

import type { Key } from '../notation/theory';
import { tonicPitchClass } from '../notation/theory';
import { spellInKey } from './key';
import type { NoteTexts } from './marks';
import type { Score } from './score';

interface Candidate {
  /** root, in semitones above the tonic */
  root: number;
  minor: boolean;
  /** how readily it is reached for, other things being equal */
  prior: number;
}

const IN_MAJOR: Candidate[] = [
  { root: 0, minor: false, prior: 0.15 },
  { root: 7, minor: false, prior: 0.1 },
  { root: 5, minor: false, prior: 0.1 },
  { root: 9, minor: true, prior: 0.05 },
  { root: 2, minor: true, prior: 0.03 },
  { root: 4, minor: true, prior: 0 },
];

const IN_MINOR: Candidate[] = [
  { root: 0, minor: true, prior: 0.15 },
  // the dominant is major where the melody has the raised seventh, minor where it has the plain one
  { root: 7, minor: false, prior: 0.1 },
  { root: 7, minor: true, prior: 0.05 },
  { root: 5, minor: true, prior: 0.1 },
  { root: 8, minor: false, prior: 0.05 },
  { root: 3, minor: false, prior: 0.05 },
  { root: 10, minor: false, prior: 0.03 },
];

function chordName(candidate: Candidate, key: Key): string {
  const root = spellInKey(60 + ((tonicPitchClass(key) + candidate.root) % 12), key);
  return `${root.letter}${root.acc}${candidate.minor ? 'm' : ''}`;
}

/**
 * A chord for each bar that has none, by the note it would be written over.
 * A bar that keeps the chord of the bar before gets nothing, as on a lead sheet.
 */
export function suggestChords(score: Score): NoteTexts {
  const out: NoteTexts = {};
  const tonic = tonicPitchClass(score.key);
  const candidates = score.key.mode === 'minor' ? IN_MINOR : IN_MAJOR;
  const { beatUnits } = score.meter;

  let lastSounding = -1;
  score.measures.forEach((measure, i) => {
    if (measure.items.some((item) => item.kind === 'note')) lastSounding = i;
  });

  let previous = '';
  /** the note still sounding from the item before, if that was tied on */
  let tied = -1;
  score.measures.forEach((measure, index) => {
    const weight = new Array<number>(12).fill(0);
    let total = 0;
    let anchor = -1;
    let written = '';
    let position = 0;
    let finalPc = -1;
    for (const item of measure.items) {
      if (item.kind === 'note' && item.pitch) {
        const pc = (((item.pitch.midi - tonic) % 12) + 12) % 12;
        // what falls on a beat is heard as harmony; what passes between beats less so
        const w = item.units * (Math.abs(position % beatUnits) < 1e-6 ? 1.5 : 1);
        weight[pc] += w;
        total += w;
        finalPc = pc;
        if (item.eventIndex !== tied && anchor < 0) anchor = item.eventIndex;
        if (item.chord) written = item.chord;
        tied = item.tieToNext ? item.eventIndex : -1;
      } else {
        tied = -1;
      }
      position += item.units;
    }
    if (written) {
      previous = written;
      return;
    }
    if (total === 0 || anchor < 0) return;

    let best = candidates[0];
    let bestFit = -Infinity;
    for (const candidate of candidates) {
      const tones = [candidate.root, candidate.root + (candidate.minor ? 3 : 4), candidate.root + 7].map((t) => t % 12);
      let held = 0;
      for (const t of tones) held += weight[t];
      let fit = (held - 0.6 * (total - held)) / total + (0.1 * weight[tones[0]]) / total + candidate.prior;
      // a tune comes home at the end
      if (index === lastSounding && candidate.root === 0 && tones.includes(finalPc)) fit += 0.25;
      if (fit > bestFit) {
        bestFit = fit;
        best = candidate;
      }
    }
    const name = chordName(best, score.key);
    if (name !== previous) out[anchor] = name;
    previous = name;
  });
  return out;
}
