import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyse, type Analysis } from './audio/analyse';
import { recordingSupported, startRecording, type Recorder, type Recording } from './audio/capture';
import { MAX_SECONDS, decodeAudio } from './audio/decode';
import { DEMO_TITLE, synthesiseDemo } from './audio/demo';
import { ADVICE_TEXT, LevelWatch, type InputAdvice } from './audio/levelWatch';
import { startMetronome, type Metronome } from './audio/metronome';
import { audioContext, playRecording, playScore, playTone, type Playback } from './audio/playback';
import { Yin } from './audio/yin';
import ClickControl, { DEFAULT_CLICK, sanitizeClick } from './components/ClickControl';
import Icon from './components/Icon';
import NoteEditor from './components/NoteEditor';
import PitchRoll, { LIVE_WINDOW, type HeardTake, type LiveTrace } from './components/PitchRoll';
import SettingsPanel from './components/SettingsPanel';
import { downloadFile, fileStem } from './export/download';
import { toMidi } from './export/midi';
import { toMusicXml } from './export/musicxml';
import { useHistory } from './hooks/useHistory';
import { usePersistentState } from './hooks/usePersistentState';
import { useWakeLock } from './hooks/useWakeLock';
import { keyLabel, midiToName, spelledName } from './notation/theory';
import { clearTake, loadTake, saveSheet, saveTake } from './storage/takeStore';
import { ThemeProvider, useTheme, type ThemePreference } from './theme';
import { arrange } from './transcribe';
import { isSplitHalf, withEdit, type NoteEdit, type NoteEdits } from './transcribe/edits';
import { METERS } from './transcribe/score';
import { segmentNotes, type Segmentation } from './transcribe/segment';
import { DEFAULT_SETTINGS, sanitizeSettings } from './transcribe/settings';

// VexFlow and its embedded music fonts are most of the bundle — load them
// apart from the shell so the first screen appears straight away
const loadScoreView = () => import('./components/ScoreView');
const ScoreView = lazy(loadScoreView);

// drawn rather than typed: the ◐ ☀ ☾ characters are missing from some system fonts
const THEME_ICON: Record<ThemePreference, JSX.Element> = {
  system: (
    <>
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="10" cy="10" r="3.6" fill="currentColor" />
      <path
        d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  dark: <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z" fill="currentColor" />,
};
const THEME_LABEL: Record<ThemePreference, string> = {
  system: 'Theme: follows the system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

const UNTITLED = 'Untitled tune';
/** A take shorter than this cannot hold a tune. */
const MIN_TAKE_SECONDS = 0.6;

interface Take {
  /** where the audio came from, for the status line */
  source: string;
  analysis: Analysis;
  heard: Segmentation;
  /** tempo of the click it was recorded to, if any */
  clickBpm?: number;
}

/** Whether the browser's share sheet takes files (phones do; most desktops don't). */
function canShareFiles(): boolean {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'tune.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/** What has been done to the sheet by hand: the part of a tune with an undo history. */
interface Marks {
  edits: NoteEdits;
}

const NO_MARKS: Marks = { edits: {} };

type Phase = { name: 'idle' } | { name: 'recording' } | { name: 'working'; label: string; progress: number | null };

function clock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

function ThemeButton() {
  const { preference, cycle } = useTheme();
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`${THEME_LABEL[preference]}. Change theme`}
      title={THEME_LABEL[preference]}
      onClick={cycle}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        {THEME_ICON[preference]}
      </svg>
    </button>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Scribe />
    </ThemeProvider>
  );
}

function Scribe() {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  const [title, setTitle] = useState(UNTITLED);
  const [settings, setSettings] = usePersistentState('scribe.settings', DEFAULT_SETTINGS, sanitizeSettings);
  const [click, setClick] = usePersistentState('scribe.click', DEFAULT_CLICK, sanitizeClick);

  // corrections to single notes
  const marks = useHistory<Marks>(NO_MARKS);
  const { edits } = marks.value;
  const changeMarks = marks.change;
  const setEdits = useCallback(
    (update: (edits: NoteEdits) => NoteEdits) => changeMarks((m) => ({ ...m, edits: update(m.edits) })),
    [changeMarks],
  );
  /** whether a length change pushes the later notes along, or only moves this note's end */
  const [ripple, setRipple] = usePersistentState('scribe.ripple', false, (stored) => stored === true);
  const [selected, setSelected] = useState<number | null>(null);

  // recording
  const recorderRef = useRef<Recorder | null>(null);
  const liveRef = useRef<LiveTrace>({ times: [], midi: [], level: 0 });
  const liveRaf = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [hearing, setHearing] = useState<{ midi: number; cents: number } | null>(null);
  const [advice, setAdvice] = useState<InputAdvice>(null);
  const metronomeRef = useRef<Metronome | null>(null);
  /** set for a take recorded to the click: its tempo, and where the count-in ends in the recording */
  const clickTakeRef = useRef<{ bpm: number; startsAt: number } | null>(null);
  /** beats of count-in still to come; null once the take proper has begun */
  const [countIn, setCountIn] = useState<number | null>(null);

  // playback
  const playbackRef = useRef<Playback | null>(null);
  const [playing, setPlaying] = useState<'score' | 'recording' | null>(null);
  const [activeEvent, setActiveEvent] = useState<number | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  /** the take on screen came back from storage rather than from the microphone or a file */
  const restoredRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const shareable = useMemo(canShareFiles, []);
  const [dragging, setDragging] = useState(false);

  const recording = phase.name === 'recording';
  const busy = phase.name !== 'idle';
  useWakeLock(recording);

  // warm the notation chunk while the user is still deciding what to record
  useEffect(() => {
    const id = window.setTimeout(() => void loadScoreView(), 600);
    return () => window.clearTimeout(id);
  }, []);

  const arrangement = useMemo(
    () =>
      take && take.heard.notes.length > 0
        ? arrange(take.heard.notes, settings, { edits, clickBpm: take.clickBpm })
        : null,
    [take, settings, edits],
  );

  /** the played notes that are on the score, in order, each with its first notehead and written length */
  const written = useMemo(() => {
    const notes = new Map<number, { name: string; midi: number; units: number; tuplet: boolean }>();
    for (const measure of arrangement?.score.measures ?? []) {
      for (const item of measure.items) {
        if (item.kind !== 'note' || !item.pitch) continue;
        const known = notes.get(item.eventIndex);
        if (known) known.units += item.units;
        else {
          notes.set(item.eventIndex, {
            name: spelledName(item.pitch),
            midi: item.pitch.midi,
            units: item.units,
            tuplet: !!item.tuplet,
          });
        }
      }
    }
    return notes;
  }, [arrangement]);
  const picked = selected === null ? undefined : written.get(selected);

  const resetMarks = marks.reset;
  // bring the tune back after a reload
  useEffect(() => {
    let alive = true;
    void loadTake().then((stored) => {
      if (!alive || !stored) return;
      restoredRef.current = true;
      setTake((current) => current ?? { source: stored.source, analysis: stored.analysis, heard: stored.heard, clickBpm: stored.clickBpm });
      setTitle((current) => (current === UNTITLED && stored.title ? stored.title : current));
      resetMarks({ edits: stored.edits });
    });
    return () => {
      alive = false;
    };
  }, [resetMarks]);

  // keep the stored title and edits up to date, without writing on every keystroke
  useEffect(() => {
    if (!take) return;
    const id = window.setTimeout(() => void saveSheet({ title, edits }), 400);
    return () => window.clearTimeout(id);
  }, [take, title, edits]);


  const heardTake = useMemo<HeardTake | null>(
    () =>
      take
        ? {
            contour: take.heard.contour,
            hopSeconds: take.analysis.track.hopSeconds,
            offsetSeconds: take.analysis.track.offsetSeconds,
            duration: take.analysis.track.duration,
            notes: take.heard.notes,
          }
        : null,
    [take],
  );

  // in the one-column layout the sheet sits below the capture controls: bring a new transcription into view
  useEffect(() => {
    const restored = restoredRef.current;
    restoredRef.current = false;
    if (!take || restored || !window.matchMedia?.('(max-width: 939px)').matches) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sheetRef.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }, [take]);

  const stopPlayback = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
  }, []);

  /** Audio in, take out: the one path shared by the microphone, files and the demo. */
  const transcribe = useCallback(
    async (audio: Recording, source: string, newTitle: string, clickBpm?: number) => {
      stopPlayback();
      setPhase({ name: 'working', label: 'Listening for notes', progress: 0 });
      try {
        const analysis = await analyse(audio, (progress) =>
          setPhase({ name: 'working', label: 'Listening for notes', progress }),
        );
        const next: Take = { source, analysis, heard: segmentNotes(analysis.track), clickBpm };
        setTake(next);
        setTitle(newTitle);
        resetMarks(NO_MARKS);
        setSelected(null);
        void saveTake(next, { title: newTitle, edits: {} });
      } catch {
        setError('The audio could not be analysed. Try again, or try a shorter track.');
      } finally {
        setPhase({ name: 'idle' });
      }
    },
    [stopPlayback, resetMarks],
  );

  const stopLiveLoop = () => {
    cancelAnimationFrame(liveRaf.current);
    metronomeRef.current?.stop();
    metronomeRef.current = null;
    setHearing(null);
    setAdvice(null);
    setCountIn(null);
  };

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    stopLiveLoop();
    const clickTake = clickTakeRef.current;
    clickTakeRef.current = null;
    let audio = await recorder.stop();
    if (clickTake) {
      // drop the count-in, less a moment in case the first note came in early
      const from = Math.max(0, Math.floor((clickTake.startsAt - 0.12) * audio.sampleRate));
      audio = { pcm: audio.pcm.slice(from), sampleRate: audio.sampleRate };
    }
    if (audio.pcm.length / audio.sampleRate < MIN_TAKE_SECONDS) {
      setPhase({ name: 'idle' });
      setError('That take was too short to hold a tune. Record a few notes, then stop.');
      return;
    }
    await transcribe(audio, 'Microphone', UNTITLED, clickTake?.bpm);
  }, [transcribe]);

  const beginRecording = useCallback(async () => {
    setError(null);
    setNotice(null);
    stopPlayback();
    // the click's output has to be started from this tap, before the permission prompt takes it away
    if (click.on) await audioContext().catch(() => {});
    let recorder: Recorder;
    try {
      recorder = await startRecording();
    } catch (err) {
      setError(describeMicError(err));
      return;
    }
    recorderRef.current = recorder;
    liveRef.current = { times: [], midi: [], level: 0 };
    setElapsed(0);
    setPhase({ name: 'recording' });

    // the take proper starts here in the recording; later, after a count-in
    let startsAt = 0;
    if (click.on) {
      const meter = METERS[settings.timeSignature];
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
      const live = liveRef.current;
      live.times.push(now);
      live.midi.push(midi);
      live.level = rms;
      while (live.times.length && now - live.times[0] > LIVE_WINDOW + 1) {
        live.times.shift();
        live.midi.shift();
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
        setNotice(`Recording stopped at the ${MAX_SECONDS / 60}-minute limit.`);
        void finishRecording();
        return;
      }
      liveRaf.current = requestAnimationFrame(tick);
    };
    liveRaf.current = requestAnimationFrame(tick);
  }, [finishRecording, stopPlayback, click, settings.timeSignature]);

  // release the microphone and stop any sound when the app goes away
  useEffect(
    () => () => {
      cancelAnimationFrame(liveRaf.current);
      metronomeRef.current?.stop();
      recorderRef.current?.cancel();
      playbackRef.current?.stop();
    },
    [],
  );

  const openFile = useCallback(
    async (file: File) => {
      setError(null);
      setNotice(null);
      stopPlayback();
      setPhase({ name: 'working', label: 'Reading the file', progress: null });
      let audio: Awaited<ReturnType<typeof decodeAudio>>;
      try {
        audio = await decodeAudio(await file.arrayBuffer());
      } catch {
        setPhase({ name: 'idle' });
        setError(`“${file.name}” could not be read as audio. Try an mp3, m4a, wav, ogg or flac file.`);
        return;
      }
      if (audio.truncated) setNotice(`Only the first ${MAX_SECONDS / 60} minutes of the file were used.`);
      await transcribe(audio, file.name, file.name.replace(/\.[^.]+$/, '') || UNTITLED);
    },
    [stopPlayback, transcribe],
  );

  const runDemo = useCallback(() => {
    setError(null);
    setNotice(null);
    void transcribe({ pcm: synthesiseDemo(22050), sampleRate: 22050 }, 'Demo tune', DEMO_TITLE);
  }, [transcribe]);

  const togglePlayback = async (what: 'score' | 'recording') => {
    const wasPlaying = playing;
    stopPlayback();
    if (wasPlaying === what || !take || !arrangement) return;
    const onEnd = () => {
      playbackRef.current = null;
      setPlaying(null);
    };
    setPlaying(what);
    playbackRef.current =
      what === 'score'
        ? await playScore(arrangement.score, setActiveEvent, onEnd)
        : await playRecording(take.analysis.audio, take.heard.notes, setActiveEvent, onEnd);
  };

  // a change to the notation mid-playback would leave sound and score out of step
  useEffect(() => stopPlayback, [settings, take, edits, stopPlayback]);

  const startOver = () => {
    stopPlayback();
    setTake(null);
    resetMarks(NO_MARKS);
    setSelected(null);
    setTitle(UNTITLED);
    setError(null);
    setNotice(null);
    void clearTake();
  };

  // ---- correcting single notes ----

  const order = useMemo(() => [...written.keys()], [written]);

  // the picked note can leave the score: a new take, a removal
  useEffect(() => {
    if (selected !== null && !written.has(selected)) setSelected(null);
  }, [selected, written]);

  const pick = (eventIndex: number | null) => {
    stopPlayback();
    setSelected((current) => (eventIndex === current ? null : eventIndex));
  };

  const editPicked = (change: (edit: NoteEdit) => NoteEdit) => {
    if (selected !== null) setEdits((current) => withEdit(current, selected, change));
  };

  const stepPicked = (direction: -1 | 1) => {
    if (selected === null) return;
    const next = order[order.indexOf(selected) + direction];
    if (next !== undefined) setSelected(next);
  };

  const nudgePitch = (by: -1 | 1) => {
    if (!picked) return;
    editPicked((edit) => ({ ...edit, semitones: (edit.semitones ?? 0) + by }));
    void playTone(picked.midi + by);
  };

  const stepUnits = arrangement?.stepUnits ?? 1;
  const canShorten = !!picked && picked.units > stepUnits;
  const nudgeLength = (by: -1 | 1) => {
    if (by < 0 && !canShorten) return;
    editPicked((edit) =>
      ripple ? { ...edit, steps: (edit.steps ?? 0) + by } : { ...edit, stretch: (edit.stretch ?? 0) + by },
    );
  };

  // a note cut in two, and two notes made one
  const isSplit = selected !== null && !!edits[selected]?.split;
  const canSplit =
    isSplit || (!!picked && selected !== null && !isSplitHalf(selected) && !picked.tuplet && picked.units >= 2 * stepUnits);
  const toggleSplit = () => {
    if (canSplit) editPicked((edit) => ({ ...edit, split: !edit.split }));
  };
  const nextNote = selected === null ? undefined : order[order.indexOf(selected) + 1];
  const canJoin = nextNote !== undefined && !isSplitHalf(nextNote);
  const joinNext = () => {
    if (canJoin) setEdits((current) => withEdit(current, nextNote, (edit) => ({ ...edit, joined: true })));
  };

  const removePicked = () => {
    if (selected === null) return;
    const at = order.indexOf(selected);
    editPicked((edit) => ({ ...edit, removed: true }));
    setSelected(order[at + 1] ?? order[at - 1] ?? null);
  };

  // the same tools from the keyboard while a note is picked
  const keyActions = useRef({ stepPicked, nudgePitch, nudgeLength, removePicked });
  keyActions.current = { stepPicked, nudgePitch, nudgeLength, removePicked };
  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element).closest?.('input, select, textarea')) return;
      const act = keyActions.current;
      if (e.key === 'ArrowUp') act.nudgePitch(1);
      else if (e.key === 'ArrowDown') act.nudgePitch(-1);
      else if (e.key === 'ArrowLeft') act.stepPicked(-1);
      else if (e.key === 'ArrowRight') act.stepPicked(1);
      else if (e.key === '+' || e.key === '=') act.nudgeLength(1);
      else if (e.key === '-') act.nudgeLength(-1);
      else if (e.key === 'Delete' || e.key === 'Backspace') act.removePicked();
      else if (e.key === 'Escape') setSelected(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // undo and redo from the keyboard; text fields outside the note tools keep their own
  const { undo, redo } = marks;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = e.target as Element;
      if (target.closest?.('input, select, textarea') && !target.closest('.note-editor')) return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const editCount = Object.keys(edits).length;

  const exportTitle = title.trim() || UNTITLED;
  const saveMusicXml = () => {
    if (!arrangement) return;
    downloadFile(
      `${fileStem(exportTitle)}.musicxml`,
      toMusicXml(arrangement.score, exportTitle),
      'application/vnd.recordare.musicxml+xml',
    );
  };
  const saveMidi = () => {
    if (!arrangement) return;
    downloadFile(`${fileStem(exportTitle)}.mid`, toMidi(arrangement.score, exportTitle), 'audio/midi');
  };

  const makePdf = async () => {
    const { scorePdf } = await import('./export/scorePdf');
    return scorePdf(arrangement!.score, exportTitle, keyLabel(arrangement!.score.key));
  };
  const savePdf = async () => {
    if (!arrangement || exporting) return;
    setExporting(true);
    try {
      downloadFile(`${fileStem(exportTitle)}.pdf`, await makePdf(), 'application/pdf');
    } catch {
      setError('The PDF could not be made. Print the score instead and choose “Save as PDF”.');
    } finally {
      setExporting(false);
    }
  };
  const share = async () => {
    if (!arrangement || exporting) return;
    setExporting(true);
    try {
      const pdf = await makePdf();
      const file = new File([pdf], `${fileStem(exportTitle)}.pdf`, { type: 'application/pdf' });
      try {
        await navigator.share({ files: [file], title: exportTitle });
      } catch (err) {
        // closing the share sheet is not a failure; a refusal to open it falls back to a download
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          downloadFile(file.name, pdf, 'application/pdf');
        }
      }
    } catch {
      setError('The score could not be shared. Try saving it as a PDF instead.');
    } finally {
      setExporting(false);
    }
  };

  const noteCount = take?.heard.notes.length ?? 0;
  const tuning = take?.heard.tuningCents ?? 0;

  return (
    <div
      className={`app${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => {
        if (busy || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (busy || !file) return;
        e.preventDefault();
        void openFile(file);
      }}
    >
      <header className="masthead">
        <h1>Tune Scribe</h1>
        <ThemeButton />
      </header>

      <div className="workspace">
        <div className="rail">
          <section className="capture" aria-label="Audio in">
            <div className="capture-actions">
              <button
                type="button"
                className={`record${recording ? ' is-recording' : ''}`}
                onClick={recording ? () => void finishRecording() : () => void beginRecording()}
                disabled={phase.name === 'working' || !recordingSupported()}
                aria-label={recording ? 'Stop recording' : 'Record'}
              >
                <span className="record-glyph" aria-hidden="true" />
              </button>
              <div className="capture-status" aria-live="polite">
                {recording ? (
                  <>
                    <span className="capture-main">
                      {countIn !== null ? (
                        <span className="count-in" data-testid="count-in">
                          Count-in <strong>{countIn}</strong>
                        </span>
                      ) : (
                        <span className="clock">{clock(elapsed)}</span>
                      )}
                      <span className="hearing">
                        {hearing ? (
                          <>
                            {midiToName(hearing.midi)}{' '}
                            <small>
                              {hearing.cents > 0 ? '+' : hearing.cents < 0 ? '−' : ''}
                              {Math.abs(hearing.cents)}¢
                            </small>
                          </>
                        ) : (
                          <small>no pitch</small>
                        )}
                      </span>
                    </span>
                    <span className={`capture-sub${advice ? ' is-advice' : ''}`} data-testid="capture-sub">
                      {countIn !== null
                        ? 'Come in after the count.'
                        : advice
                          ? ADVICE_TEXT[advice]
                          : 'Recording. Press stop when the tune is done.'}
                    </span>
                  </>
                ) : phase.name === 'working' ? (
                  <>
                    <span className="capture-main">{phase.label}</span>
                    <progress
                      max={1}
                      {...(phase.progress === null ? {} : { value: phase.progress })}
                      aria-label={phase.label}
                    />
                  </>
                ) : (
                  <>
                    <span className="capture-main">Record a melody</span>
                    <span className="capture-sub">
                      {recordingSupported()
                        ? 'Hum, whistle, sing or play one note at a time.'
                        : 'This browser can’t record here. Open an audio file instead.'}
                    </span>
                  </>
                )}
              </div>
            </div>

            <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Icon name="open" />
              Open audio file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ''; // let the same file be chosen again
                if (file) void openFile(file);
              }}
            />

            <ClickControl click={click} onChange={setClick} disabled={busy || !recordingSupported()} />

            {error && (
              <p className="message is-error" role="alert">
                {error}
              </p>
            )}
            {notice && <p className="message">{notice}</p>}
            {take && !busy && (
              <button type="button" className="link start-over" onClick={startOver}>
                Clear this tune and start over
              </button>
            )}
          </section>

          <section className={`heard${take || recording ? '' : ' is-idle'}`} aria-labelledby="heard-heading">
            <div className="heard-head">
              <h2 id="heard-heading">What was heard</h2>
              {take && !recording && (
                <span className="heard-meta" data-testid="heard-meta">
                  {noteCount} {noteCount === 1 ? 'note' : 'notes'} in {clock(take.analysis.track.duration)}
                  {Math.abs(tuning) >= 8 && `, ${Math.abs(tuning)}¢ ${tuning > 0 ? 'sharp' : 'flat'} overall`}
                </span>
              )}
            </div>
            <PitchRoll live={recording ? liveRef : null} take={recording ? null : heardTake} activeEvent={activeEvent} />
          </section>

          <SettingsPanel settings={settings} onChange={setSettings} detected={arrangement?.detected ?? null} />
        </div>

        <main className="desk">
          <article ref={sheetRef} className={`sheet${arrangement ? '' : ' is-blank'}`} aria-label="Score">
            {arrangement ? (
              <>
                <input
                  className="sheet-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Title"
                  placeholder={UNTITLED}
                  spellCheck={false}
                />
                <p className="sheet-key" data-testid="sheet-key">
                  {keyLabel(arrangement.score.key)}
                </p>
                <Suspense fallback={<p className="sheet-loading">Setting the type…</p>}>
                  <ScoreView score={arrangement.score} activeEvent={activeEvent} selected={selected} onSelect={pick} />
                </Suspense>
                <div className="sheet-foot">
                  <p className="sheet-hint">
                    {editCount > 0 ? (
                      <>
                        {editCount} {editCount === 1 ? 'note' : 'notes'} corrected by hand.{' '}
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            setEdits(() => ({}));
                            setSelected(null);
                          }}
                        >
                          Undo all
                        </button>
                      </>
                    ) : (
                      'Tap a note to correct it.'
                    )}
                  </p>
                  {(marks.canUndo || marks.canRedo) && (
                    <div className="sheet-history">
                      <button type="button" className="tool" aria-label="Undo" title="Undo" onClick={undo} disabled={!marks.canUndo}>
                        <Icon name="undo" />
                      </button>
                      <button type="button" className="tool" aria-label="Redo" title="Redo" onClick={redo} disabled={!marks.canRedo}>
                        <Icon name="redo" />
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : recording ? (
              <div className="sheet-empty">
                <h2>Listening</h2>
                <p>The pitch trace shows what is being picked up. The score is written when you press stop.</p>
              </div>
            ) : take ? (
              <div className="sheet-empty">
                <h2>No clear notes in that one</h2>
                <p>
                  Tune Scribe follows a single line of melody. Move closer to the microphone, cut the background
                  sound, or pick a track where one voice or instrument carries the tune on its own.
                </p>
              </div>
            ) : (
              <div className="sheet-empty">
                <h2>The page is blank until it hears a tune</h2>
                <p>
                  Record a melody or open an audio file, and it is written out here as sheet music you can play
                  back, print, or take into a notation editor.
                </p>
                <p>
                  It follows one note at a time: a voice, a whistle, a flute, a violin, a single line on the piano.
                  Chords and full-band mixes will not come out right.
                </p>
                <button type="button" className="button" onClick={runDemo} disabled={busy}>
                  Try it with a demo tune
                </button>
              </div>
            )}
          </article>

          {arrangement && (
            <div className="transport">
              {picked && selected !== null ? (
                <NoteEditor
                  name={picked.name}
                  position={`note ${order.indexOf(selected) + 1} of ${order.length}`}
                  edited={!!edits[selected]}
                  canShorten={canShorten}
                  ripple={ripple}
                  onRipple={() => setRipple(!ripple)}
                  isSplit={isSplit}
                  canSplit={canSplit}
                  onSplit={toggleSplit}
                  canJoin={canJoin}
                  onJoin={joinNext}
                  onStep={stepPicked}
                  onPitch={nudgePitch}
                  onLength={nudgeLength}
                  onRemove={removePicked}
                  onReset={() => editPicked(() => ({}))}
                  onDone={() => setSelected(null)}
                />
              ) : (
                <div className="transport-group transport-play">
                  <button
                    type="button"
                    className="button is-primary"
                    onClick={() => void togglePlayback('score')}
                    aria-pressed={playing === 'score'}
                  >
                    <Icon name={playing === 'score' ? 'stop' : 'play'} />
                    {playing === 'score' ? 'Stop' : 'Play score'}
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => void togglePlayback('recording')}
                    aria-pressed={playing === 'recording'}
                  >
                    <Icon name={playing === 'recording' ? 'stop' : 'play'} />
                    {playing === 'recording' ? 'Stop' : 'Play recording'}
                  </button>
                </div>
              )}
              <div className="transport-group transport-save">
                {shareable && (
                  <button type="button" className="button" onClick={() => void share()} disabled={exporting}>
                    <Icon name="share" />
                    Share
                  </button>
                )}
                <button type="button" className="button" onClick={() => void savePdf()} disabled={exporting} aria-label="Save PDF">
                  <Icon name="save" />
                  PDF
                </button>
                <button type="button" className="button" onClick={saveMusicXml} aria-label="Save MusicXML">
                  <Icon name="save" />
                  MusicXML
                </button>
                <button type="button" className="button" onClick={saveMidi} aria-label="Save MIDI">
                  <Icon name="save" />
                  MIDI
                </button>
                <button type="button" className="button" onClick={() => window.print()}>
                  <Icon name="print" />
                  Print
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {dragging && <div className="drop-hint">Drop the audio file to transcribe it</div>}
    </div>
  );
}
