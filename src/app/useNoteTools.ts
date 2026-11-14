// Picking notes on the score and changing them: the state behind the note
// editor, the keyboard shortcuts that go with it, and undo and redo.

import { useEffect, useMemo, useRef, useState } from 'react';
import { playTone } from '../audio/playback';
import type { NoteEditorProps, RestEditorProps } from '../components/NoteEditor';
import type { History } from '../hooks/useHistory';
import { usePersistentState } from '../hooks/usePersistentState';
import { enharmonic, spelledName } from '../notation/theory';
import type { Arrangement } from '../transcribe';
import { suggestChords } from '../transcribe/chords';
import { addedId, addedIndex, isAdded, isSplitHalf, withEdit, type NoteEdit } from '../transcribe/edits';
import { snapUnits } from '../transcribe/feel';
import { withPitch, withRepeat, withText, withoutNote, type Marks } from '../transcribe/marks';
import { restId } from '../transcribe/score';

/** A played note as it stands on the score. */
interface WrittenNote {
  name: string;
  midi: number;
  /** where its first notehead is, in units from the first bar line */
  start: number;
  /** written length, all its tied noteheads together */
  units: number;
  tuplet: boolean;
  /** the bar its first notehead is in */
  measure: number;
  /** whether it has another name it could be written under */
  respellable: boolean;
}

interface WrittenRest {
  start: number;
  units: number;
  measure: number;
}

export interface NoteTools {
  /** what is picked on the score: the played notes by index, or one rest by its id */
  selected: number[];
  /**
   * A note or a rest was tapped (again: unpick it), or the score beside them (null).
   * With `extend`, the notes from the one already picked to this one are picked together.
   */
  pick: (id: number | null, extend?: boolean) => void;
  /** what the note editor needs, while notes are picked */
  editor: NoteEditorProps | null;
  /** …and while a rest is */
  rest: RestEditorProps | null;
  /** how many notes carry a correction or were written in */
  editCount: number;
  undoAllEdits: () => void;
  /** Writes a chord over each bar that has none. */
  suggestChords: () => void;
}

/** A note that was heard, as against half of a split one or one written in. */
const isHeard = (eventIndex: number) => !isSplitHalf(eventIndex) && !isAdded(eventIndex);

/**
 * @param tune          whatever identifies the tune on the desk; a change of tune drops the selection
 * @param onPick        a note is being picked: stop anything playing
 * @param onRecordFrom  the tune is to be recorded again from this played note on, the first of that bar
 */
export function useNoteTools(
  arrangement: Arrangement | null,
  marks: History<Marks>,
  tune: unknown,
  onPick: () => void,
  onRecordFrom: (eventIndex: number, bar: number) => void,
): NoteTools {
  /** the note or rest picked; with `reach`, one end of a run of notes */
  const [selected, setSelected] = useState<number | null>(null);
  /** the other end of the run */
  const [reach, setReach] = useState<number | null>(null);
  /** the next note tapped ends the run rather than replacing the pick */
  const [extending, setExtending] = useState(false);
  /** whether a length change pushes the later notes along, or only moves this note's end */
  const [ripple, setRipple] = usePersistentState('scribe.ripple', false, (stored) => stored === true);
  const { edits, added, chords, lyrics } = marks.value;
  const change = marks.change;
  const score = arrangement?.score;

  /** the notes and rests on the score, in order */
  const { written, rests } = useMemo(() => {
    const notes = new Map<number, WrittenNote>();
    const silences = new Map<number, WrittenRest>();
    const barUnits = score?.meter.barUnits ?? 16;
    (score?.measures ?? []).forEach((measure, index) => {
      let at = index * barUnits;
      for (const item of measure.items) {
        const start = snapUnits(at);
        at += item.units;
        if (item.kind === 'rest') {
          silences.set(restId(start), { start, units: item.units, measure: index });
          continue;
        }
        if (!item.pitch) continue;
        const known = notes.get(item.eventIndex);
        if (known) known.units += item.units;
        else {
          notes.set(item.eventIndex, {
            name: spelledName(item.pitch),
            midi: item.pitch.midi,
            start,
            units: item.units,
            tuplet: !!item.tuplet,
            measure: index,
            respellable: enharmonic(item.pitch) !== null,
          });
        }
      }
    });
    return { written: notes, rests: silences };
  }, [score]);
  const order = useMemo(() => [...written.keys()], [written]);
  const picked = selected === null ? undefined : written.get(selected);
  const pickedRest = selected === null ? undefined : rests.get(selected);

  /** every note picked: the one, or the run from it to `reach` */
  const picks = useMemo(() => {
    if (selected === null || !written.has(selected)) return [];
    const from = order.indexOf(selected);
    const to = reach === null ? from : order.indexOf(reach);
    return to < 0 ? [selected] : order.slice(Math.min(from, to), Math.max(from, to) + 1);
  }, [selected, reach, order, written]);
  const several = picks.length > 1;
  const shown = useMemo(() => (pickedRest && selected !== null ? [selected] : picks), [pickedRest, selected, picks]);

  const unpick = () => {
    setSelected(null);
    setReach(null);
    setExtending(false);
  };
  useEffect(unpick, [tune]);
  // what is picked can also leave the score: a note removed or joined, a rest filled
  useEffect(() => {
    if (selected !== null && !written.has(selected) && !rests.has(selected)) unpick();
  }, [selected, written, rests]);

  const pick = (id: number | null, extend = false) => {
    onPick();
    if (id !== null && id >= 0 && picked && id !== selected && (extend || extending)) {
      setReach(id);
      setExtending(false);
      return;
    }
    setReach(null);
    setExtending(false);
    setSelected((current) => (id === current && !several ? null : id));
  };

  const editNote = (eventIndex: number, update: (edit: NoteEdit) => NoteEdit) =>
    change((m) => ({ ...m, edits: withEdit(m.edits, eventIndex, update) }));

  /** Moves the pick to the next or previous note; with `extend`, moves the end of the run instead. */
  const step = (direction: -1 | 1, extend = false) => {
    if (!picked || selected === null) return;
    const next = order[order.indexOf(extend ? (reach ?? selected) : selected) + direction];
    if (next === undefined) return;
    if (extend) return setReach(next === selected ? null : next);
    setReach(null);
    setSelected(next);
  };

  const nudgePitch = (by: number) => {
    if (!picked) return;
    change((m) => picks.reduce((all, index) => withPitch(all, index, by), m));
    void playTone(picked.midi + by);
  };

  const stepUnits = arrangement?.stepUnits ?? 1;
  const canShorten = !!picked && !several && picked.units > stepUnits;
  const nudgeLength = (by: -1 | 1) => {
    if (selected === null || several || (by < 0 && !canShorten)) return;
    if (isAdded(selected)) {
      const id = addedId(selected);
      return change((m) => {
        const note = m.added[id];
        if (!note) return m;
        return { ...m, added: { ...m.added, [id]: { ...note, length: Math.max(stepUnits, note.length + by * stepUnits) } } };
      });
    }
    editNote(selected, (edit) =>
      ripple ? { ...edit, steps: (edit.steps ?? 0) + by } : { ...edit, stretch: (edit.stretch ?? 0) + by },
    );
  };

  const respelled = selected !== null && !!(isAdded(selected) ? added[addedId(selected)]?.respell : edits[selected]?.respell);
  const canRespell = !several && !!picked && (picked.respellable || respelled);
  const respell = () => {
    if (selected === null || !canRespell) return;
    if (!isAdded(selected)) return editNote(selected, (edit) => ({ ...edit, respell: !edit.respell }));
    const id = addedId(selected);
    change((m) => (m.added[id] ? { ...m, added: { ...m.added, [id]: { ...m.added[id], respell: !m.added[id].respell } } } : m));
  };

  // a note cut in two, and two notes made one
  const isSplit = selected !== null && !!edits[selected]?.split;
  const canSplit =
    !several &&
    (isSplit || (!!picked && selected !== null && isHeard(selected) && !picked.tuplet && picked.units >= 2 * stepUnits));
  const nextNote = selected === null ? undefined : order[order.indexOf(selected) + 1];
  const canJoin = !several && !!picked && nextNote !== undefined && isHeard(nextNote);

  const remove = () => {
    if (picks.length === 0) return;
    const after = order[order.indexOf(picks[picks.length - 1]) + 1];
    const before = order[order.indexOf(picks[0]) - 1];
    change((m) => picks.reduce(withoutNote, m));
    setReach(null);
    setSelected(after ?? before ?? null);
  };

  // A repeat sign belongs to a bar, whichever of the bar's notes it was put on.
  const bar = picked ? score?.measures[picked.measure] : undefined;
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

  /** the first heard note of the picked note's bar, or failing that the first one after it */
  const barStart = picked ? order.find((index) => isHeard(index) && written.get(index)!.measure >= picked.measure) : undefined;

  /** Writes a note into the picked rest, at the pitch of the note before it. */
  const fillRest = () => {
    if (!pickedRest || !arrangement) return;
    // placed from the last heard note before it, so it keeps its place when earlier notes change
    let after = -1;
    let from = 0;
    let neighbour: WrittenNote | undefined;
    for (const index of order) {
      const note = written.get(index)!;
      if (note.start >= pickedRest.start) {
        neighbour ??= note;
        break;
      }
      neighbour = note;
      if (isHeard(index)) {
        after = index;
        from = note.start;
      }
    }
    const midi = neighbour?.midi ?? 60 + arrangement.transpose;
    const id = Object.keys(added).reduce((max, key) => Math.max(max, Number(key) + 1), 0);
    change((m) => ({
      ...m,
      added: {
        ...m.added,
        [id]: {
          after,
          offset: snapUnits(pickedRest.start - from),
          length: snapUnits(pickedRest.units),
          midi: midi - arrangement.transpose,
        },
      },
    }));
    setSelected(addedIndex(id));
    void playTone(midi);
  };

  // the same tools from the keyboard while something is picked
  const keys = useRef({ step, nudgePitch, nudgeLength, remove, fillRest });
  keys.current = { step, nudgePitch, nudgeLength, remove, fillRest };
  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element).closest?.('input, select, textarea')) return;
      const act = keys.current;
      if (e.key === 'Escape') unpick();
      else if (selected < 0) {
        // a rest: the one thing to do with it
        if (e.key !== 'Enter' || (e.target as Element).closest?.('button')) return;
        act.fillRest();
      } else if (e.key === 'ArrowUp') act.nudgePitch(e.shiftKey ? 12 : 1);
      else if (e.key === 'ArrowDown') act.nudgePitch(e.shiftKey ? -12 : -1);
      else if (e.key === 'ArrowLeft') act.step(-1, e.shiftKey);
      else if (e.key === 'ArrowRight') act.step(1, e.shiftKey);
      else if (e.key === '+' || e.key === '=') act.nudgeLength(1);
      else if (e.key === '-') act.nudgeLength(-1);
      else if (e.key === 'Delete' || e.key === 'Backspace') act.remove();
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

  const at = (index: number) => order.indexOf(index) + 1;
  const editor: NoteEditorProps | null =
    picked && selected !== null
      ? {
          name: several ? `${picks.length} notes` : picked.name,
          position: several
            ? `notes ${at(picks[0])} to ${at(picks[picks.length - 1])} of ${order.length}`
            : `note ${at(selected)} of ${order.length}`,
          several,
          edited: picks.some((index) => !!edits[index]),
          canShorten,
          ripple,
          onRipple: () => setRipple(!ripple),
          isSplit,
          canSplit,
          onSplit: () => {
            if (canSplit) editNote(selected, (edit) => ({ ...edit, split: !edit.split }));
          },
          canJoin,
          onJoin: () => {
            if (canJoin) editNote(nextNote, (edit) => ({ ...edit, joined: true }));
          },
          canRespell,
          respelled,
          onRespell: respell,
          extending,
          onExtend: () => setExtending(!extending),
          chord: chords[selected] ?? '',
          lyric: lyrics[selected] ?? '',
          // a run of typing in one field undoes as one step
          onChord: (text) => change((m) => ({ ...m, chords: withText(m.chords, selected, text) }), `chord ${selected}`),
          onLyric: (text) => change((m) => ({ ...m, lyrics: withText(m.lyrics, selected, text) }), `lyric ${selected}`),
          repeatStart: !!bar?.repeatStart,
          repeatEnd: !!bar?.repeatEnd,
          onRepeat: toggleRepeat,
          bar: picked.measure + 1,
          onRecordFrom:
            barStart === undefined
              ? null
              : () => {
                  onRecordFrom(barStart, written.get(barStart)!.measure + 1);
                  unpick();
                },
          onStep: (direction) => step(direction),
          onPitch: nudgePitch,
          onLength: nudgeLength,
          onRemove: remove,
          onReset: () =>
            change((m) => {
              const next = { ...m.edits };
              for (const index of picks) delete next[index];
              return { ...m, edits: next };
            }),
          onDone: unpick,
        }
      : null;

  const rest: RestEditorProps | null = pickedRest ? { bar: pickedRest.measure + 1, onAdd: fillRest, onDone: unpick } : null;

  return {
    selected: shown,
    pick,
    editor,
    rest,
    editCount: Object.keys(edits).length + Object.keys(added).length,
    undoAllEdits: () => {
      change((m) => ({ ...m, edits: {}, added: {} }));
      unpick();
    },
    suggestChords: () => {
      if (score) change((m) => ({ ...m, chords: { ...suggestChords(score), ...m.chords } }));
    },
  };
}
