// Finds the pulse of a performance from the gaps between note onsets.
//
// Internally everything is counted in sixteenth notes ("units"). The tempo
// is therefore just the length of one unit in seconds, plus how coarse the
// performance's own rhythm grid is (sixteenths, eighths or quarters).

export interface TempoEstimate {
  /** quarter notes per minute */
  bpm: number;
  /** seconds per sixteenth note */
  unitSeconds: number;
  /** shortest step the rhythm actually uses, in units: 1 = 16th, 2 = 8th, 4 = quarter */
  stepUnits: 1 | 2 | 4;
  /** 0…1: how well the onsets agree with one steady grid */
  confidence: number;
}

export const DEFAULT_BPM = 100;
/** With no other evidence, tunes are more often near this tempo than at half or double it. */
const TYPICAL_BPM = 105;

export function unitSecondsForBpm(bpm: number): number {
  return 60 / bpm / 4;
}

function fallback(): TempoEstimate {
  return { bpm: DEFAULT_BPM, unitSeconds: unitSecondsForBpm(DEFAULT_BPM), stepUnits: 1, confidence: 0 };
}

/**
 * Looks for the longest step that every inter-onset interval is a whole
 * multiple of. For a candidate step q, each interval is wrapped onto a circle
 * of circumference q; if the intervals are multiples of q they all land at
 * the same point and the mean cosine is near 1. Half of the right step also
 * fits, but timing jitter costs it more, so the maximum sits on the right one.
 *
 * @param thirds  the beat may be cut in three (swing, triplets), so the step may be a third of it
 * @param breaks  true for each onset that begins a take added later: the wait before it is not rhythm
 */
export function estimateTempo(onsets: number[], thirds = false, breaks: boolean[] = []): TempoEstimate {
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    if (breaks[i]) continue;
    const ioi = onsets[i] - onsets[i - 1];
    // long pauses say little about the pulse and drift too far to be trusted
    if (ioi > 0.05 && ioi < 2.5) intervals.push(ioi);
  }
  if (intervals.length < 3) return fallback();

  let bestQ = 0;
  let bestScore = -Infinity;
  // From the longest step down, and a shorter one has to fit clearly better to
  // win: playing in perfect time (a sequencer's) fits every division of the
  // right step equally well, and the right one is the longest of them.
  for (let q = 0.75; q >= 0.09; q /= 1.004) {
    let sum = 0;
    for (const ioi of intervals) sum += Math.cos((2 * Math.PI * ioi) / q);
    const score = sum / intervals.length;
    if (score > bestScore + 0.002) {
      bestScore = score;
      bestQ = q;
    }
  }
  if (bestScore < 0.25) return fallback();

  // least-squares refinement: the step that best explains the whole-number multiples
  let num = 0;
  let den = 0;
  for (const ioi of intervals) {
    const steps = Math.max(1, Math.round(ioi / bestQ));
    num += ioi * steps;
    den += steps * steps;
  }
  const q = num / den;

  // The step could be a quarter, an eighth or a sixteenth; pick the reading
  // whose tempo is the most ordinary.
  // (with swing or triplets about, it could also be a third or a sixth of the beat)
  let best: { perQuarter: number; bpm: number; distance: number } | null = null;
  for (const perQuarter of thirds ? [1, 2, 3, 4, 6] : [1, 2, 4]) {
    const bpm = 60 / (q * perQuarter);
    const distance = Math.abs(Math.log2(bpm / TYPICAL_BPM));
    if (!best || distance < best.distance) best = { perQuarter, bpm, distance };
  }
  const { perQuarter, bpm } = best!;
  return {
    bpm: Math.round(bpm),
    unitSeconds: (q * perQuarter) / 4,
    stepUnits: (perQuarter === 1 ? 4 : perQuarter === 4 || perQuarter === 6 ? 1 : 2) as 1 | 2 | 4,
    confidence: Math.max(0, Math.min(1, bestScore)),
  };
}
