// A click to record against. Beats are scheduled on the audio clock a little
// ahead of time, so they stay even when the page is busy.

import type { Meter } from '../transcribe/score';
import { audioContext } from './playback';

export interface Metronome {
  /** length of the count-in bar */
  countInSeconds: number;
  stop(): void;
}

/** how far ahead beats are handed to the audio clock */
const LOOKAHEAD = 0.12;

/**
 * Starts clicking on the felt beat (a dotted quarter in 6/8), the first of
 * each bar accented.
 *
 * @param bpm     quarter notes per minute
 * @param onBeat  called as each beat sounds, with the beat (0-based) and the bar; bar 0 is the count-in
 */
export async function startMetronome(
  bpm: number,
  meter: Meter,
  onBeat: (beat: number, bar: number) => void,
): Promise<Metronome> {
  const audio = await audioContext();
  const beatSeconds = (meter.beatUnits * 60) / bpm / 4;
  const beatsPerBar = meter.barUnits / meter.beatUnits;
  const master = audio.createGain();
  master.gain.value = 0.5;
  master.connect(audio.destination);

  const startTime = audio.currentTime + 0.1;
  const timeouts = new Set<number>();
  let next = 0;

  const schedule = () => {
    while (startTime + next * beatSeconds < audio.currentTime + LOOKAHEAD) {
      const n = next++;
      const at = startTime + n * beatSeconds;
      const beat = n % beatsPerBar;
      const osc = audio.createOscillator();
      osc.frequency.value = beat === 0 ? 1760 : 1175;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(beat === 0 ? 1 : 0.6, at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.045);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.06);
      const id = window.setTimeout(
        () => {
          timeouts.delete(id);
          onBeat(beat, Math.floor(n / beatsPerBar));
        },
        Math.max(0, (at - audio.currentTime) * 1000),
      );
      timeouts.add(id);
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 25);

  return {
    countInSeconds: 0.1 + beatsPerBar * beatSeconds,
    stop() {
      window.clearInterval(timer);
      for (const id of timeouts) window.clearTimeout(id);
      // beats already handed to the audio clock are silenced with the output
      master.disconnect();
    },
  };
}
