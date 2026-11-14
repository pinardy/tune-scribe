// Cutting a take down and adding one take to another: the sound, the pitch
// trace and the notes are cut or joined together, so they stay lined up.

import type { Analysis } from '../audio/analyse';
import type { StoredTake } from '../storage/library';
import type { NoteEvent } from './segment';

export interface Trimmed {
  take: StoredTake;
  /** a note's index in the trimmed take, or null if it was cut away */
  indexOf: (eventIndex: number) => number | null;
}

/** How long a take runs: its sound, or its last note where there is no sound. */
export function takeSeconds(take: StoredTake): number {
  const notes = take.heard.notes;
  return take.analysis?.track.duration ?? (notes.length ? notes[notes.length - 1].end : 0);
}

/**
 * Keeps the part of a take between `from` and `to` seconds. A note stays if
 * it begins there: one with its start cut off would come in at the wrong
 * moment, and throw the rhythm of everything after it.
 */
export function trimTake(take: StoredTake, from: number, to: number): Trimmed {
  const { analysis, heard } = take;
  // cut on the analysis's frame grid
  const hop = analysis?.track.hopSeconds ?? 0;
  const firstFrame = hop ? Math.max(0, Math.round(from / hop)) : 0;
  const start = hop ? firstFrame * hop : Math.max(0, from);
  const end = Math.min(to, takeSeconds(take));
  const lastFrame = hop ? Math.round(end / hop) : 0;

  const kept = new Map<number, number>();
  const notes: NoteEvent[] = [];
  heard.notes.forEach((note, index) => {
    if (note.start < start - 0.02 || note.start >= end) return;
    kept.set(index, notes.length);
    const cut: NoteEvent = { ...note, start: Math.max(0, note.start - start), end: Math.min(end, note.end) - start };
    // a take that now begins the tune is not an added one any more
    if (notes.length === 0) delete cut.section;
    notes.push(cut);
  });

  let trimmed: Analysis | null = null;
  if (analysis) {
    const { track, audio } = analysis;
    const pcm = audio.pcm.slice(Math.round(start * audio.sampleRate), Math.round(end * audio.sampleRate));
    trimmed = {
      audio: { pcm, sampleRate: audio.sampleRate },
      track: {
        ...track,
        duration: pcm.length / audio.sampleRate,
        midi: track.midi.slice(firstFrame, lastFrame),
        rms: track.rms.slice(firstFrame, lastFrame),
      },
    };
  }

  return {
    take: {
      ...take,
      analysis: trimmed,
      heard: { ...heard, notes, contour: heard.contour.slice(firstFrame, lastFrame) },
    },
    indexOf: (eventIndex) => kept.get(eventIndex) ?? null,
  };
}

/** `values` (one per frame of `from`) picked out again on the frame grid of `to`. */
function reframe(values: Float32Array, from: Analysis['track'], to: Analysis['track']): Float32Array {
  if (from.hopSeconds === to.hopSeconds && from.offsetSeconds === to.offsetSeconds) return values;
  const frames = Math.max(0, Math.round((from.duration - to.offsetSeconds) / to.hopSeconds));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const at = Math.round((to.offsetSeconds + i * to.hopSeconds - from.offsetSeconds) / from.hopSeconds);
    out[i] = values[Math.min(values.length - 1, Math.max(0, at))];
  }
  return out;
}

function resample(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return pcm;
  const out = new Float32Array(Math.round((pcm.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const at = (i * from) / to;
    const k = Math.floor(at);
    const next = Math.min(pcm.length - 1, k + 1);
    out[i] = pcm[k] + (pcm[next] - pcm[k]) * (at - k);
  }
  return out;
}

/** how much of the quiet before an added take's first note is kept */
const LEAD_IN_SECONDS = 0.3;

/**
 * `added` put on the end of `base`. Its first note is marked as beginning a
 * section, which is what puts it on a bar line when the tune is written.
 */
export function joinTakes(base: StoredTake, added: StoredTake): StoredTake {
  if (added.heard.notes.length === 0) return base;
  const next = trimTake(added, added.heard.notes[0].start - LEAD_IN_SECONDS, Infinity).take;

  let analysis: Analysis | null = null;
  let contour = new Float32Array(0);
  let seam = takeSeconds(base);
  if (base.analysis && next.analysis) {
    const { track, audio } = base.analysis;
    const rate = audio.sampleRate;
    // the seam goes on a frame boundary, so one grid of frames serves both takes
    const hopSamples = Math.round(track.hopSeconds * rate);
    const frames = Math.ceil(audio.pcm.length / hopSamples);
    seam = (frames * hopSamples) / rate;

    const more = resample(next.analysis.audio.pcm, next.analysis.audio.sampleRate, rate);
    const pcm = new Float32Array(frames * hopSamples + more.length);
    pcm.set(audio.pcm);
    pcm.set(more, frames * hopSamples);

    const joined = (first: Float32Array, second: Float32Array, empty: number) => {
      const out = new Float32Array(frames + second.length).fill(empty);
      out.set(first.subarray(0, frames));
      out.set(second, frames);
      return out;
    };
    const theirs = next.analysis.track;
    analysis = {
      audio: { pcm, sampleRate: rate },
      track: {
        ...track,
        duration: pcm.length / rate,
        midi: joined(track.midi, reframe(theirs.midi, theirs, track), NaN),
        rms: joined(track.rms, reframe(theirs.rms, theirs, track), 0),
      },
    };
    contour = joined(base.heard.contour, reframe(next.heard.contour, theirs, track), NaN);
  }

  const notes = [
    ...base.heard.notes,
    ...next.heard.notes.map((note, i): NoteEvent => ({
      ...note,
      start: note.start + seam,
      end: note.end + seam,
      ...(i === 0 && { section: true as const }),
    })),
  ];
  return {
    source: base.source,
    // one click tempo for the whole tune, or none
    clickBpm: base.clickBpm === added.clickBpm ? base.clickBpm : undefined,
    analysis,
    heard: { notes, tuningCents: base.heard.tuningCents, contour },
  };
}
