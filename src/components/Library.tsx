// The saved tunes, most recently touched first, behind a fold.

import { UNTITLED, clock, day } from '../app/format';
import type { TuneSummary } from '../storage/library';
import Icon from './Icon';

interface Props {
  tunes: TuneSummary[];
  /** the tune on the desk */
  currentId: string | null;
  disabled: boolean;
  onOpen: (id: string) => void;
  onDelete: (tune: TuneSummary) => void;
}

export default function Library({ tunes, currentId, disabled, onOpen, onDelete }: Props) {
  if (tunes.length === 0) return null;
  return (
    <details className="library">
      <summary>
        Saved tunes <span>{tunes.length}</span>
      </summary>
      <ul>
        {tunes.map((tune) => (
          <li key={tune.id}>
            <button
              type="button"
              className="library-open"
              aria-current={tune.id === currentId || undefined}
              disabled={disabled}
              onClick={() => onOpen(tune.id)}
            >
              <strong>{tune.title || UNTITLED}</strong>
              <span>
                {tune.notes} {tune.notes === 1 ? 'note' : 'notes'}, {clock(tune.seconds)}, {day(tune.updatedAt)}
              </span>
            </button>
            <button
              type="button"
              className="tool"
              aria-label={`Delete ${tune.title || UNTITLED}`}
              title="Delete"
              disabled={disabled}
              onClick={() => onDelete(tune)}
            >
              <Icon name="remove" />
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
