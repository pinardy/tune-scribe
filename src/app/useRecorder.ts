// A take from the microphone, from the tap on record to the audio handed
// over: the live pitch readout and trace, the click and its count-in, and the
// advice about the input level.

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { startRecording, type Recorder, type Recording } from '../audio/capture';
import { MAX_SECONDS } from '../audio/decode';
import { LevelWatch, type InputAdvice } from '../audio/levelWatch';
import { startMetronome, type Metronome } from '../audio/metronome';
import { audioContext } from '../audio/playback';
import { Yin } from '../audio/yin';
import type { ClickSettings } from '../components/ClickControl';
import { LIVE_WINDOW, type LiveTrace } from '../components/PitchRoll';
import type { Meter } from '../transcribe/score';
import { useWakeLock } from '../hooks/useWakeLock';

/** A take shorter than this cannot hold a tune. */
const MIN_TAKE_SECONDS = 0.6;

interface Options {
  click: ClickSettings;
  /** the time signature in force: how many clicks a bar of count-in has */
  meter: Meter;
  /** recording is about to begin: clear old messages, stop anything playing */
  onStart: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** the finished take, and the tempo of the click it was recorded to, if any */
  onTake: (audio: Recording, clickBpm?: number) => Promise<void> | void;
}

export interface RecorderState {
  recording: boolean;
  /** the pitch trace of the last few seconds, for the roll to draw */
  live: MutableRefObject<LiveTrace>;
  /** seconds recorded, not counting the count-in */
  elapsed: number;
  /** the note being heard right now */
  hearing: { midi: number; cents: number } | null;
  advice: InputAdvice;
  /** beats of count-in still to come; null once the take proper has begun */
  countIn: number | null;
  begin: () => Promise<void>;
  finish: () => Promise<void>;
}

function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is blocked. Allow it for this site in the browser’s settings, then record again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found. Plug one in, or open an audio file instead.';
  }
  return 'The microphone could not be started. Close other apps that may be using it and try again.';
}

export function useRecorder(options: Options): RecorderState {
  // begin and finish are long-lived; they read whatever the options are when they run
  const latest = useRef(options);
  latest.current = options;

  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<Recorder | null>(null);
  const live = useRef<LiveTrace>({ times: [], midi: [], level: 0 });
  const liveRaf = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [hearing, setHearing] = useState<{ midi: number; cents: number } | null>(null);
  const [advice, setAdvice] = useState<InputAdvice>(null);
  const metronomeRef = useRef<Metronome | null>(null);
  /** set for a take recorded to the click: its tempo, and where the count-in ends in the recording */
  const clickTakeRef = useRef<{ bpm: number; startsAt: number } | null>(null);
  const [countIn, setCountIn] = useState<number | null>(null);

  useWakeLock(recording);

  const finish = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    cancelAnimationFrame(liveRaf.current);
    metronomeRef.current?.stop();
    metronomeRef.current = null;
    setHearing(null);
    setAdvice(null);
    setCountIn(null);

    const clickTake = clickTakeRef.current;
    clickTakeRef.current = null;
    let audio = await recorder.stop();
    setRecording(false);
    if (clickTake) {
      // drop the count-in, less a moment in case the first note came in early
      const from = Math.max(0, Math.floor((clickTake.startsAt - 0.12) * audio.sampleRate));
      audio = { pcm: audio.pcm.slice(from), sampleRate: audio.sampleRate };
    }
    if (audio.pcm.length / audio.sampleRate < MIN_TAKE_SECONDS) {
      latest.current.onError('That take was too short to hold a tune. Record a few notes, then stop.');
      return;
    }
    await latest.current.onTake(audio, clickTake?.bpm);
  }, []);

  const begin = useCallback(async () => {
    const { click, meter, onStart, onError, onNotice } = latest.current;
    onStart();
    // the click's output has to be started from this tap, before the permission prompt takes it away
    if (click.on) await audioContext().catch(() => {});
    let recorder: Recorder;
    try {
      recorder = await startRecording();
    } catch (err) {
      onError(describeMicError(err));
      return;
    }
    recorderRef.current = recorder;
    live.current = { times: [], midi: [], level: 0 };
    setElapsed(0);
    setRecording(true);

    // the take proper starts here in the recording; later, after a count-in
    let startsAt = 0;
    if (click.on) {
      const beatsPerBar = meter.barUnits / meter.beatUnits;
      setCountIn(beatsPerBar);
      try {
        const metronome = await startMetronome(click.bpm, meter, (beat, bar) =>
          setCountIn(bar === 0 ? beatsPerBar - beat : null),
        );
        if (recorderRef.current !== recorder) {
          metronome.stop(); // stopped while the click was starting up
          return;
        }
        metronomeRef.current = metronome;
        startsAt = recorder.elapsed() + metronome.countInSeconds;
        clickTakeRef.current = { bpm: click.bpm, startsAt };
      } catch {
        setCountIn(null); // no click after all; record without it
      }
    }
    const watch = new LevelWatch();

    // live pitch readout, straight off the microphone
    const yin = new Yin(recorder.sampleRate, { minHz: 70 });
    let fftSize = 2048;
    while (fftSize < yin.frameSize) fftSize *= 2;
    recorder.analyser.fftSize = fftSize;
    const buf = new Float32Array(fftSize);
    const offset = fftSize - yin.frameSize; // the most recent samples
    const startedAt = performance.now();
    let lastReadout = 0;

    const tick = () => {
      if (recorderRef.current !== recorder) return;
      recorder.analyser.getFloatTimeDomainData(buf);
      let energy = 0;
      let peak = 0;
      for (let i = offset; i < buf.length; i++) {
        energy += buf[i] * buf[i];
        if (Math.abs(buf[i]) > peak) peak = Math.abs(buf[i]);
      }
      const rms = Math.sqrt(energy / (buf.length - offset));
      const hz = rms > 0.004 ? yin.detect(buf, offset).hz : -1;
      const midi = hz > 0 ? 69 + 12 * Math.log2(hz / 440) : NaN;

      const now = (performance.now() - startedAt) / 1000;
      const trace = live.current;
      trace.times.push(now);
      trace.midi.push(midi);
      trace.level = rms;
      while (trace.times.length && now - trace.times[0] > LIVE_WINDOW + 1) {
        trace.times.shift();
        trace.midi.shift();
      }

      const taken = recorder.elapsed() - startsAt;
      if (taken >= 0) watch.push(now, rms, peak, hz > 0);

      if (now - lastReadout >= 0.1) {
        lastReadout = now;
        setElapsed(Math.max(0, taken));
        setAdvice(watch.advice());
        const nearest = Math.round(midi);
        setHearing(Number.isNaN(midi) ? null : { midi: nearest, cents: Math.round((midi - nearest) * 100) });
      }
      if (recorder.elapsed() >= MAX_SECONDS) {
        onNotice(`Recording stopped at the ${MAX_SECONDS / 60}-minute limit.`);
        void finish();
        return;
      }
      liveRaf.current = requestAnimationFrame(tick);
    };
    liveRaf.current = requestAnimationFrame(tick);
  }, [finish]);

  // release the microphone when the app goes away
  useEffect(
    () => () => {
      cancelAnimationFrame(liveRaf.current);
      metronomeRef.current?.stop();
      recorderRef.current?.cancel();
    },
    [],
  );

  return { recording, live, elapsed, hearing, advice, countIn, begin, finish };
}
