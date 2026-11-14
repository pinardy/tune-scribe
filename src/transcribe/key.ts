// Key finding and note spelling.

import type { Acc, Key, Letter, SpelledNote } from '../notation/theory';
import {
  ACC_OFFSET,
  LETTERS,
  LETTER_SEMITONE,
  keyAlterations,
  signatureCount,
  spell,
} from '../notation/theory';

// Krumhansl–Kessler key profiles: how strongly each scale degree is felt to
// belong to a major or minor key, from listener experiments.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Tonic names by pitch class, choosing the signature with fewer accidentals. */
const MAJOR_BY_PC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_BY_PC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - meanA) * (b[i] - meanB);
    varA += (a[i] - meanA) ** 2;
    varB += (b[i] - meanB) ** 2;
  }
  return varA && varB ? num / Math.sqrt(varA * varB) : 0;
}

/**
 * Picks the key whose profile best matches how long each pitch class sounds
 * (Krumhansl–Schmuckler), with a small nudge toward the key the tune ends on.
 */
export function estimateKey(notes: { midi: number; weight: number }[]): Key {
  if (notes.length === 0) return { tonic: 'C', mode: 'major' };
  const histogram = new Array<number>(12).fill(0);
  for (const n of notes) histogram[((n.midi % 12) + 12) % 12] += n.weight;
  const finalPc = ((notes[notes.length - 1].midi % 12) + 12) % 12;

  let best: Key = { tonic: 'C', mode: 'major' };
  let bestScore = -Infinity;
  for (let pc = 0; pc < 12; pc++) {
    // rotate so index 0 is the candidate tonic
    const rotated = histogram.map((_, i) => histogram[(i + pc) % 12]);
    const ending = finalPc === pc ? 0.08 : 0;
    const major = correlation(rotated, MAJOR_PROFILE) + ending;
    const minor = correlation(rotated, MINOR_PROFILE) + ending;
    if (major > bestScore) {
      bestScore = major;
      best = { tonic: MAJOR_BY_PC[pc], mode: 'major' };
    }
    if (minor > bestScore) {
      bestScore = minor;
      best = { tonic: MINOR_BY_PC[pc], mode: 'minor' };
    }
  }
  return best;
}

interface Spelling {
  letter: Letter;
  acc: Acc;
  /** true for a black-key note outside the scale, whose spelling may follow the melody instead */
  free?: boolean;
}

const sharpOf = (pc: number): Spelling => ({ letter: LETTERS.find((l) => LETTER_SEMITONE[l] === pc - 1)!, acc: '#' });
const flatOf = (pc: number): Spelling => ({ letter: LETTERS.find((l) => LETTER_SEMITONE[l] === pc + 1)!, acc: 'b' });

/** How each of the 12 pitch classes is written in a key. */
function spellingTable(key: Key): Spelling[] {
  const table: (Spelling | undefined)[] = new Array(12).fill(undefined);
  const alterations = keyAlterations(key);
  const pcOf = (letter: Letter, acc: Acc) => (LETTER_SEMITONE[letter] + ACC_OFFSET[acc] + 12) % 12;

  // notes of the scale are written as the key signature has them
  for (const letter of LETTERS) {
    const acc = alterations[letter] ?? '';
    table[pcOf(letter, acc)] = { letter, acc };
  }

  // minor keys: the raised 6th and 7th keep their letter (F♯ in G minor, never G♭)
  if (key.mode === 'minor') {
    const tonicIndex = LETTERS.indexOf(key.tonic[0] as Letter);
    for (const degree of [5, 6]) {
      const letter = LETTERS[(tonicIndex + degree) % 7];
      const current = alterations[letter] ?? '';
      const raised: Acc | null = current === 'b' ? '' : current === '' ? '#' : null; // no double sharps
      if (raised !== null && !table[pcOf(letter, raised)]) table[pcOf(letter, raised)] = { letter, acc: raised };
    }
  }

  // everything else: a natural where one exists, otherwise follow the signature's direction
  const sharps = signatureCount(key) >= 0;
  for (let pc = 0; pc < 12; pc++) {
    if (table[pc]) continue;
    const natural = LETTERS.find((l) => LETTER_SEMITONE[l] === pc);
    if (natural) {
      table[pc] = { letter: natural, acc: '' };
    } else if (sharps) {
      table[pc] = { ...sharpOf(pc), free: true };
    } else {
      table[pc] = { ...flatOf(pc), free: true };
    }
  }
  return table as Spelling[];
}

const tableCache = new Map<string, Spelling[]>();

/**
 * Writes a MIDI pitch the way it would be spelled in `key`.
 *
 * @param nextMidi  the note that follows, if any. A chromatic note that steps
 *   up a semitone is written as a sharp and one that steps down as a flat
 *   (F♯ rising to G, G♭ falling to F), whatever the key signature leans to.
 */
export function spellInKey(midi: number, key: Key, nextMidi?: number): SpelledNote {
  const id = `${key.tonic}${key.mode}`;
  let table = tableCache.get(id);
  if (!table) {
    table = spellingTable(key);
    tableCache.set(id, table);
  }
  const pc = ((midi % 12) + 12) % 12;
  let spelling = table[pc];
  if (spelling.free && nextMidi !== undefined) {
    if (nextMidi === midi + 1) spelling = sharpOf(pc);
    else if (nextMidi === midi - 1) spelling = flatOf(pc);
  }
  const { letter, acc } = spelling;
  // the octave belongs to the letter: C♭4 sits a semitone below C4, in octave 4
  const octave = Math.floor((midi - ACC_OFFSET[acc]) / 12) - 1;
  return spell(letter, acc, octave);
}
