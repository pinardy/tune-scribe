// The desk: audio comes in on the left, the sheet it is written on sits on
// the right. This file wires the pieces together; what each one does lives
// in app/ (state and actions) and components/ (what is on screen).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UNTITLED } from './app/format';
import { useExports } from './app/useExports';
import { useNoteTools } from './app/useNoteTools';
import { usePlayback } from './app/usePlayback';
import { useRecorder } from './app/useRecorder';
import { useTunes } from './app/useTunes';
import { analyse } from './audio/analyse';
import type { Recording } from './audio/capture';
import { MAX_SECONDS, decodeAudio } from './audio/decode';
import { DEMO_TITLE, synthesiseDemo } from './audio/demo';
import Capture, { type Working } from './components/Capture';
import Heard from './components/Heard';
import { DEFAULT_CLICK, sanitizeClick } from './components/ClickControl';
import Library from './components/Library';
import type { HeardTake } from './components/PitchRoll';
import SettingsPanel from './components/SettingsPanel';
import SheetFoot from './components/SheetFoot';
import ThemeButton from './components/ThemeButton';
import Transport from './components/Transport';
import { useHistory } from './hooks/useHistory';
import { usePersistentState } from './hooks/usePersistentState';
import { keyLabel } from './notation/theory';
import { ThemeProvider } from './theme';
import { arrange } from './transcribe';
import { NO_MARKS, remapMarks, type Marks } from './transcribe/marks';
import { METERS } from './transcribe/score';
import { segmentNotes } from './transcribe/segment';
import { DEFAULT_SETTINGS, sanitizeSettings } from './transcribe/settings';
import { joinTakes, trimTake } from './transcribe/splice';

// VexFlow is most of the bundle — load it apart from the shell so the first
// screen appears straight away
const loadScoreView = () => import('./components/ScoreView');
const ScoreView = lazy(loadScoreView);

export default function App() {
  return (
    <ThemeProvider>
      <Scribe />
    </ThemeProvider>
  );
}

function Scribe() {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** audio that has come in is being read or listened to */
  const [working, setWorking] = useState<Working | null>(null);
  const [settings, setSettings] = usePersistentState('scribe.settings', DEFAULT_SETTINGS, sanitizeSettings);
  const [click, setClick] = usePersistentState('scribe.click', DEFAULT_CLICK, sanitizeClick);
  /** everything put on the sheet by hand, with its undo history */
  const marks = useHistory<Marks>(NO_MARKS);

  const tunes = useTunes({ settings, setSettings, marks, onError: setError });
  const { take } = tunes;

  const arrangement = useMemo(
    () =>
      take && take.heard.notes.length > 0
        ? arrange(take.heard.notes, settings, { ...marks.value, clickBpm: take.clickBpm })
        : null,
    [take, settings, marks.value],
  );
  const score = arrangement?.score;

  /** new audio goes on the end of the tune on the desk, rather than starting a new one */
  const [adding, setAdding] = useState(false);
  /** new audio replaces the tune from this played note, the first of this bar, to the end */
  const [recordFrom, setRecordFrom] = useState<{ event: number; bar: number } | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  const playback = usePlayback(take, score);
  const tools = useNoteTools(arrangement, marks, take, playback.stop, (event, bar) => {
    setRecordFrom({ event, bar });
    captureRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const exports = useExports({
    score,
    take,
    title: tunes.title,
    composer: tunes.composer,
    settings,
    marks: marks.value,
    onError: setError,
    onNotice: setNotice,
  });

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  /** Audio in, take out: the one path shared by the microphone, files and the demo. */
  const transcribe = async (audio: Recording, source: string, title: string, clickBpm?: number) => {
    const label = 'Listening for notes';
    playback.stop();
    setWorking({ label, progress: 0 });
    try {
      const analysis = await analyse(audio, (progress) => setWorking({ label, progress }));
      const fresh = { source, analysis, heard: segmentNotes(analysis.track), clickBpm };
      if (!take || take.heard.notes.length === 0 || !(adding || recordFrom)) return await tunes.keep(fresh, title);

      // into the tune on the desk: after its last note, or in place of everything from a bar on
      if (fresh.heard.notes.length === 0) {
        setError('No clear notes were heard in that one. The tune is as it was.');
        return;
      }
      const cut = recordFrom && take.heard.notes[recordFrom.event];
      const kept = cut ? trimTake(take, 0, cut.start) : null;
      const base = kept ? kept.take : take;
      await tunes.revise(
        base.heard.notes.length > 0 ? joinTakes(base, fresh) : fresh,
        kept ? remapMarks(marks.value, kept.indexOf) : marks.value,
      );
      setRecordFrom(null);
    } catch {
      setError('The audio could not be analysed. Try again, or try a shorter track.');
    } finally {
      setWorking(null);
    }
  };

  const recorder = useRecorder({
    click,
    meter: METERS[settings.timeSignature],
    onStart: () => {
      clearMessages();
      playback.stop();
    },
    onError: setError,
    onNotice: setNotice,
    onTake: (audio, clickBpm) => transcribe(audio, 'Microphone', UNTITLED, clickBpm),
  });
  const { recording } = recorder;
  const busy = recording || working !== null;

  const openFile = async (file: File) => {
    clearMessages();
    setWorking({ label: 'Reading the file', progress: null });
    let audio: Awaited<ReturnType<typeof decodeAudio>>;
    try {
      audio = await decodeAudio(await file.arrayBuffer());
    } catch {
      setWorking(null);
      setError(`“${file.name}” could not be read as audio. Try an mp3, m4a, wav, ogg or flac file.`);
      return;
    }
    if (audio.truncated) setNotice(`Only the first ${MAX_SECONDS / 60} minutes of the file were used.`);
    await transcribe(audio, file.name, file.name.replace(/\.[^.]+$/, '') || UNTITLED);
  };

  const runDemo = () => {
    clearMessages();
    void transcribe({ pcm: synthesiseDemo(22050), sampleRate: 22050 }, 'Demo tune', DEMO_TITLE);
  };

  const putAway = () => {
    tunes.putAway();
    setNotice(null);
  };

  // a different tune on the desk: what was set up for the last one no longer applies
  const { tuneId } = tunes;
  useEffect(() => {
    setAdding(false);
    setRecordFrom(null);
  }, [tuneId]);

  const trim = (from: number, to: number) => {
    if (!take) return;
    clearMessages();
    playback.stop();
    const trimmed = trimTake(take, from, to);
    if (trimmed.take.heard.notes.length === 0) {
      setError('That would cut off every note. Keep a part with some of the tune in it.');
      return;
    }
    void tunes.revise(trimmed.take, remapMarks(marks.value, trimmed.indexOf));
  };

  // warm the notation chunk while the user is still deciding what to record
  useEffect(() => {
    const id = window.setTimeout(() => void loadScoreView(), 600);
    return () => window.clearTimeout(id);
  }, []);

  const heardTake = useMemo<HeardTake | null>(
    () =>
      take
        ? {
            contour: take.heard.contour,
            hopSeconds: take.analysis?.track.hopSeconds ?? 0.01,
            offsetSeconds: take.analysis?.track.offsetSeconds ?? 0,
            duration: tunes.seconds,
            notes: take.heard.notes,
          }
        : null,
    [take, tunes.seconds],
  );

  // in the one-column layout the sheet sits below the capture controls: bring a new transcription into view
  const sheetRef = useRef<HTMLElement>(null);
  const { restored } = tunes;
  useEffect(() => {
    const cameBack = restored.current;
    restored.current = false;
    if (!take || cameBack || !window.matchMedia?.('(max-width: 939px)').matches) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sheetRef.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }, [take, restored]);

  const [dragging, setDragging] = useState(false);

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
        <div className="rail" ref={captureRef}>
          <Capture
            recorder={recorder}
            working={working}
            onFile={(file) => void openFile(file)}
            click={click}
            onClick={setClick}
            error={error}
            notice={notice}
            target={
              take && take.heard.notes.length > 0
                ? { adding, onAdding: setAdding, fromBar: recordFrom?.bar ?? null, onCancelFrom: () => setRecordFrom(null) }
                : null
            }
          >
            {take && !busy && (
              <button type="button" className="link start-over" onClick={putAway}>
                {tunes.tuneId ? 'Put this tune away and start a new one' : 'Clear this and start again'}
              </button>
            )}
            <Library
              tunes={tunes.library}
              currentId={tunes.tuneId}
              disabled={busy}
              onOpen={(id) => {
                setNotice(null);
                void tunes.open(id);
              }}
              onDelete={(tune) => void tunes.remove(tune)}
            />
          </Capture>

          <Heard
            take={heardTake}
            tuning={take?.heard.tuningCents ?? 0}
            recording={recording}
            live={recorder.live}
            activeEvent={playback.activeEvent}
            canTrim={!busy}
            onTrim={trim}
          />

          <SettingsPanel settings={settings} onChange={setSettings} detected={arrangement?.detected ?? null} />
        </div>

        <main className="desk">
          <article ref={sheetRef} className={`sheet${score ? '' : ' is-blank'}`} aria-label="Score">
            {score ? (
              <>
                <input
                  className="sheet-title"
                  value={tunes.title}
                  onChange={(e) => tunes.setTitle(e.target.value)}
                  aria-label="Title"
                  placeholder={UNTITLED}
                  spellCheck={false}
                />
                <p className="sheet-key" data-testid="sheet-key">
                  {keyLabel(score.key)}
                </p>
                <input
                  className="sheet-composer"
                  value={tunes.composer}
                  onChange={(e) => tunes.setComposer(e.target.value)}
                  aria-label="Composer"
                  placeholder="Composer"
                  maxLength={80}
                  spellCheck={false}
                />
                <Suspense fallback={<p className="sheet-loading">Setting the type…</p>}>
                  <ScoreView
                    score={score}
                    activeEvent={playback.activeEvent}
                    selected={tools.selected}
                    onSelect={tools.pick}
                  />
                </Suspense>
                <SheetFoot
                  editCount={tools.editCount}
                  onUndoAll={tools.undoAllEdits}
                  onSuggestChords={tools.suggestChords}
                  history={marks}
                />
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

          {score && (
            <Transport
              playback={playback}
              hasRecording={!!take?.analysis}
              editor={tools.editor}
              rest={tools.rest}
              bars={score.measures.length}
              exports={exports}
            />
          )}
        </main>
      </div>

      {dragging && <div className="drop-hint">Drop the audio file to transcribe it</div>}
    </div>
  );
}
