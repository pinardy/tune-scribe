// Plays the written score (so it can be checked by ear) and the original
// recording (so the two can be compared). The score's voice is a small
// synthesised piano: a struck, decaying tone tells repeated notes apart and
// is easier on the ear than a bare oscillator, with no samples to download.

import { midiToHz } from '../notation/theory';
import { swungUnits } from '../transcribe/feel';
import type { Score } from '../transcribe/score';
import { performance as performanceOf } from '../transcribe/score';
import type { NoteEvent } from '../transcribe/segment';
import type { Recording } from './capture';

export interface Playback {
  stop(): void;
}

let ctx: AudioContext | null = null;

/** The one output context, started (it must first be asked for from a tap or a key press). */
export async function audioContext(): Promise<AudioContext> {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

/** Strength of each harmonic of the piano voice, fundamental first. */
const PARTIALS = [1, 0.55, 0.3, 0.22, 0.12, 0.08, 0.05, 0.03, 0.02, 0.012];
let pianoWave: { audio: AudioContext; wave: PeriodicWave } | null = null;

/**
 * One struck note: two slightly detuned strings through a filter that closes
 * as the note rings, dying away faster the higher it is, damped at `t0 + held`.
 * Returns the oscillators, so the note can be cut short.
 */
function strike(audio: AudioContext, output: AudioNode, midi: number, t0: number, held: number): OscillatorNode[] {
  if (pianoWave?.audio !== audio) {
    const wave = audio.createPeriodicWave(new Float32Array(PARTIALS.length + 1), new Float32Array([0, ...PARTIALS]));
    pianoWave = { audio, wave };
  }
  const hz = midiToHz(midi);
  const ring = Math.min(2.2, Math.max(0.35, 1.5 * 2 ** ((60 - midi) / 24)));

  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(12000, hz * 8), t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(500, hz * 2.5), t0 + 0.5);

  const gain = audio.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(1, t0 + 0.004);
  gain.gain.setTargetAtTime(0, t0 + 0.004, ring);
  gain.gain.setTargetAtTime(0, t0 + held, 0.05); // the damper
  filter.connect(gain).connect(output);

  return [-3, 3].map((cents) => {
    const osc = audio.createOscillator();
    osc.setPeriodicWave(pianoWave!.wave);
    osc.frequency.value = hz;
    osc.detune.value = cents;
    osc.connect(filter);
    osc.start(t0);
    osc.stop(t0 + held + 0.4);
    return osc;
  });
}

/** A metronome tick at `at`; the first beat of the bar is the higher one. */
function tick(audio: AudioContext, output: AudioNode, at: number, downbeat: boolean): OscillatorNode {
  const osc = audio.createOscillator();
  osc.frequency.value = downbeat ? 1760 : 1175;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(downbeat ? 0.5 : 0.3, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.045);
  osc.connect(gain).connect(output);
  osc.start(at);
  osc.stop(at + 0.06);
  return osc;
}

/** Sounds one short note in the score's voice: the answer to "what did that edit do?" */
export async function playTone(midi: number): Promise<void> {
  const audio = await audioContext();
  const output = audio.createGain();
  output.gain.value = 0.3;
  output.connect(audio.destination);
  strike(audio, output, midi, audio.currentTime + 0.01, 0.3);
}

/**
 * Calls `onNote` whenever the note under the playhead changes, and `onEnd`
 * once when playback finishes (with true) or is stopped (with false).
 */
function follow(
  audio: AudioContext,
  startTime: number,
  spans: { index: number; from: number; to: number }[],
  total: number,
  onNote: (eventIndex: number | null) => void,
  onEnd: (finished: boolean) => void,
  teardown: () => void,
): Playback {
  let raf = 0;
  let current: number | null = null;
  let done = false;
  const finish = (finished: boolean) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    teardown();
    onNote(null);
    onEnd(finished);
  };
  const tick = () => {
    const t = audio.currentTime - startTime;
    if (t >= total) return finish(true);
    const span = spans.find((s) => t >= s.from && t < s.to);
    const index = span ? span.index : null;
    if (index !== current) {
      current = index;
      onNote(index);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { stop: () => finish(false) };
}

export interface ScorePlayOptions {
  /** 1 = the score's tempo, 0.5 = half speed */
  speed?: number;
  /** a metronome click on every beat */
  click?: boolean;
}

/** Plays the score in the piano voice, at the score's tempo times `speed`. */
export async function playScore(
  score: Score,
  onNote: (eventIndex: number | null) => void,
  onEnd: (finished: boolean) => void,
  { speed = 1, click = false }: ScorePlayOptions = {},
): Promise<Playback> {
  const audio = await audioContext();
  const unit = 60 / score.bpm / 4 / speed;
  const timeOf = (units: number) => (score.swing ? swungUnits(units) : units);
  const startTime = audio.currentTime + 0.08;
  const master = audio.createGain();
  master.gain.value = 0.3;
  master.connect(audio.destination);

  const oscillators: OscillatorNode[] = [];
  const spans: { index: number; from: number; to: number }[] = [];
  for (const note of performanceOf(score)) {
    const from = timeOf(note.startUnits) * unit;
    const length = timeOf(note.startUnits + note.lengthUnits) * unit - from;
    oscillators.push(...strike(audio, master, note.midi, startTime + from, Math.max(0.05, length - 0.02)));
    spans.push({ index: note.eventIndex, from, to: from + length });
  }
  const total = spans.length ? spans[spans.length - 1].to + 0.1 : 0;

  if (click) {
    const { beatUnits, barUnits } = score.meter;
    const bars = score.measures.length * barUnits;
    for (let at = 0; at < bars; at += beatUnits) {
      oscillators.push(tick(audio, master, startTime + at * unit, at % barUnits === 0));
    }
  }

  return follow(audio, startTime, spans, total, onNote, onEnd, () => {
    for (const osc of oscillators) {
      try {
        osc.stop();
      } catch {
        // already ended
      }
    }
    master.disconnect();
  });
}

/** Plays the analysed recording, reporting which detected note is sounding. */
export async function playRecording(
  recording: Recording,
  notes: NoteEvent[],
  onNote: (eventIndex: number | null) => void,
  onEnd: (finished: boolean) => void,
): Promise<Playback> {
  const audio = await audioContext();
  const buffer = audio.createBuffer(1, recording.pcm.length, recording.sampleRate);
  buffer.getChannelData(0).set(recording.pcm);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  const startTime = audio.currentTime + 0.08;
  source.start(startTime);

  const spans = notes.map((n, index) => ({ index, from: n.start, to: n.end }));
  return follow(audio, startTime, spans, buffer.duration, onNote, onEnd, () => {
    try {
      source.stop();
    } catch {
      // already ended
    }
    source.disconnect();
  });
}
