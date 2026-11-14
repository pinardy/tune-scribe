// Plays the written score (so it can be checked by ear) and the original
// recording (so the two can be compared).

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

/** Sounds one short note in the score's voice: the answer to "what did that edit do?" */
export async function playTone(midi: number): Promise<void> {
  const audio = await audioContext();
  const t0 = audio.currentTime + 0.01;
  const osc = audio.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = midiToHz(midi);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.2, t0 + 0.012);
  gain.gain.setTargetAtTime(0, t0 + 0.22, 0.03);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + 0.4);
}

/**
 * Calls `onNote` whenever the note under the playhead changes, and `onEnd`
 * once when playback finishes or is stopped.
 */
function follow(
  audio: AudioContext,
  startTime: number,
  spans: { index: number; from: number; to: number }[],
  total: number,
  onNote: (eventIndex: number | null) => void,
  onEnd: () => void,
  teardown: () => void,
): Playback {
  let raf = 0;
  let current: number | null = null;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    teardown();
    onNote(null);
    onEnd();
  };
  const tick = () => {
    const t = audio.currentTime - startTime;
    if (t >= total) return finish();
    const span = spans.find((s) => t >= s.from && t < s.to);
    const index = span ? span.index : null;
    if (index !== current) {
      current = index;
      onNote(index);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { stop: finish };
}

/** Plays the score with a plain triangle-wave voice at the score's tempo. */
export async function playScore(
  score: Score,
  onNote: (eventIndex: number | null) => void,
  onEnd: () => void,
): Promise<Playback> {
  const audio = await audioContext();
  const unit = 60 / score.bpm / 4;
  const timeOf = (units: number) => (score.swing ? swungUnits(units) : units);
  const startTime = audio.currentTime + 0.08;
  const master = audio.createGain();
  master.gain.value = 0.22;
  master.connect(audio.destination);

  const oscillators: OscillatorNode[] = [];
  const spans: { index: number; from: number; to: number }[] = [];
  for (const note of performanceOf(score)) {
    const from = timeOf(note.startUnits) * unit;
    const length = timeOf(note.startUnits + note.lengthUnits) * unit - from;
    const sounding = Math.max(0.05, length - 0.02);
    const osc = audio.createOscillator();
    osc.type = 'triangle'; // a little warmer than a sine, still clearly pitched
    osc.frequency.value = midiToHz(note.midi);
    const gain = audio.createGain();
    const t0 = startTime + from;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(1, t0 + 0.012);
    gain.gain.setTargetAtTime(0.55, t0 + 0.012, 0.25);
    gain.gain.setTargetAtTime(0, t0 + sounding - 0.03, 0.012);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + sounding + 0.05);
    oscillators.push(osc);
    spans.push({ index: note.eventIndex, from, to: from + length });
  }
  const total = spans.length ? spans[spans.length - 1].to + 0.1 : 0;

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
  onEnd: () => void,
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
