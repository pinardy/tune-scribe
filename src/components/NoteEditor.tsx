// The tools for correcting one note, shown in place of the play buttons
// while a note on the score is picked.

import Icon, { type IconName } from './Icon';

interface Props {
  /** the note as written, e.g. "F♯4" */
  name: string;
  /** its place in the tune, e.g. "note 5 of 30" */
  position: string;
  /** whether this note has been changed by hand */
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
  onStep: (direction: -1 | 1) => void;
  onPitch: (semitones: -1 | 1) => void;
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

export default function NoteEditor(p: Props) {
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
          <Tool icon="plus" label="Longer" onClick={() => p.onLength(1)} />
        </div>
        <div className="tool-group is-last">
          {p.edited && (
            <button type="button" className="link" onClick={p.onReset}>
              Reset
            </button>
          )}
          <Tool icon="remove" label="Remove this note" onClick={p.onRemove} />
        </div>
      </div>
      <div className="note-editor-more">
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
      </div>
    </div>
  );
}
