// The line under the score: what has been corrected by hand, and undo and redo.

import type { History } from '../hooks/useHistory';
import Icon from './Icon';

interface Props {
  /** how many notes carry a correction */
  editCount: number;
  onUndoAll: () => void;
  onSuggestChords: () => void;
  history: Pick<History<unknown>, 'undo' | 'redo' | 'canUndo' | 'canRedo'>;
}

export default function SheetFoot({ editCount, onUndoAll, onSuggestChords, history }: Props) {
  return (
    <div className="sheet-foot">
      <p className="sheet-hint">
        {editCount > 0 ? (
          <>
            {editCount} {editCount === 1 ? 'note' : 'notes'} corrected or added by hand.{' '}
            <button type="button" className="link" onClick={onUndoAll}>
              Undo all
            </button>
          </>
        ) : (
          'Tap a note to correct it, or a rest to put a note there.'
        )}{' '}
        <button
          type="button"
          className="link"
          onClick={onSuggestChords}
          title="Writes a likely chord over each bar that has none, from the melody and the key"
        >
          Suggest chords
        </button>
      </p>
      {(history.canUndo || history.canRedo) && (
        <div className="sheet-history">
          <button
            type="button"
            className="tool"
            aria-label="Undo"
            title="Undo"
            onClick={history.undo}
            disabled={!history.canUndo}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Redo"
            title="Redo"
            onClick={history.redo}
            disabled={!history.canRedo}
          >
            <Icon name="redo" />
          </button>
        </div>
      )}
    </div>
  );
}
