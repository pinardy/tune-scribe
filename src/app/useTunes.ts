// The tune on the desk and the ones put away: opening, saving as it changes,
// arriving by link, coming back after a reload.

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { History } from '../hooks/useHistory';
import { LINK_PREFIX, decodeTune } from '../share/link';
import {
  currentTuneId,
  deleteTune,
  listTunes,
  loadTune,
  newTuneId,
  saveSheet,
  saveTune,
  setCurrentTuneId,
  type StoredSheet,
  type StoredTake,
  type TuneSummary,
} from '../storage/library';
import { NO_MARKS, type Marks } from '../transcribe/marks';
import { takeSeconds } from '../transcribe/splice';
import { DEFAULT_SETTINGS, type ScribeSettings } from '../transcribe/settings';
import { UNTITLED } from './format';

interface Options {
  settings: ScribeSettings;
  setSettings: (settings: ScribeSettings) => void;
  marks: History<Marks>;
  onError: (message: string | null) => void;
}

export interface Tunes {
  /** the audio as heard, for the tune on the desk */
  take: StoredTake | null;
  /** its id in the library; null when it is not saved (nothing heard, or storage refused) */
  tuneId: string | null;
  library: TuneSummary[];
  title: string;
  setTitle: (title: string) => void;
  composer: string;
  setComposer: (composer: string) => void;
  /** how long the tune runs: the audio's length, or the last note's end when there is no audio */
  seconds: number;
  /** true, once, when the tune on the desk came back from storage rather than from the user */
  restored: MutableRefObject<boolean>;
  /** Puts a new take on the desk and into the library. */
  keep: (take: StoredTake, title: string) => Promise<void>;
  /** Puts a changed take (trimmed, or added to) in place of the one on the desk, with the marks that still apply. */
  revise: (take: StoredTake, marks: Marks) => Promise<void>;
  open: (id: string) => Promise<void>;
  remove: (tune: TuneSummary) => Promise<void>;
  /** Clears the desk. The tune that was on it stays in the library. */
  putAway: () => void;
}

export function useTunes({ settings, setSettings, marks, onError }: Options): Tunes {
  const [take, setTake] = useState<StoredTake | null>(null);
  const [tuneId, setTuneId] = useState<string | null>(null);
  const [library, setLibrary] = useState<TuneSummary[]>([]);
  const [title, setTitle] = useState(UNTITLED);
  const [composer, setComposer] = useState('');
  const restored = useRef(false);
  const resetMarks = marks.reset;

  const refresh = useCallback(() => void listTunes().then(setLibrary), []);

  /** Puts a tune on the desk: a new one, one from the library, or one that came in a link. */
  const show = useCallback(
    (id: string | null, tune: StoredTake, sheet: StoredSheet) => {
      setTake(tune);
      setTuneId(id);
      setCurrentTuneId(id);
      setTitle(sheet.title || UNTITLED);
      setComposer(sheet.composer);
      setSettings(sheet.settings);
      resetMarks(sheet.marks);
    },
    [resetMarks, setSettings],
  );

  /** Opens the tune a link carries, and keeps it in the library like any other. */
  const openLink = useCallback(
    async (hash: string): Promise<boolean> => {
      if (!hash.startsWith(LINK_PREFIX)) return false;
      const shared = await decodeTune(hash.slice(LINK_PREFIX.length));
      // the link has done its work; a reload should not open a second copy
      history.replaceState(null, '', location.pathname + location.search);
      if (!shared) {
        onError('That link does not hold a tune. It may have been cut short when it was copied.');
        return false;
      }
      const tune: StoredTake = {
        source: 'Shared link',
        clickBpm: shared.clickBpm,
        analysis: null,
        heard: { notes: shared.notes, tuningCents: 0, contour: new Float32Array(0) },
      };
      const sheet = { title: shared.title, composer: shared.composer, marks: shared.marks, settings: shared.settings };
      const id = newTuneId();
      const saved = await saveTune(id, tune, sheet);
      show(saved ? id : null, tune, sheet);
      refresh();
      return true;
    },
    [show, refresh, onError],
  );

  // on arrival: the tune in the link, or else the one that was open last
  useEffect(() => {
    let alive = true;
    void (async () => {
      refresh();
      if (await openLink(location.hash)) return;
      const id = currentTuneId();
      const stored = id ? await loadTune(id) : null;
      if (!alive || !id || !stored) return;
      restored.current = true;
      show(id, stored, stored);
    })();
    const onHash = () => void openLink(location.hash);
    window.addEventListener('hashchange', onHash);
    return () => {
      alive = false;
      window.removeEventListener('hashchange', onHash);
    };
  }, [openLink, show, refresh]);

  // keep the stored title, marks and settings up to date, without writing on every keystroke
  useEffect(() => {
    if (!take || !tuneId) return;
    const id = window.setTimeout(() => {
      void saveSheet(tuneId, take, { title, composer, marks: marks.value, settings }).then(refresh);
    }, 400);
    return () => window.clearTimeout(id);
  }, [take, tuneId, title, composer, marks.value, settings, refresh]);

  const keep = async (next: StoredTake, newTitle: string) => {
    const sheet = { title: newTitle, composer: '', marks: NO_MARKS, settings };
    // a take with nothing in it is shown, so its message can be read, but not kept
    const id = next.heard.notes.length > 0 ? newTuneId() : null;
    const saved = !!id && (await saveTune(id, next, sheet));
    show(saved ? id : null, next, sheet);
    refresh();
  };

  const revise = async (next: StoredTake, nextMarks: Marks) => {
    setTake(next);
    // the notes have been renumbered: steps back to the old numbering would land on the wrong notes
    resetMarks(nextMarks);
    if (tuneId) await saveTune(tuneId, next, { title, composer, marks: nextMarks, settings });
    refresh();
  };

  const putAway = () => {
    setTake(null);
    setTuneId(null);
    setCurrentTuneId(null);
    resetMarks(NO_MARKS);
    setTitle(UNTITLED);
    setComposer('');
    // its settings were its own; the next tune starts from automatic
    setSettings(DEFAULT_SETTINGS);
    onError(null);
  };

  const open = async (id: string) => {
    if (id === tuneId) return;
    onError(null);
    const stored = await loadTune(id);
    if (stored) show(id, stored, stored);
    else onError('That tune could not be opened.');
    refresh();
  };

  const remove = async (tune: TuneSummary) => {
    if (!window.confirm(`Delete “${tune.title || UNTITLED}”? This cannot be undone.`)) return;
    if (tune.id === tuneId) putAway();
    await deleteTune(tune.id);
    refresh();
  };

  const seconds = take ? takeSeconds(take) : 0;

  return { take, tuneId, library, title, setTitle, composer, setComposer, seconds, restored, keep, revise, open, remove, putAway };
}
