// Picking a note on the score and changing it: the state behind the note
// editor, the keyboard shortcuts that go with it, and undo and redo.

import { useEffect, useMemo, useRef, useState } from 'react';
import { playTone } from '../audio/playback';
import type { NoteEditorProps } from '../components/NoteEditor';
import type { History } from '../hooks/useHistory';
import { usePersistentState } from '../hooks/usePersistentState';
import { spelledName } from '../notation/theory';
import type { Arrangement } from '../transcribe';
import { isSplitHalf, withEdit, type NoteEdit } from '../transcribe/edits';
import { withRepeat, withText, type Marks } from '../transcribe/marks';

/** A played note as it stands on the score. */
interface WrittenNote {
  name: string;
  midi: number;
  /** written length, all its tied noteheads together */
  units: number;
  tuplet: boolean;
  /** the bar its first notehead is in */
  measure: number;
}

export interface NoteTools {
  /** index of the played note picked for editing */
  selected: number | null;
  /** A note was tapped (again: unpick it), or the score beside the notes (null). */
  pick: (eventIndex: number | null) => void;
  /** what the note editor needs, while a note is picked */
  editor: NoteEditorProps | null;
  /** how many notes carry a correction */
  editCount: number;
  undoAllEdits: () => void;
}

/**
 * @param tune    whatever identifies the tune on the desk; a change of tune drops the selection
 * @param onPick  a note is being picked: stop anything playing
 */
export function useNoteTools(
  arrangement: Arrangement | null,
  marks: History<Marks>,
  tune: unknown,
  onPick: () => void,
): NoteTools {
  const [selected, setSelected] = useState<number | null>(null);
  /** whether a length change pushes the later notes along, or only moves this note's end */
  const [ripple, setRipple] = usePersistentState('scribe.ripple', false, (stored) => stored === true);
  const { edits, chords, lyrics } = marks.value;
  const change = marks.change;

  /** the played notes that are on the score, in order */
  const written = useMemo(() => {
    const notes = new Map<number, WrittenNote>();
    (arrangement?.score.measures ?? []).forEach((measure, index) => {
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
            measure: index,
          });
        }
      }
    });
    return notes;
  }, [arrangement]);
  const order = useMemo(() => [...written.keys()], [written]);
  const picked = selected === null ? undefined : written.get(selected);

  useEffect(() => setSelected(null), [tune]);
  // the picked note can also leave the score by being removed or joined
  useEffect(() => {
    if (selected !== null && !written.has(selected)) setSelected(null);
  }, [selected, written]);

  const pick = (eventIndex: number | null) => {
    onPick();
    setSelected((current) => (eventIndex === current ? null : eventIndex));
  };

  const editNote = (eventIndex: number, update: (edit: NoteEdit) => NoteEdit) =>
    change((m) => ({ ...m, edits: withEdit(m.edits, eventIndex, update) }));
  const editPicked = (update: (edit: NoteEdit) => NoteEdit) => {
    if (selected !== null) editNote(selected, update);
  };

  const step = (direction: -1 | 1) => {
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
  const nextNote = selected === null ? undefined : order[order.indexOf(selected) + 1];
  const canJoin = nextNote !== undefined && !isSplitHalf(nextNote);

  const remove = () => {
    if (selected === null) return;
    const at = order.indexOf(selected);
    editPicked((edit) => ({ ...edit, removed: true }));
    setSelected(order[at + 1] ?? order[at - 1] ?? null);
  };

  // A repeat sign belongs to a bar, whichever of the bar's notes it was put on.
  const bar = picked ? arrangement?.score.measures[picked.measure] : undefined;
  const toggleRepeat = (sign: 'start' | 'end') => {
    if (selected === null || !picked) return;
    const on = !(sign === 'start' ? bar?.repeatStart : bar?.repeatEnd);
    const inBar = order.filter((index) => written.get(index)!.measure === picked.measure);
    change((m) => {
      // off: take it from every note in the bar; on: put it on this one
      let repeats = m.repeats;
      for (const index of inBar) repeats = withRepeat(repeats, index, sign, false);
      return { ...m, repeats: on ? withRepeat(repeats, selected, sign, true) : repeats };
    });
  };

  // the same tools from the keyboard while a note is picked
  const keys = useRef({ step, nudgePitch, nudgeLength, remove });
  keys.current = { step, nudgePitch, nudgeLength, remove };
  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element).closest?.('input, select, textarea')) return;
      const act = keys.current;
      if (e.key === 'ArrowUp') act.nudgePitch(1);
      else if (e.key === 'ArrowDown') act.nudgePitch(-1);
      else if (e.key === 'ArrowLeft') act.step(-1);
      else if (e.key === 'ArrowRight') act.step(1);
      else if (e.key === '+' || e.key === '=') act.nudgeLength(1);
      else if (e.key === '-') act.nudgeLength(-1);
      else if (e.key === 'Delete' || e.key === 'Backspace') act.remove();
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

  const editor: NoteEditorProps | null =
    picked && selected !== null
      ? {
          name: picked.name,
          position: `note ${order.indexOf(selected) + 1} of ${order.length}`,
          edited: !!edits[selected],
          canShorten,
          ripple,
          onRipple: () => setRipple(!ripple),
          isSplit,
          canSplit,
          onSplit: () => {
            if (canSplit) editPicked((edit) => ({ ...edit, split: !edit.split }));
          },
          canJoin,
          onJoin: () => {
            if (canJoin) editNote(nextNote, (edit) => ({ ...edit, joined: true }));
          },
          chord: chords[selected] ?? '',
          lyric: lyrics[selected] ?? '',
          // a run of typing in one field undoes as one step
          onChord: (text) => change((m) => ({ ...m, chords: withText(m.chords, selected, text) }), `chord ${selected}`),
          onLyric: (text) => change((m) => ({ ...m, lyrics: withText(m.lyrics, selected, text) }), `lyric ${selected}`),
          repeatStart: !!bar?.repeatStart,
          repeatEnd: !!bar?.repeatEnd,
          onRepeat: toggleRepeat,
          onStep: step,
          onPitch: nudgePitch,
          onLength: nudgeLength,
          onRemove: remove,
          onReset: () => editPicked(() => ({})),
          onDone: () => setSelected(null),
        }
      : null;

  return {
    selected,
    pick,
    editor,
    editCount: Object.keys(edits).length,
    undoAllEdits: () => {
      change((m) => ({ ...m, edits: {} }));
      setSelected(null);
    },
  };
}
