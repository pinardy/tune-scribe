// Playing the score and the recording, and how the score is played: its
// speed, whether it loops, whether a click goes with it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPiano } from '../audio/piano';
import { playRecording, playScore, type Playback } from '../audio/playback';
import { usePersistentState } from '../hooks/usePersistentState';
import type { StoredTake } from '../storage/library';
import type { Score } from '../transcribe/score';

export interface PlaybackPrefs {
  /** 1 = at the written tempo */
  speed: number;
  loop: boolean;
  click: boolean;
}

const DEFAULT_PREFS: PlaybackPrefs = { speed: 1, loop: false, click: false };
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 1.25;

function sanitizePrefs(stored: unknown): PlaybackPrefs {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof PlaybackPrefs, unknown>>;
  return {
    speed: typeof s.speed === 'number' && s.speed >= MIN_SPEED && s.speed <= MAX_SPEED ? s.speed : 1,
    loop: s.loop === true,
    click: s.click === true,
  };
}

export interface PlaybackState {
  playing: 'score' | 'recording' | null;
  /** index of the played note that is sounding */
  activeEvent: number | null;
  prefs: PlaybackPrefs;
  setPrefs: (prefs: PlaybackPrefs) => void;
  /** Starts the score or the recording, or stops it if that is what is playing. */
  toggle: (what: 'score' | 'recording') => Promise<void>;
  stop: () => void;
}

export function usePlayback(take: StoredTake | null, score: Score | undefined): PlaybackState {
  const current = useRef<Playback | null>(null);
  const [playing, setPlaying] = useState<'score' | 'recording' | null>(null);
  const [activeEvent, setActiveEvent] = useState<number | null>(null);
  const [prefs, setPrefs] = usePersistentState('scribe.playback', DEFAULT_PREFS, sanitizePrefs);

  const stop = useCallback(() => {
    current.current?.stop();
    current.current = null;
  }, []);

  // read when a loop comes round again, by which time these may have changed
  const latest = useRef({ loop: prefs.loop, score });
  latest.current = { loop: prefs.loop, score };

  const startScore = async () => {
    const toPlay = latest.current.score;
    if (!toPlay) return;
    setPlaying('score');
    const started = await playScore(
      toPlay,
      setActiveEvent,
      (finished) => {
        if (current.current === started) current.current = null;
        if (finished && latest.current.loop) void startScore();
        else setPlaying(null);
      },
      { speed: prefs.speed, click: prefs.click },
    );
    current.current = started;
  };

  const toggle = async (what: 'score' | 'recording') => {
    const wasPlaying = playing;
    stop();
    if (wasPlaying === what || !take || !score) return;
    if (what === 'score') return startScore();
    if (!take.analysis) return;
    setPlaying(what);
    current.current = await playRecording(take.analysis.audio, take.heard.notes, setActiveEvent, () => {
      current.current = null;
      setPlaying(null);
    });
  };

  // a change to the notation mid-playback would leave sound and score out of step,
  // and so would a change of speed, or the click coming or going
  useEffect(() => stop, [take, score, prefs.speed, prefs.click, stop]);

  // have the piano on hand by the time play is pressed
  const hasScore = !!score;
  useEffect(() => {
    if (hasScore) void fetchPiano().catch(() => {});
  }, [hasScore]);

  return { playing, activeEvent, prefs, setPrefs, toggle, stop };
}
