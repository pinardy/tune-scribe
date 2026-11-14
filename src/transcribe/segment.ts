// Pitch contour -> discrete notes. Works on what was physically played
// (seconds and semitones); rhythm and spelling come later.

import type { PitchTrack } from '../audio/pitchTrack';

export interface NoteEvent {
  /** seconds from the start of the audio */
  start: number;
  end: number;
  /** nearest semitone, after correcting for the recording's overall tuning */
  midi: number;
  /** how far the note sat from that semitone, -50…+50 */
  cents: number;
  /** mean RMS level */
  level: number;
  /** the first note of a take added to the tune later: it is written from a bar line */
  section?: true;
}

export interface Segmentation {
  notes: NoteEvent[];
  /** how sharp (+) or flat (-) the whole recording sits against A4 = 440 Hz */
  tuningCents: number;
  /** the tuning-corrected contour, NaN where unvoiced; one value per track frame */
  contour: Float32Array;
}

/** A frame joins the current note while it stays this close to the note's centre. */
const PITCH_TOLERANCE = 0.7;
/** Consecutive off-pitch frames (that agree with each other) needed to start a new note. */
const SWITCH_FRAMES = 3;
/** Unvoiced frames tolerated inside a note before it ends. */
const GAP_FRAMES = 2;
/** Anything shorter is a scoop, a glide or a glitch rather than a note. */
const MIN_NOTE_SECONDS = 0.07;
/** Same-pitch notes closer together than this were split by a wobble, not a new attack. */
const MERGE_GAP_SECONDS = 0.04;

interface Run {
  /** first frame, and one past the last */
  from: number;
  to: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * How far the recording sits from concert pitch, in semitones (-0.5…0.5).
 * Each frame's distance from its nearest semitone is treated as an angle; if
 * they cluster, the mean angle is the offset. A guitar tuned a little flat or
 * a singer who drifts sharp then still lands on the intended notes.
 */
function tuningOffset(midi: Float32Array, voiced: Uint8Array): number {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = 0; i < midi.length; i++) {
    if (!voiced[i]) continue;
    const angle = 2 * Math.PI * (midi[i] - Math.round(midi[i]));
    x += Math.cos(angle);
    y += Math.sin(angle);
    n++;
  }
  if (n < 20) return 0;
  // weak clustering means slides and noise, not a tuning
  if (Math.hypot(x, y) / n < 0.3) return 0;
  return Math.atan2(y, x) / (2 * Math.PI);
}

/** 5-frame median that ignores unvoiced neighbours; removes single-frame octave slips. */
function smooth(midi: Float32Array, voiced: Uint8Array): Float32Array {
  const out = new Float32Array(midi.length).fill(NaN);
  const window: number[] = [];
  for (let i = 0; i < midi.length; i++) {
    if (!voiced[i]) continue;
    window.length = 0;
    for (let k = i - 2; k <= i + 2; k++) {
      if (k >= 0 && k < midi.length && voiced[k]) window.push(midi[k]);
    }
    out[i] = median(window);
  }
  return out;
}

/** Splits the contour wherever the pitch settles somewhere new or the sound stops. */
function findRuns(contour: Float32Array): Run[] {
  const runs: Run[] = [];
  let from = -1;
  let sum = 0;
  let count = 0;
  let lastVoiced = -1;
  let pending: number[] = [];

  const close = (to: number) => {
    if (from >= 0 && to > from) runs.push({ from, to });
    from = -1;
    sum = 0;
    count = 0;
    pending = [];
  };
  const open = (frames: number[]) => {
    from = frames[0];
    sum = 0;
    count = 0;
    for (const f of frames) {
      sum += contour[f];
      count++;
    }
    lastVoiced = frames[frames.length - 1];
    pending = [];
  };

  for (let i = 0; i < contour.length; i++) {
    const m = contour[i];
    if (Number.isNaN(m)) {
      if (from >= 0 && i - lastVoiced > GAP_FRAMES) close(lastVoiced + 1);
      continue;
    }
    if (from < 0) {
      open([i]);
      continue;
    }
    if (Math.abs(m - sum / count) <= PITCH_TOLERANCE) {
      // stray frames between two on-pitch ones were a blip: keep the note going
      sum += m;
      count++;
      lastVoiced = i;
      pending = [];
      continue;
    }
    pending.push(i);
    if (pending.length >= SWITCH_FRAMES) {
      const recent = pending.slice(-SWITCH_FRAMES);
      const values = recent.map((f) => contour[f]);
      if (Math.max(...values) - Math.min(...values) <= PITCH_TOLERANCE) {
        // the pitch has settled somewhere new; a glide in between belongs to neither note
        close(pending[0]);
        open(recent);
      }
    }
  }
  close(lastVoiced + 1);
  return runs;
}

/**
 * Finds re-attacks inside one run: the same pitch struck, tongued or bowed
 * again. The level dips and then climbs back by a clear margin, which a
 * vibrato or a slow swell does not do.
 */
function splitAtAttacks(run: Run, rms: Float32Array, minFrames: number): Run[] {
  const pieces: Run[] = [];
  let from = run.from;
  let peak = 0;
  for (let i = run.from; i < run.to; i++) {
    peak = Math.max(peak, rms[i]);
    if (i - from < minFrames || run.to - i < minFrames) continue;
    // a local minimum over ±3 frames
    let isMin = true;
    for (let k = Math.max(from, i - 3); k <= Math.min(run.to - 1, i + 3); k++) {
      if (rms[k] < rms[i]) {
        isMin = false;
        break;
      }
    }
    if (!isMin) continue;
    let ahead = 0;
    for (let k = i + 1; k <= Math.min(run.to - 1, i + 8); k++) ahead = Math.max(ahead, rms[k]);
    if (rms[i] < 0.6 * ahead && rms[i] < 0.75 * peak) {
      pieces.push({ from, to: i });
      from = i;
      peak = rms[i];
    }
  }
  pieces.push({ from, to: run.to });
  return pieces;
}

export function segmentNotes(track: PitchTrack): Segmentation {
  const { midi, rms, hopSeconds, offsetSeconds } = track;
  const frames = midi.length;
  const minFrames = Math.max(2, Math.round(MIN_NOTE_SECONDS / hopSeconds));

  // gate on level relative to the loud parts, so room noise and the tail of a
  // decaying note do not turn into notes of their own
  const pitchedLevels: number[] = [];
  for (let i = 0; i < frames; i++) if (!Number.isNaN(midi[i])) pitchedLevels.push(rms[i]);
  const gate = Math.max(0.003, percentile(pitchedLevels, 0.9) * 0.06);
  const voiced = new Uint8Array(frames);
  for (let i = 0; i < frames; i++) voiced[i] = !Number.isNaN(midi[i]) && rms[i] >= gate ? 1 : 0;

  const offset = tuningOffset(midi, voiced);
  const contour = smooth(midi, voiced);
  for (let i = 0; i < frames; i++) contour[i] -= offset;

  const centre = (run: Run): number => {
    const values: number[] = [];
    for (let i = run.from; i < run.to; i++) if (!Number.isNaN(contour[i])) values.push(contour[i]);
    return values.length ? median(values) : NaN;
  };

  // 1. raw runs; a too-short run that leads straight into the next one is a
  //    scoop into that note, so the note inherits its start time
  const raw = findRuns(contour);
  const runs: Run[] = [];
  let carriedStart = -1;
  for (let r = 0; r < raw.length; r++) {
    const run = raw[r];
    const next = raw[r + 1];
    const from = carriedStart >= 0 ? carriedStart : run.from;
    carriedStart = -1;
    if (run.to - run.from < minFrames) {
      if (next && next.from - run.to <= GAP_FRAMES) carriedStart = from;
      continue;
    }
    runs.push({ from, to: run.to });
  }

  // 2. rejoin same-pitch neighbours that a wobble pulled apart
  const mergeGap = Math.round(MERGE_GAP_SECONDS / hopSeconds);
  const merged: Run[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run.from - prev.to <= mergeGap && Math.round(centre(prev)) === Math.round(centre(run))) {
      prev.to = run.to;
    } else {
      merged.push({ ...run });
    }
  }

  // 3. split repeated notes at their attacks
  const pieces = merged.flatMap((run) => splitAtAttacks(run, rms, minFrames));

  const time = (frame: number) => Math.max(0, offsetSeconds + frame * hopSeconds - hopSeconds / 2);
  const notes: NoteEvent[] = [];
  for (const piece of pieces) {
    if (piece.to - piece.from < minFrames) continue;
    const pitch = centre(piece);
    if (Number.isNaN(pitch)) continue;
    const nearest = Math.round(pitch);
    let level = 0;
    for (let i = piece.from; i < piece.to; i++) level += rms[i];
    notes.push({
      start: time(piece.from),
      end: time(piece.to),
      midi: nearest,
      cents: Math.round((pitch - nearest) * 100),
      level: level / (piece.to - piece.from),
    });
  }

  return { notes, tuningCents: Math.round(offset * 100), contour };
}
