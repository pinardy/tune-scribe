import { describe, expect, it } from 'vitest';
import { DEMO_BPM, DEMO_MELODY, synthesiseDemo } from '../audio/demo';
import { decimateBy2, prepareForAnalysis, trackPitch } from '../audio/pitchTrack';
import { Yin } from '../audio/yin';
import { LevelWatch } from '../audio/levelWatch';
import { toMidi } from '../export/midi';
import { toMusicXml } from '../export/musicxml';
import { buildPdf } from '../export/pdf';
import { midiToHz, spelledName } from '../notation/theory';
import { withEdit } from './edits';
import { arrange } from './index';
import { estimateKey, spellInKey } from './key';
import { quantize } from './quantize';
import { METERS, buildScore, performance, splitSpan } from './score';
import { segmentNotes } from './segment';
import { DEFAULT_SETTINGS } from './settings';
import { estimateTempo } from './tempo';

function sine(hz: number, seconds: number, sampleRate: number, harmonics = [1]): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    for (let h = 0; h < harmonics.length; h++) {
      out[i] += 0.3 * harmonics[h] * Math.sin((2 * Math.PI * hz * (h + 1) * i) / sampleRate);
    }
  }
  return out;
}

describe('Yin', () => {
  it('finds the pitch of harmonic tones across the range without octave slips', () => {
    const yin = new Yin(22050);
    for (const midi of [36, 45, 57, 69, 81, 93]) {
      const hz = midiToHz(midi);
      const result = yin.detect(sine(hz, 0.2, 22050, [1, 0.6, 0.4, 0.2]));
      expect(Math.abs(1200 * Math.log2(result.hz / hz))).toBeLessThan(5);
    }
  });

  it('reports no pitch for noise', () => {
    const yin = new Yin(22050);
    let seed = 1;
    const noise = Float32Array.from({ length: 4096 }, () => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.5;
    });
    expect(yin.detect(noise).hz).toBe(-1);
  });
});

describe('decimateBy2', () => {
  it('keeps the pitch of a tone', () => {
    const half = decimateBy2(sine(440, 0.3, 44100));
    const yin = new Yin(22050);
    expect(Math.abs(yin.detect(half, 1000).hz - 440)).toBeLessThan(1);
  });
});

describe('estimateTempo', () => {
  it('reads steady quarters at 120', () => {
    const onsets = Array.from({ length: 12 }, (_, i) => i * 0.5);
    expect(estimateTempo(onsets).bpm).toBe(120);
  });

  it('reads a mix of eighths and quarters despite jitter', () => {
    // 96 BPM: eighth = 0.3125 s
    const pattern = [2, 1, 1, 2, 2, 1, 1, 2, 4, 1, 1, 2];
    const jitter = [0.012, -0.015, 0.008, -0.01, 0.014, -0.006, 0.01, -0.012, 0.005, 0.011, -0.009, 0.007];
    const onsets: number[] = [];
    let t = 0;
    pattern.forEach((eighths, i) => {
      onsets.push(t + jitter[i]);
      t += eighths * 0.3125;
    });
    const tempo = estimateTempo(onsets);
    expect(Math.abs(tempo.bpm - 96)).toBeLessThanOrEqual(2);
    expect(tempo.stepUnits).toBe(2);
  });
});

describe('quantize', () => {
  it('follows a player who gradually speeds up', () => {
    // sixteen quarter notes, each 1.5% shorter than the last
    const notes = [];
    let t = 0;
    let beat = 0.5;
    for (let i = 0; i < 16; i++) {
      notes.push({ start: t, end: t + beat * 0.9, midi: 60, cents: 0, level: 0.1 });
      t += beat;
      beat *= 0.985;
    }
    const q = quantize(notes, 0.125, 1);
    expect(q.map((n) => n.start)).toEqual(Array.from({ length: 16 }, (_, i) => i * 4));
  });

  it('writes a long silence as a rest and a short one as articulation', () => {
    const notes = [
      { start: 0, end: 0.4, midi: 60, cents: 0, level: 0.1 }, // detached quarter
      { start: 0.5, end: 0.75, midi: 62, cents: 0, level: 0.1 }, // eighth, then an eighth of silence
      { start: 1.0, end: 1.5, midi: 64, cents: 0, level: 0.1 },
    ];
    const q = quantize(notes, 0.125, 1);
    expect(q.map((n) => n.length)).toEqual([4, 2, 4]);
  });

  it('ends a note on the beat when it stopped near one', () => {
    // at 120 BPM: a note held for 7 sixteenths, then silence until the next bar
    const notes = [
      { start: 0, end: 0.875, midi: 60, cents: 0, level: 0.1 },
      { start: 2, end: 2.5, midi: 62, cents: 0, level: 0.1 },
    ];
    expect(quantize(notes, 0.125, 1)[0].length).toBe(8);
  });

  it('treats the early release of a long note as articulation', () => {
    // a whole note and a dotted half, each let go at 88% of their length, at 120 BPM
    const notes = [
      { start: 0, end: 1.76, midi: 60, cents: 0, level: 0.1 },
      { start: 2, end: 3.32, midi: 62, cents: 0, level: 0.1 },
    ];
    const q = quantize(notes, 0.125, 1);
    expect(q.map((n) => n.length)).toEqual([16, 12]);
  });
});

describe('splitSpan', () => {
  const four = METERS['4/4'];
  it('keeps simple values whole', () => {
    expect(splitSpan(0, 16, four, false)).toEqual([16]);
    expect(splitSpan(4, 6, four, false)).toEqual([6]);
    expect(splitSpan(2, 4, four, false)).toEqual([4]); // eighth–quarter–eighth
  });
  it('completes the beat before continuing', () => {
    expect(splitSpan(2, 6, four, false)).toEqual([2, 4]);
    expect(splitSpan(3, 5, four, false)).toEqual([1, 4]);
    expect(splitSpan(1, 3, four, false)).toEqual([3]);
  });
  it('never dots a rest', () => {
    expect(splitSpan(0, 6, four, true)).toEqual([4, 2]);
    expect(splitSpan(4, 12, four, true)).toEqual([4, 8]);
  });
  it('groups 6/8 in dotted quarters', () => {
    const six = METERS['6/8'];
    expect(splitSpan(0, 12, six, false)).toEqual([12]);
    expect(splitSpan(2, 8, six, false)).toEqual([4, 4]);
    expect(splitSpan(0, 8, six, false)).toEqual([6, 2]);
  });
});

describe('key and spelling', () => {
  it('spells chromatic notes by key', () => {
    const name = (midi: number, tonic: string, mode: 'major' | 'minor') =>
      spelledName(spellInKey(midi, { tonic, mode }));
    expect(name(66, 'D', 'major')).toBe('F♯4');
    expect(name(70, 'F', 'major')).toBe('B♭4');
    expect(name(66, 'G', 'minor')).toBe('F♯4'); // raised 7th keeps its letter
    expect(name(71, 'C', 'minor')).toBe('B4');
    expect(name(61, 'Eb', 'major')).toBe('D♭4');
    expect(name(59, 'Gb', 'major')).toBe('C♭4');
  });

  it('lets a chromatic passing note follow the direction of the line', () => {
    const cMinor = { tonic: 'C', mode: 'minor' } as const;
    expect(spelledName(spellInKey(66, cMinor, 67))).toBe('F♯4'); // rising to G
    expect(spelledName(spellInKey(66, cMinor, 65))).toBe('G♭4'); // falling to F
    expect(spelledName(spellInKey(63, cMinor, 64))).toBe('E♭4'); // a scale note stays as the key has it
  });

  it('finds the key of a scale-based tune', () => {
    const tune = [62, 64, 66, 67, 69, 71, 73, 74, 69, 66, 62].map((midi) => ({ midi, weight: 4 }));
    expect(estimateKey(tune)).toEqual({ tonic: 'D', mode: 'major' });
  });
});

describe('buildScore', () => {
  it('ties a note across the bar line and fills the last bar with rests', () => {
    const score = buildScore(
      [
        { eventIndex: 0, midi: 60, start: 0, length: 12 },
        { eventIndex: 1, midi: 62, start: 12, length: 8 },
      ],
      { tonic: 'C', mode: 'major' },
      METERS['4/4'],
      'treble',
      100,
    );
    expect(score.measures).toHaveLength(2);
    expect(score.measures[0].items.map((i) => [i.kind, i.units, !!i.tieToNext])).toEqual([
      ['note', 12, false],
      ['note', 4, true],
    ]);
    expect(score.measures[1].items.map((i) => [i.kind, i.units])).toEqual([
      ['note', 4],
      ['rest', 4],
      ['rest', 8],
    ]);
    for (const m of score.measures) expect(m.items.reduce((s, i) => s + i.units, 0)).toBe(16);
    expect(performance(score).map((n) => n.lengthUnits)).toEqual([12, 8]);
  });
});

describe('segmentNotes on a voice-like line', () => {
  it('hears slurred notes through vibrato, glides and background noise', () => {
    const rate = 22050;
    const melody = [60, 62, 64, 65, 67, 65, 64];
    const noteSeconds = 0.4;
    const glide = 0.04;
    const out = new Float32Array(Math.round((melody.length * noteSeconds + 0.4) * rate));
    let phase = 0;
    let seed = 7;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate - 0.2;
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647 - 0.5) * 0.02;
      if (t < 0 || t >= melody.length * noteSeconds) {
        out[i] = noise;
        continue;
      }
      const index = Math.floor(t / noteSeconds);
      const into = t - index * noteSeconds;
      // slide from the previous note over the first 40 ms, as a voice does
      const previous = melody[Math.max(0, index - 1)];
      const base = into < glide ? previous + (melody[index] - previous) * (into / glide) : melody[index];
      const vibrato = 0.3 * Math.sin(2 * Math.PI * 5.5 * t);
      phase += (2 * Math.PI * midiToHz(base + vibrato)) / rate;
      out[i] = 0.25 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase)) + noise;
    }
    const { notes } = segmentNotes(trackPitch(prepareForAnalysis(out, rate).pcm, rate));
    expect(notes.map((n) => n.midi)).toEqual(melody);
    // onsets land within 60 ms of each change (the glide itself takes 40)
    notes.forEach((n, i) => expect(Math.abs(n.start - (0.2 + i * noteSeconds))).toBeLessThan(0.06));
  });
});

describe('end to end: audio to score', () => {
  const pcm44 = synthesiseDemo(44100);
  const prepared = prepareForAnalysis(pcm44, 44100);
  const track = trackPitch(prepared.pcm, prepared.sampleRate);
  const { notes, tuningCents } = segmentNotes(track);
  const { score, detected } = arrange(notes, DEFAULT_SETTINGS);

  it('hears every note, including the repeated ones', () => {
    expect(notes.map((n) => n.midi)).toEqual(DEMO_MELODY.map(([midi]) => midi));
    expect(Math.abs(tuningCents)).toBeLessThanOrEqual(3);
  });

  it('finds the tempo and key', () => {
    expect(Math.abs(detected.bpm - DEMO_BPM)).toBeLessThanOrEqual(2);
    expect(detected.key).toEqual({ tonic: 'D', mode: 'major' });
  });

  it('writes the rhythm that was played', () => {
    const played = performance(score);
    expect(played.map((n) => n.midi)).toEqual(DEMO_MELODY.map(([midi]) => midi));
    expect(played.map((n) => n.lengthUnits)).toEqual(DEMO_MELODY.map(([, units]) => units));
    expect(score.measures).toHaveLength(8);
  });

  it('is not thrown by a recording tuned 30 cents flat', () => {
    const flat = synthesiseDemo(22050).map((v) => v); // same tune…
    // …resampled by reading it at a slightly lower rate: every pitch drops ~30 cents
    const rate = 22050 * 2 ** (-30 / 1200);
    const seg = segmentNotes(trackPitch(prepareForAnalysis(flat, rate).pcm, rate));
    expect(seg.notes.map((n) => n.midi)).toEqual(DEMO_MELODY.map(([midi]) => midi));
    expect(Math.abs(seg.tuningCents + 30)).toBeLessThanOrEqual(4);
  });

  it('exports well-formed MusicXML and MIDI', () => {
    const xml = toMusicXml(score, 'Test & <tune>');
    expect(xml).toContain('<work-title>Test &amp; &lt;tune&gt;</work-title>');
    expect(xml.match(/<measure /g)).toHaveLength(8);
    expect(xml).toContain('<fifths>2</fifths>');
    // every bar adds up to four quarters
    for (const bar of xml.split('<measure ').slice(1)) {
      const total = [...bar.matchAll(/<duration>(\d+)<\/duration>/g)].reduce((s, m) => s + Number(m[1]), 0);
      expect(total).toBe(48); // 12 divisions to the quarter
    }

    const midi = toMidi(score, 'Test');
    expect(String.fromCharCode(...midi.slice(0, 4))).toBe('MThd');
    const trackLength = new DataView(midi.buffer).getUint32(18);
    expect(midi.length).toBe(22 + trackLength);
    expect([...midi.slice(-3)]).toEqual([0xff, 0x2f, 0x00]);
  });

  it('applies corrections to single notes and keeps them when the settings change', () => {
    const tune = DEMO_MELODY.map(([midi]) => midi);
    const lengths = DEMO_MELODY.map(([, units]) => units);
    // third note up a semitone, fifth a step longer, last one removed
    let edits = withEdit({}, 2, (e) => ({ ...e, semitones: 1 }));
    edits = withEdit(edits, 4, (e) => ({ ...e, steps: 1 }));
    edits = withEdit(edits, tune.length - 1, (e) => ({ ...e, removed: true }));
    const edited = arrange(notes, DEFAULT_SETTINGS, { edits });
    const played = performance(edited.score);
    expect(played.map((n) => n.midi)).toEqual(tune.slice(0, -1).map((m, i) => (i === 2 ? m + 1 : m)));
    expect(played[4].lengthUnits).toBe(lengths[4] + edited.stepUnits);
    // the longer note pushes the ones after it along
    const plain = performance(score);
    expect(played[5].startUnits).toBe(plain[5].startUnits + edited.stepUnits);
    expect(played.map((n) => n.eventIndex)).toEqual(tune.slice(0, -1).map((_, i) => i));

    const inThree = arrange(notes, { ...DEFAULT_SETTINGS, timeSignature: '3/4' }, { edits });
    expect(performance(inThree.score).map((n) => n.midi)).toEqual(played.map((n) => n.midi));

    // an edit undone leaves nothing behind
    expect(withEdit(withEdit({}, 2, (e) => ({ ...e, semitones: 1 })), 2, (e) => ({ ...e, semitones: 0 }))).toEqual({});
  });

  it('transposes the written notes and the key with them', () => {
    const up = arrange(notes, { ...DEFAULT_SETTINGS, transpose: 2 });
    expect(performance(up.score).map((n) => n.midi)).toEqual(DEMO_MELODY.map(([midi]) => midi + 2));
    expect(up.score.key).toEqual({ tonic: 'E', mode: 'major' });
  });

  it('takes the tempo from the click a take was recorded to', () => {
    const clicked = arrange(notes, DEFAULT_SETTINGS, { clickBpm: DEMO_BPM });
    expect(clicked.detected).toMatchObject({ bpm: DEMO_BPM, tempoConfidence: 1 });
    expect(performance(clicked.score).map((n) => n.lengthUnits)).toEqual(DEMO_MELODY.map(([, units]) => units));
    // a set tempo still wins
    expect(arrange(notes, { ...DEFAULT_SETTINGS, tempo: 60 }, { clickBpm: DEMO_BPM }).score.bpm).toBe(60);
  });
});

describe('swing and triplets', () => {
  const BEAT = 0.6; // 100 bpm
  /** notes from [MIDI pitch, length in beats], played legato from time 0.2 */
  const play = (tune: [number, number][]) => {
    let t = 0.2;
    return tune.map(([midi, beats]) => {
      const note = { start: t, end: t + beats * BEAT * 0.9, midi, cents: 0, level: 0.1 };
      t += beats * BEAT;
      return note;
    });
  };
  const at100 = { ...DEFAULT_SETTINGS, tempo: 100 };

  it('writes a beat cut in three as a triplet', () => {
    const third = 1 / 3;
    const heard = play([[60, 1], [62, 1], [64, third], [65, third], [67, third], [72, 1], [71, 2 * third], [69, third], [67, 3]]);
    const { score } = arrange(heard, { ...at100, feel: 'triplets' }, { edits: {} });
    expect(performance(score).map((n) => Math.round(n.lengthUnits * 3))).toEqual([12, 12, 4, 4, 4, 12, 8, 4, 36]);
    const items = score.measures.flatMap((m) => m.items);
    expect(items.filter((i) => i.tuplet).map((i) => i.duration)).toEqual(['8', '8', '8', 'q', '8']);
    // bars still add up
    for (const measure of score.measures) {
      expect(measure.items.reduce((sum, i) => sum + i.units, 0)).toBeCloseTo(16, 6);
    }

    const xml = toMusicXml(score, 'Triplets');
    expect(xml.match(/<tuplet type="start"\/>/g)).toHaveLength(2);
    expect(xml.match(/<tuplet type="stop"\/>/g)).toHaveLength(2);
    for (const bar of xml.split('<measure ').slice(1)) {
      const total = [...bar.matchAll(/<duration>(\d+)<\/duration>/g)].reduce((sum, m) => sum + Number(m[1]), 0);
      expect(total).toBe(48);
    }
    // the same playing without triplets allowed comes out in straight values
    expect(arrange(heard, at100).score.measures.flatMap((m) => m.items).some((i) => i.tuplet)).toBe(false);
  });

  it('writes swung eighths as even eighths, and plays them back swung', () => {
    const long = 2 / 3;
    const short = 1 / 3;
    const heard = play([[60, long], [62, short], [64, long], [65, short], [67, 1], [65, long], [64, short], [62, 1], [60, 2]]);
    const { score } = arrange(heard, { ...at100, feel: 'swing' });
    expect(score.swing).toBe(true);
    expect(performance(score).map((n) => n.lengthUnits)).toEqual([2, 2, 2, 2, 4, 2, 2, 4, 8]);
    expect(toMusicXml(score, 'Swing')).toContain('<words>Swing</words>');

    // in the MIDI file the off-beat eighths sound two thirds of the way through the beat (480 ticks)
    const midi = toMidi(score, 'Swing');
    const noteOns: number[] = [];
    let at = 22;
    let ticks = 0;
    while (at < midi.length) {
      let delta = 0;
      do delta = (delta << 7) | (midi[at] & 0x7f);
      while (midi[at++] & 0x80);
      ticks += delta;
      if (midi[at] === 0xff) {
        at += 3 + midi[at + 2]; // meta: type, length, data
      } else {
        if (midi[at] === 0x90) noteOns.push(ticks);
        at += 3;
      }
    }
    expect(noteOns.slice(0, 5)).toEqual([0, 320, 480, 800, 960]);
  });

  it('leaves the detected tempo of the demo alone when triplets are allowed', () => {
    const pcm = synthesiseDemo(22050);
    const { notes } = segmentNotes(trackPitch(pcm, 22050));
    const { score } = arrange(notes, { ...DEFAULT_SETTINGS, feel: 'triplets' });
    expect(performance(score).map((n) => n.lengthUnits)).toEqual(DEMO_MELODY.map(([, units]) => units));
  });
});

describe('LevelWatch', () => {
  const run = (seconds: number, frame: (t: number) => [rms: number, peak: number, pitched: boolean]) => {
    const watch = new LevelWatch();
    for (let t = 0; t <= seconds; t += 0.02) watch.push(t, ...frame(t));
    return watch.advice();
  };

  it('says nothing about a healthy take, or before it has heard enough', () => {
    expect(run(5, () => [0.08, 0.3, true])).toBeNull();
    expect(run(1, () => [0.001, 0.002, false])).toBeNull();
  });

  it('notices a take that is too quiet, too loud or without a pitch', () => {
    expect(run(5, () => [0.004, 0.01, true])).toBe('quiet');
    expect(run(5, (t) => [0.3, t > 4 ? 1 : 0.6, true])).toBe('loud');
    expect(run(5, () => [0.06, 0.2, false])).toBe('noisy');
    // breaths between phrases are not noise
    expect(run(5, (t) => (t % 1 < 0.7 ? [0.08, 0.3, true] : [0.03, 0.1, false]))).toBeNull();
  });
});

describe('PDF export', () => {
  it('writes a file whose cross-reference table points at its objects', async () => {
    const page = { width: 4, height: 2, pixels: Uint8Array.from([0, 255, 0, 255, 255, 0, 255, 0]) };
    const pdf = await buildPdf([page, page], 'Täst (tune)');
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/FlateDecode');

    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(9); // catalog, page tree, info, and three per page
    offsets.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});
