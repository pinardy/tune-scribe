// Spelled notes, key signatures, and pitch math.
// Ported from purrfect-pitch (src/reading/theory.ts); the interval-naming
// helpers were left behind because nothing here labels intervals.

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Acc = '' | '#' | 'b';

export interface SpelledNote {
  letter: Letter;
  acc: Acc;
  octave: number;
  midi: number;
}

export const LETTER_SEMITONE: Record<Letter, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

export const LETTERS: Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Diatonic step index of a written pitch: C0 = 0, D0 = 1, … C1 = 7. */
export function letterIndex(letter: Letter, octave: number): number {
  return octave * 7 + LETTERS.indexOf(letter);
}

export const ACC_OFFSET: Record<Acc, number> = { '': 0, '#': 1, b: -1 };

export function spell(letter: Letter, acc: Acc, octave: number): SpelledNote {
  const midi = 12 * (octave + 1) + LETTER_SEMITONE[letter] + ACC_OFFSET[acc];
  return { letter, acc, octave, midi };
}

/** The same pitch under its other name: F♯ for G♭, F for E♯. Null for a natural, which is left as it is. */
export function enharmonic(n: SpelledNote): SpelledNote | null {
  if (!n.acc) return null;
  const letter = LETTERS[(LETTERS.indexOf(n.letter) + (n.acc === '#' ? 1 : 6)) % 7];
  const off = ((((n.midi - LETTER_SEMITONE[letter]) % 12) + 18) % 12) - 6;
  const acc: Acc | null = off === 0 ? '' : off === 1 ? '#' : off === -1 ? 'b' : null;
  if (acc === null) return null;
  return spell(letter, acc, Math.floor((n.midi - ACC_OFFSET[acc]) / 12) - 1);
}

/** VexFlow key string, e.g. "c#/5" */
export function vexKey(n: SpelledNote): string {
  return `${n.letter.toLowerCase()}${n.acc}/${n.octave}`;
}

/** Display name for a spelled note as written, e.g. "F♯4" */
export function spelledName(n: SpelledNote): string {
  const acc = n.acc === '#' ? '♯' : n.acc === 'b' ? '♭' : '';
  return `${n.letter}${acc}${n.octave}`;
}

const PC_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Display name for a raw MIDI number (sharp spelling), e.g. 61 -> "C♯4" */
export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${PC_NAMES[pc]}${octave}`;
}

export function freqToMidiFloat(hz: number, a4: number): number {
  return 69 + 12 * Math.log2(hz / a4);
}

export function midiToHz(midi: number, a4 = 440): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

// ---- Keys ----

export type KeyMode = 'major' | 'minor';

export interface Key {
  tonic: string; // e.g. 'C', 'F#', 'Bb'
  mode: KeyMode;
}

/** Order in which sharps are added to a key signature. */
const SHARP_ORDER: Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
/** Order in which flats are added (reverse of sharps). */
const FLAT_ORDER: Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Signed accidental count per major key: positive = sharps, negative = flats. */
const MAJOR_SIG_COUNT: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6,
};

/** Minor tonic -> relative major tonic (same key signature). */
const MINOR_TO_RELATIVE_MAJOR: Record<string, string> = {
  A: 'C', E: 'G', B: 'D', 'F#': 'A', 'C#': 'E', 'G#': 'B', 'D#': 'F#',
  D: 'F', G: 'Bb', C: 'Eb', F: 'Ab', Bb: 'Db', Eb: 'Gb',
};

export const MAJOR_TONICS = Object.keys(MAJOR_SIG_COUNT);
export const MINOR_TONICS = Object.keys(MINOR_TO_RELATIVE_MAJOR);

/** Signed accidental count for any key (major or minor via relative major). */
export function signatureCount(key: Key): number {
  const tonic = key.mode === 'major' ? key.tonic : MINOR_TO_RELATIVE_MAJOR[key.tonic];
  const count = MAJOR_SIG_COUNT[tonic];
  if (count === undefined) throw new Error(`Unknown key: ${key.tonic} ${key.mode}`);
  return count;
}

/** Map of letter -> accidental applied by the key signature, e.g. A major -> {F:'#',C:'#',G:'#'} */
export function keyAlterations(key: Key): Partial<Record<Letter, Acc>> {
  const count = signatureCount(key);
  const alterations: Partial<Record<Letter, Acc>> = {};
  if (count > 0) {
    for (const letter of SHARP_ORDER.slice(0, count)) alterations[letter] = '#';
  } else if (count < 0) {
    for (const letter of FLAT_ORDER.slice(0, -count)) alterations[letter] = 'b';
  }
  return alterations;
}

/** VexFlow key signature name: 'D', 'Bb', or minor as 'Em', 'C#m'. */
export function vexKeySignature(key: Key): string {
  return key.mode === 'minor' ? `${key.tonic}m` : key.tonic;
}

export function keyLabel(key: Key): string {
  const tonic = key.tonic.replace('#', '♯').replace('b', '♭');
  return `${tonic} ${key.mode}`;
}

/** Pitch class (0–11) of a key's tonic. */
export function tonicPitchClass(key: Key): number {
  const letter = key.tonic[0] as Letter;
  const acc = (key.tonic.slice(1) as Acc) || '';
  return (LETTER_SEMITONE[letter] + ACC_OFFSET[acc] + 12) % 12;
}
