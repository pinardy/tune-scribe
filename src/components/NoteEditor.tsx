// The tools for correcting one note, shown in place of the play buttons
// while a note on the score is picked.

import { MAX_CHORD_LENGTH, MAX_LYRIC_LENGTH } from '../transcribe/marks';
import Icon, { type IconName } from './Icon';

export interface NoteEditorProps {
  /** the note as written, e.g. "F♯4" */
  name: string;
  /** its place in the tune, e.g. "note 5 of 30" */
  position: string;
  /** more than one note is picked: the tools that work on a single note are out of use */
  several: boolean;
  /** whether what is picked has been changed by hand */
  edited: boolean;
  canShorten: boolean;
  /** whether a length change pushes the later notes along */
  ripple: boolean;
  onRipple: () => void;
  isSplit: boolean;
  canSplit: boolean;
  onSplit: () => void;
  canJoin: boolean;
  onJoin: () => void;
  /** whether the note has another name (F♯ for G♭), and whether it is written under it */
  canRespell: boolean;
  respelled: boolean;
  onRespell: () => void;
  /** the next note tapped is picked together with this one and all between */
  extending: boolean;
  onExtend: () => void;
  chord: string;
  lyric: string;
  onChord: (text: string) => void;
  onLyric: (text: string) => void;
  /** repeat signs at the bar this note is in */
  repeatStart: boolean;
  repeatEnd: boolean;
  onRepeat: (sign: 'start' | 'end') => void;
  /** the bar the note is in, counted from 1 */
  bar: number;
  /** Sets the next recording to replace the tune from this bar on; null where there is nothing to replace. */
  onRecordFrom: (() => void) | null;
  onStep: (direction: -1 | 1) => void;
  onPitch: (semitones: number) => void;
  onLength: (steps: -1 | 1) => void;
  onRemove: () => void;
  onReset: () => void;
  onDone: () => void;
}

function Tool({ icon, label, onClick, disabled }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="tool" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

export default function NoteEditor(p: NoteEditorProps) {
  return (
    <div className="note-editor" role="group" aria-label="Correct the picked note">
      <div className="note-editor-head">
        <Tool icon="previous" label="Previous note" onClick={() => p.onStep(-1)} />
        <p className="note-editor-what" aria-live="polite">
          <strong>{p.name}</strong> <span>{p.position}</span>
        </p>
        <Tool icon="next" label="Next note" onClick={() => p.onStep(1)} />
        <button type="button" className="button is-primary" onClick={p.onDone}>
          Done
        </button>
      </div>
      <div className="note-editor-tools">
        <div className="tool-group">
          <span>Pitch</span>
          <Tool icon="down" label="Lower by a semitone" onClick={() => p.onPitch(-1)} />
          <Tool icon="up" label="Higher by a semitone" onClick={() => p.onPitch(1)} />
        </div>
        <div className="tool-group">
          <span>Length</span>
          <Tool icon="minus" label="Shorter" onClick={() => p.onLength(-1)} disabled={!p.canShorten} />
          <Tool icon="plus" label="Longer" onClick={() => p.onLength(1)} disabled={p.several} />
        </div>
        <div className="tool-group is-last">
          {p.edited && (
            <button type="button" className="link" onClick={p.onReset}>
              Reset
            </button>
          )}
          <Tool icon="remove" label={p.several ? 'Remove these notes' : 'Remove this note'} onClick={p.onRemove} />
        </div>
      </div>
      {!p.several && (
      <div className="note-editor-words">
        <label>
          <span>Chord</span>
          <input
            value={p.chord}
            maxLength={MAX_CHORD_LENGTH}
            placeholder="Am, G7…"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => p.onChord(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              p.onStep(1);
            }}
          />
        </label>
        <label>
          <span>Lyric</span>
          <input
            value={p.lyric}
            maxLength={MAX_LYRIC_LENGTH}
            placeholder="one syllable"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => p.onLyric(e.target.value.replace(/\s+/g, ''))}
            onKeyDown={(e) => {
              // as in a notation editor: space or Enter goes on to the next note, and so
              // does a hyphen, which stays to show the word carries on
              if (e.key === '-' && p.lyric && !p.lyric.endsWith('-')) p.onLyric(`${p.lyric}-`);
              else if (e.key !== ' ' && e.key !== 'Enter') return;
              e.preventDefault();
              p.onStep(1);
            }}
          />
        </label>
      </div>
      )}
      <details className="note-editor-more">
        <summary>More: octaves, several notes, split, join, repeats</summary>
        <div>
        <button type="button" className="chip" onClick={() => p.onPitch(12)}>
          Up an octave
        </button>
        <button type="button" className="chip" onClick={() => p.onPitch(-12)}>
          Down an octave
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={p.extending}
          onClick={p.onExtend}
          title="Then tap another note: it and every note between are picked together, to move or remove as one"
        >
          {p.extending ? 'Now tap the last note' : 'Pick up to another note'}
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={p.respelled}
          onClick={p.onRespell}
          disabled={!p.canRespell}
          title="Write a sharp as the flat of the note above, or a flat as the sharp of the note below"
        >
          Other name (♯ or ♭)
        </button>
        <button type="button" className="chip" aria-pressed={p.isSplit} onClick={p.onSplit} disabled={!p.canSplit}>
          Split in two
        </button>
        <button type="button" className="chip" onClick={p.onJoin} disabled={!p.canJoin}>
          Join to next
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={p.ripple}
          onClick={p.onRipple}
          title="When on, making this note longer or shorter moves every note after it"
        >
          Length moves later notes
        </button>
        <button type="button" className="chip" aria-pressed={p.repeatStart} onClick={() => p.onRepeat('start')}>
          Repeat from this bar
        </button>
        <button type="button" className="chip" aria-pressed={p.repeatEnd} onClick={() => p.onRepeat('end')}>
          Repeat to this bar
        </button>
        {p.onRecordFrom && (
          <button type="button" className="chip" onClick={p.onRecordFrom}>
            Record again from bar {p.bar}
          </button>
        )}
        </div>
      </details>
    </div>
  );
}

export interface RestEditorProps {
  /** the bar the rest is in, counted from 1 */
  bar: number;
  onAdd: () => void;
  onDone: () => void;
}

/** What can be done with a picked rest: write in the note that was not heard. */
export function RestEditor({ bar, onAdd, onDone }: RestEditorProps) {
  return (
    <div className="note-editor" role="group" aria-label="The picked rest">
      <div className="note-editor-head">
        <p className="note-editor-what" aria-live="polite">
          <strong>Rest</strong> <span>in bar {bar}</span>
        </p>
        <button type="button" className="button" onClick={onAdd}>
          <Icon name="plus" />
          Add a note here
        </button>
        <button type="button" className="button is-primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
