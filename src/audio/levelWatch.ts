// Watches the microphone level while recording and says, in time to do
// something about it, when the take is heading for a poor transcription.

export type InputAdvice = 'quiet' | 'loud' | 'noisy' | null;

/** seconds of input the advice is based on */
const WINDOW = 3;
/** a sample this close to full scale has clipped */
const CLIP_PEAK = 0.98;
/** how long the "too loud" advice stays up after a clip */
const CLIP_HOLD = 2.5;
/** the loudest moment of a usable take is at least this level (RMS) */
const QUIET_RMS = 0.015;
/** sound at this level ought to have a pitch if it is the tune */
const PRESENT_RMS = 0.02;

interface Reading {
  time: number;
  rms: number;
  pitched: boolean;
}

export class LevelWatch {
  private readings: Reading[] = [];
  private first = -1;
  private clippedAt = -Infinity;

  /**
   * @param time     seconds, on any steadily advancing clock
   * @param peak     largest absolute sample in the frame
   * @param pitched  whether a pitch was found in the frame
   */
  push(time: number, rms: number, peak: number, pitched: boolean): void {
    if (this.first < 0) this.first = time;
    if (peak >= CLIP_PEAK) this.clippedAt = time;
    this.readings.push({ time, rms, pitched });
    while (this.readings.length && time - this.readings[0].time > WINDOW) this.readings.shift();
  }

  advice(): InputAdvice {
    const last = this.readings[this.readings.length - 1];
    if (!last) return null;
    if (last.time - this.clippedAt <= CLIP_HOLD) return 'loud';
    // say nothing about the level until there is a window's worth to judge
    if (last.time - this.first < WINDOW) return null;

    let loudest = 0;
    let present = 0;
    let unpitched = 0;
    for (const r of this.readings) {
      if (r.rms > loudest) loudest = r.rms;
      if (r.rms >= PRESENT_RMS) {
        present++;
        if (!r.pitched) unpitched++;
      }
    }
    if (loudest < QUIET_RMS) return 'quiet';
    // mostly sound, and mostly without a pitch: noise, a chord, a crowd
    if (present >= this.readings.length * 0.6 && unpitched >= present * 0.7) return 'noisy';
    return null;
  }
}

export const ADVICE_TEXT: Record<Exclude<InputAdvice, null>, string> = {
  quiet: 'Very quiet. Move closer to the microphone, or sing out.',
  loud: 'Too loud: the sound is distorting. Back away a little.',
  noisy: 'Sound, but no clear pitch. Cut the background noise and keep to one note at a time.',
};
